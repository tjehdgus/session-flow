'use strict';
// events.jsonl → 세션/에이전트 구조로 변환하는 순수 함수 모음 (vscode 의존 없음, 단독 테스트 가능)

const fs = require('fs');
const path = require('path');

const LIVE_WINDOW_MS = 10 * 60 * 1000;
const QUIET_KINDS = new Set(['session_start', 'session_end', 'stop', 'harness_brief']);
// 사람이 친 질문이 아니라 IDE/시스템이 자동으로 넣는 프롬프트 (세션 제목으로 쓰지 않음)
const AUTO_PROMPT = /^\s*(<|continue from where you left off|continue\.?$|resume\b|\[request interrupted)/i;
const isHumanPrompt = (e) => e.kind === 'prompt' && !e.agent_id && !AUTO_PROMPT.test(e.summary || '');

// 다른 세션에서 온 메시지가 프롬프트로 들어온 형태를 해석한다.
//   <cross-session-message from="uds:...">본문</cross-session-message>
//   Message from @kftc-3f: 본문
function parseIncoming(text) {
  if (!text) return null;
  const s = String(text);
  let m = /<cross-session-message\b[^>]*?\bfrom\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)(?:<\/cross-session-message>|$)/.exec(s);
  if (m) return { from: m[1], body: m[2].trim() };
  m = /<cross-session-message\b[^>]*>([\s\S]*?)(?:<\/cross-session-message>|$)/.exec(s);
  if (m) return { from: 'unknown', body: m[1].trim() };
  m = /Message from @([A-Za-z0-9_.:/-]+)[^:\n]{0,80}?:\s*([\s\S]*)/.exec(s);
  if (m) return { from: m[1], body: m[2].trim() };
  return null;
}

// 세션이 어느 작업 폴더(플로우)에 속하는지. roots(워크스페이스 폴더) 안이면 그 폴더, 아니면 cwd 자체.
function folderOf(cwd, roots = []) {
  if (!cwd) return '(unknown)';
  const c = cwd.replace(/[\\/]+$/, '');
  for (const r of roots) {
    const rr = r.replace(/[\\/]+$/, '');
    if (c === rr || c.startsWith(rr + '/') || c.startsWith(rr + '\\')) return rr;
  }
  return c;
}

function readEvents(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* 깨진 줄 무시 */ }
  }
  return out;
}

function buildSessions(events, now = Date.now(), roots = []) {
  const sessions = new Map();
  events.forEach((e, idx) => {
    if (!e || !e.session_id) return;
    e._idx = idx;
    e._t = Date.parse(e.ts) || 0;
    // 이전 버전 플러그인은 받은 메시지를 일반 프롬프트로 기록했으므로 읽을 때 바로잡는다
    if (e.kind === 'prompt') {
      const inc = parseIncoming(e.detail || e.summary);
      if (inc) { e.kind = 'message_in'; e.target = inc.from; e.detail = inc.body; e.summary = inc.body.slice(0, 120); }
    }
    let s = sessions.get(e.session_id);
    if (!s) {
      s = {
        id: e.session_id, cwd: e.cwd, folder: folderOf(e.cwd, roots), start: e._t, end: e._t, title: undefined,
        ended: false, events: [], agents: new Map(), editCount: 0, files: new Set(), activity: 0,
      };
      s.agents.set('main', { id: 'main', type: 'Main', events: [], start: e._t, end: e._t });
      sessions.set(e.session_id, s);
    }
    s.events.push(e);
    if (!QUIET_KINDS.has(e.kind)) s.activity += 1;
    s.start = Math.min(s.start, e._t);
    s.end = Math.max(s.end, e._t);
    // <task-notification>, <command-name> 같은 시스템이 넣은 프롬프트는 제목으로 쓰지 않는다
    if (!s.title && isHumanPrompt(e)) s.title = e.summary;
    if (e.transcript_path && !e.agent_id) s.transcriptPath = e.transcript_path;
    if (e.kind === 'session_end') s.ended = true;

    const key = e.agent_id || 'main';
    let a = s.agents.get(key);
    if (!a) {
      a = { id: key, type: e.agent_type || 'subagent', events: [], start: e._t, end: e._t };
      s.agents.set(key, a);
    }
    if (e.agent_type && a.type === 'subagent') a.type = e.agent_type;
    a.events.push(e);
    a.start = Math.min(a.start, e._t);
    a.end = Math.max(a.end, e._t);

    if (e.kind === 'tool' && e.file && (e.has_after || e.has_before)) {
      s.editCount += 1;
      s.files.add(e.file);
    }
  });

  for (const s of sessions.values()) {
    s.live = !s.ended && now - s.end < LIVE_WINDOW_MS;
    if (!s.title) s.title = `세션 ${s.id.slice(0, 6)}`;
  }
  return [...sessions.values()].sort((a, b) => b.end - a.end);
}

// 주소 표기 통일: '/run/.../x.sock' 과 'uds:/run/.../x.sock', '@kftc-3f' 와 'kftc-3f' 를 같게 본다
function normAddr(h) {
  let x = String(h || '').trim().replace(/^@/, '');
  if (/^\//.test(x) && /\.sock$/.test(x)) x = 'uds:' + x;
  return x;
}
// 관측 중 시각 t 에 해당하는 것: t 이전(1분 여유)의 가장 최근 관측, 없으면 가장 가까운 관측
function latest(list, t) {
  if (!list || !list.length) return null;
  if (!t) return list.reduce((a, b) => (b.t >= a.t ? b : a));
  const before = list.filter((x) => x.t <= t + 60 * 1000);
  if (before.length) return before.reduce((a, b) => (b.t >= a.t ? b : a));
  return list.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a));
}

// 작업 폴더별로 묶기 → [{ folder, name, sessions, live, last }]
function groupByFolder(sessions) {
  const m = new Map();
  for (const s of sessions) {
    let g = m.get(s.folder);
    if (!g) { g = { folder: s.folder, name: path.basename(s.folder) || s.folder, sessions: [], live: 0, last: 0 }; m.set(s.folder, g); }
    g.sessions.push(s);
    if (s.live) g.live += 1;
    g.last = Math.max(g.last, s.end);
  }
  return [...m.values()].sort((a, b) => b.last - a.last);
}

// 세션 기록을 "턴" 단위로: 사람의 질문 또는 다른 세션에서 받은 메시지 하나 = 턴 하나.
// 그 턴 동안 한 일(툴, 파일 수정, 보낸 메시지, 서브에이전트)을 묶는다. 최신 턴이 앞.
function sessionTurns(s, limit = 200) {
  const cut = (x, n = 240) => (x == null ? '' : String(x).length > n ? String(x).slice(0, n) + '…' : String(x));
  const turns = [];
  let cur = null;
  const open = (trigger, e) => {
    cur = { trigger, ts: e ? e.ts : null, items: [], stats: { tools: 0, bash: 0, edits: 0, files: new Set(), out: 0, delegates: 0, errors: 0, blocked: 0 } };
    turns.push(cur);
  };
  for (const e of s.events) {
    if (QUIET_KINDS.has(e.kind)) continue;
    if (!e.agent_id && (e.kind === 'prompt' || e.kind === 'message_in')) {
      open({ kind: e.kind, text: cut(e.detail || e.summary, 600), from: e.kind === 'message_in' ? e.target : null, idx: e._idx }, e);
      continue;
    }
    if (!cur) open({ kind: 'start', text: '' }, e);
    const isEdit = e.kind === 'tool' && !!(e.has_after || e.has_before);
    cur.items.push({
      idx: e._idx, ts: e.ts, kind: e.kind, tool: e.tool, agent: e.agent_type || null, sub: !!e.agent_id,
      file: e.file || null, target: e.target || null, summary: cut(e.summary), detail: cut(e.detail, 1200),
      hasDiff: isEdit, blocked: !!e.blocked,
    });
    const st = cur.stats;
    if (e.kind === 'tool' || e.kind === 'tool_error') st.tools += 1;
    if (e.tool === 'Bash') st.bash += 1;
    if (isEdit) { st.edits += 1; st.files.add(e.file); }
    if (e.kind === 'message') { st.out += 1; if (e.blocked) st.blocked += 1; }
    if (e.kind === 'delegate') st.delegates += 1;
    if (e.kind === 'tool_error') st.errors += 1;
  }
  return turns.slice(-limit).reverse().map((t) => ({ ...t, stats: { ...t.stats, files: [...t.stats.files] }, end: t.items.length ? t.items[t.items.length - 1].ts : t.ts }));
}

// Webview 로 넘길 직렬화 가능한 형태
function sessionView(s) {
  const span = Math.max(1, s.end - s.start);
  const lanes = [...s.agents.values()]
    .filter((a) => a.events.length)
    .sort((a, b) => (a.id === 'main' ? -1 : b.id === 'main' ? 1 : a.start - b.start))
    .map((a) => ({
      id: a.id,
      type: a.type,
      isMain: a.id === 'main',
      from: ((a.start - s.start) / span) * 100,
      to: ((a.end - s.start) / span) * 100,
      events: a.events
        .filter((e) => !['stop', 'session_start', 'session_end'].includes(e.kind))
        .map((e) => ({
          idx: e._idx,
          kind: e.kind,
          tool: e.tool,
          file: e.file,
          target: e.target,
          summary: e.summary,
          detail: e.detail,
          ts: e.ts,
          pos: ((e._t - s.start) / span) * 100,
          hasDiff: !!(e.has_after || e.has_before),
          toolUseId: e.tool_use_id,
        })),
    }));
  return {
    id: s.id, title: s.displayName || s.title, cwd: s.cwd, live: s.live,
    start: new Date(s.start).toISOString(), end: new Date(s.end).toISOString(),
    eventCount: s.events.length, editCount: s.editCount, fileCount: s.files.size, lanes,
  };
}

// 세션에서 수정된 파일별로: 처음 수정 직전 ~ 마지막 수정 직후 (커밋 하나처럼 보기 위함)
function changedFiles(s) {
  const m = new Map();
  for (const e of s.events) {
    if (e.kind !== 'tool' || !e.file || !(e.has_after || e.has_before) || !e.tool_use_id) continue;
    let f = m.get(e.file);
    if (!f) { f = { file: e.file, edits: 0, first: e._idx, last: e._idx, ts: e.ts }; m.set(e.file, f); }
    f.edits += 1;
    f.last = e._idx;
    f.ts = e.ts;
  }
  return [...m.values()].sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
}

// ───────────────────────── 세션 그래프 ─────────────────────────
// nodes: 세션(및 선택 시 서브에이전트), edges: 보낸 쪽 → 받는 쪽 (방향별로 따로)
//
// opts.names      { sessionId: 표시이름 }          — 사용자가 직접 지정
// opts.aliases    { handle: sessionId }           — 사용자가 직접 연결
// opts.transcripts{ sessionId: {title, summary, received[]} }
// opts.windowMs   이 시간 안에 활동한 세션만 (0 = 전체)
// opts.showSubagents
const ACTIVE_EDGE_MS = 90 * 1000;

function buildGraph(allSessions, opts = {}) {
  const now = opts.now ?? Date.now();
  // 하나의 작업 폴더(플로우) 안의 세션만
  const sessions = opts.folder ? allSessions.filter((s) => s.folder === opts.folder) : allSessions;
  const names = opts.names || {};
  const aliases = opts.aliases || {};
  const transcripts = opts.transcripts || {};
  const norm = opts.norm || ((s, n = 24) => String(s || '').replace(/[^\p{L}\p{N}]/gu, '').slice(0, n));
  const byId = new Map(sessions.map((s) => [s.id, s]));

  // 1) 보낸 메시지 / 받은 메시지 수집
  const sent = [];
  const received = []; // { receiver, fromHandle, key }
  for (const s of sessions) {
    for (const e of s.events) {
      if (e.kind === 'message' && e.target) {
        sent.push({ from: s.id, toHandle: String(e.target).replace(/^@/, ''), text: e.detail || e.summary || '', summary: e.summary, ts: e.ts, t: e._t, idx: e._idx, agent: e.agent_type, blocked: !!e.blocked });
      }
      if (e.kind === 'message_in' && e.target) {
        received.push({ receiver: s.id, fromHandle: e.target, key: norm(e.detail || e.summary, 600), ts: e.ts, t: e._t, text: e.detail || e.summary, idx: e._idx });
      }
    }
    const tr = transcripts[s.id];
    if (tr) for (const r of tr.received) received.push({ receiver: s.id, fromHandle: r.fromHandle, key: r.key, text: r.text });
  }

  // 2) 주소(핸들) → 세션 매핑. 이름/소켓 주소는 재시작마다 바뀌고 재사용되기도 하므로
  //    "언제 그 주소가 어느 세션이었는지" 관측을 쌓아두고, 메시지 시각 기준으로 고른다.
  const obs = {}; // handle → [{ sid, t, src }]
  const see = (h, sid, t, src) => {
    if (!h || !sid) return;
    const k = normAddr(h);
    (obs[k] = obs[k] || []).push({ sid, t: t || 0, src });
  };
  //  (a) 세션이 hook 으로 남긴 자기 소켓 주소 — 가장 확실
  for (const s of sessions) {
    for (const e of s.events) if (e.self_addr) see(e.self_addr, s.id, e._t, 'self');
  }
  //  (b) ListAgents 결과에 나온 "이름 … uds:주소" 짝
  for (const s of sessions) {
    for (const e of s.events) {
      if (e.kind !== 'tool' || e.tool !== 'ListAgents' || !e.detail) continue;
      for (const line of String(e.detail).split('\n')) {
        const u = /uds:[^\s"',)]+/.exec(line);
        if (!u) continue;
        const owner = latest(obs[normAddr(u[0])], e._t);
        if (!owner) continue;
        const nm = /(?:^|[\s"'`*|-])([A-Za-z0-9][\w.-]*-[0-9a-z]{2,8})(?=[\s"'`*|:,)]|$)/i.exec(line.replace(u[0], ''));
        if (nm) see(nm[1], owner.sid, e._t, 'list');
      }
    }
  }
  //  (c) 받은 메시지 본문이 누군가 보낸 메시지와 같으면 (시각이 가장 가까운 것)
  for (const r of received) {
    if (!r.key) continue;
    const cands = sent.filter((x) => x.from !== r.receiver && norm(x.text) && r.key.includes(norm(x.text)));
    const m = r.t ? cands.sort((x, y) => Math.abs(r.t - x.t) - Math.abs(r.t - y.t))[0] : cands[0];
    r.match = m;
    if (m) {
      see(m.toHandle, r.receiver, m.t, 'content');
      see(r.fromHandle, m.from, r.t || m.t, 'content');
    }
  }
  //  (d) "<폴더명>-<세션ID 앞자리>" 형태 추정
  const guess = (h) => {
    const mm = /^(.*?)-([0-9a-f]{2,12})$/i.exec(h);
    if (!mm) return undefined;
    const hits = sessions.filter((s) => s.id.toLowerCase().startsWith(mm[2].toLowerCase()) && (!s.cwd || s.cwd.split(/[\\/]/).pop() === mm[1]));
    return hits.length === 1 ? hits[0].id : undefined;
  };
  const resolve = (h, t) => {
    const al = aliases[h] || aliases[String(h).replace(/^@/, '')];
    if (al && byId.has(al)) return { id: al, how: 'manual' };
    const o = latest((obs[normAddr(h)] || []).filter((x) => byId.has(x.sid)), t);
    if (o) return { id: o.sid, how: o.src };
    const g = guess(h);
    if (g) return { id: g, how: 'guess' };
    return undefined;
  };
  // 반환·공유용: 주소별 가장 최근 세션
  const learned = {};
  for (const [h, list] of Object.entries(obs)) { const o = latest(list); if (o) learned[h] = o.sid; }

  // 3) 엣지 (방향별)
  const edgeMap = new Map();
  const addMsg = (from, to, msg) => {
    const k = `${from}→${to}`;
    let ed = edgeMap.get(k);
    if (!ed) { ed = { id: k, from, to, count: 0, last: 0, messages: [] }; edgeMap.set(k, ed); }
    ed.count += 1;
    ed.last = Math.max(ed.last, msg.t || 0);
    ed.messages.push(msg);
  };
  const ghosts = new Map();
  const sentKeys = new Set();
  for (const m of sent) {
    const r = resolve(m.toHandle, m.t);
    let to;
    if (r) to = r.id;
    else { to = `@${m.toHandle}`; ghosts.set(to, m.toHandle); }
    sentKeys.add(`${m.from}|${to}|${norm(m.text)}`);
    addMsg(m.from, to, { ts: m.ts, t: m.t, text: m.text, idx: m.idx, dir: 'out', blocked: m.blocked || undefined });
  }
  // 보낸 쪽 기록이 없는 메시지(상대 세션에 플러그인이 아직 안 붙은 경우)는 받은 쪽 기록으로 보충
  for (const r of received) {
    if (r.t === undefined) continue; // transcript 에서 읽은 건 시간이 없어 엣지로 쓰지 않음
    const s = resolve(r.fromHandle, r.t);
    let from;
    if (s) from = s.id;
    else { from = `@${r.fromHandle}`; ghosts.set(from, r.fromHandle); }
    if (r.match && r.match.from === from) continue; // 보낸 쪽 기록으로 이미 그린 메시지
    addMsg(from, r.receiver, { ts: r.ts, t: r.t, text: r.text, idx: r.idx, dir: 'in' });
  }

  // 4) 노드
  const involved = new Set();
  for (const ed of edgeMap.values()) { involved.add(ed.from); involved.add(ed.to); }
  const handleOf = {};
  for (const [h, sid] of Object.entries({ ...learned, ...aliases })) if (!handleOf[sid]) handleOf[sid] = h;

  const nodes = [];
  for (const s of sessions) {
    if (opts.windowMs && now - s.end > opts.windowMs && !involved.has(s.id)) continue;
    if (!s.activity && !involved.has(s.id)) continue; // 열기만 하고 아무 작업도 없는 세션
    const tr = transcripts[s.id] || {};
    nodes.push({
      id: s.id,
      kind: 'session',
      label: names[s.id] || tr.title || tr.summary || s.title,
      autoLabel: tr.title || tr.summary || s.title,
      sub: s.cwd ? s.cwd.split(/[\\/]/).pop() : '',
      cwd: s.cwd,
      handle: handleOf[s.id],
      live: s.live,
      eventCount: s.events.length,
      editCount: s.editCount,
      fileCount: s.files.size,
      last: s.end,
      changedFiles: changedFiles(s),
      recent: s.events
        .filter((e) => !['stop', 'session_start', 'session_end'].includes(e.kind))
        .slice(-15).reverse()
        .map((e) => ({ idx: e._idx, kind: e.kind, tool: e.tool, file: e.file, target: e.target, summary: e.summary, ts: e.ts, agent: e.agent_type, hasDiff: !!(e.has_after || e.has_before) })),
    });
  }
  for (const [id, h] of ghosts) {
    // uds:/tmp/.../kftc-3f.sock 같은 주소는 파일 이름만 보여준다
    const short = String(h).replace(/^uds:/, '').split(/[\\/]/).pop().replace(/\.sock$/, '') || h;
    nodes.push({ id, kind: 'ghost', label: `@${short}`, handle: h, sub: '연결 안 된 세션', live: false, eventCount: 0, editCount: 0, fileCount: 0, recent: [] });
  }

  // 5) 서브에이전트 (선택)
  if (opts.showSubagents) {
    for (const s of sessions) {
      if (!nodes.find((n) => n.id === s.id)) continue;
      for (const a of s.agents.values()) {
        if (a.id === 'main' || !a.events.length) continue;
        const id = `${s.id}::${a.id}`;
        const stop = a.events.find((e) => e.kind === 'subagent_stop');
        nodes.push({
          id, kind: 'subagent', parent: s.id, label: a.type, sub: '서브에이전트',
          live: s.live && !stop, eventCount: a.events.length, editCount: 0, fileCount: 0, last: a.end,
          recent: a.events.slice(-10).reverse().map((e) => ({ idx: e._idx, kind: e.kind, tool: e.tool, file: e.file, summary: e.summary, ts: e.ts, hasDiff: !!(e.has_after || e.has_before) })),
        });
        const dels = s.agents.get('main').events.filter((e) => e.kind === 'delegate' && e.target === a.type);
        const d = dels.find((e) => e._t <= a.start + 2000) || dels[0];
        if (d) addMsg(s.id, id, { ts: d.ts, t: d._t, text: d.detail || d.summary, idx: d._idx, dir: 'delegate' });
        if (stop) addMsg(id, s.id, { ts: stop.ts, t: stop._t, text: stop.detail || '(결과 반환)', idx: stop._idx, dir: 'return' });
      }
    }
  }

  // 어느 세션인지 모르는 수신자/발신자 (고르기 화면에서 연결할 수 있게)
  const ghostHandles = [...ghosts].map(([id, h]) => {
    const related = [...edgeMap.values()].filter((ed) => ed.from === id || ed.to === id);
    const sample = related.flatMap((ed) => ed.messages).sort((a, b) => (b.t || 0) - (a.t || 0))[0];
    return { handle: h, label: (nodes.find((n) => n.id === id) || {}).label || h, count: related.reduce((x, ed) => x + ed.count, 0), sample: sample ? String(sample.text || '').slice(0, 140) : '' };
  });

  let finalNodes = nodes;
  let finalEdges = [...edgeMap.values()];

  // 사용자가 고른 세션만 남기고, 나머지(안 고른 세션·모르는 핸들)는 "기타" 하나로 묶는다
  if (opts.selected) {
    const keep = (id) => {
      const n = nodes.find((x) => x.id === id);
      if (!n) return null;
      if (n.kind === 'session') return opts.selected.has(id) ? id : OTHER;
      if (n.kind === 'subagent') return opts.selected.has(n.parent) ? id : null;
      return OTHER; // ghost
    };
    const merged = new Map();
    const otherMembers = new Set();
    for (const ed of finalEdges) {
      const f = keep(ed.from), t = keep(ed.to);
      if (!f || !t || f === t) continue;
      if (f === OTHER) otherMembers.add(ed.from);
      if (t === OTHER) otherMembers.add(ed.to);
      const k = `${f}→${t}`;
      let m = merged.get(k);
      if (!m) { m = { id: k, from: f, to: t, count: 0, last: 0, messages: [] }; merged.set(k, m); }
      m.count += ed.count;
      m.last = Math.max(m.last, ed.last);
      const via = f === OTHER ? ed.from : t === OTHER ? ed.to : null;
      const viaLabel = via ? (nodes.find((x) => x.id === via) || {}).label : null;
      m.messages.push(...ed.messages.map((x) => (viaLabel ? { ...x, via: viaLabel } : x)));
    }
    finalNodes = nodes.filter((n) => (n.kind === 'session' && opts.selected.has(n.id)) || (n.kind === 'subagent' && opts.selected.has(n.parent)));
    // 고른 세션은 활동이 없어도 보여준다
    for (const sid of opts.selected) {
      if (finalNodes.some((n) => n.id === sid)) continue;
      const s = sessions.find((x) => x.id === sid);
      if (s) finalNodes.push({ id: s.id, kind: 'session', label: names[s.id] || (transcripts[s.id] || {}).title || s.title, sub: '', cwd: s.cwd, live: s.live, eventCount: s.events.length, editCount: s.editCount, fileCount: s.files.size, last: s.end, changedFiles: changedFiles(s), recent: [] });
    }
    if (otherMembers.size && !opts.hideOther) {
      finalNodes.push({ id: OTHER, kind: 'other', label: '기타', sub: `고르지 않은 세션 ${otherMembers.size}개`, live: false, eventCount: 0, editCount: 0, fileCount: 0, recent: [], members: [...otherMembers].map((id) => (nodes.find((x) => x.id === id) || {}).label || id) });
    }
    finalEdges = [...merged.values()];
  }

  const ids = new Set(finalNodes.map((n) => n.id));
  const edges = finalEdges
    .filter((ed) => ids.has(ed.from) && ids.has(ed.to))
    .map((ed) => ({
      ...ed,
      active: now - ed.last < ACTIVE_EDGE_MS,
      blocked: ed.messages.filter((m) => m.blocked).length,
      messages: ed.messages.sort((a, b) => (a.t || 0) - (b.t || 0)).map((m) => ({ ...m, t: undefined })),
    }));
  return { nodes: finalNodes, edges, learned, ghostHandles };
}

const OTHER = '@@other';

// 세션 고르기 화면에 띄울 후보: 이 폴더에서 실제로 작업한 세션들
function pickCandidates(allSessions, folder, { names = {}, transcripts = {}, selected, seen } = {}) {
  return allSessions
    .filter((s) => s.folder === folder && (s.activity > 0 || (selected && selected.has(s.id))))
    .map((s) => {
      const tr = transcripts[s.id] || {};
      const first = s.events.find(isHumanPrompt);
      const recent = s.events.filter((e) => !QUIET_KINDS.has(e.kind) && !e.agent_id).slice(-3).reverse()
        .map((e) => e.kind === 'tool' ? `${e.tool} ${e.file ? e.file.split(/[\\/]/).pop() : (e.summary || '')}` : e.kind === 'message' ? `✉ 보냄: ${e.summary || ''}` : e.kind === 'message_in' ? `✉ 받음: ${e.summary || ''}` : (e.summary || e.kind));
      return {
        id: s.id,
        name: names[s.id] || '',
        autoName: tr.title || tr.summary || s.title,
        firstPrompt: first ? first.summary : '',
        last: s.end,
        live: s.live,
        eventCount: s.events.length,
        fileCount: s.files.size,
        recent,
        selected: selected ? selected.has(s.id) : false,
        isNew: seen ? !seen.has(s.id) : false,
      };
    })
    .sort((a, b) => b.last - a.last);
}

module.exports = { readEvents, buildSessions, sessionView, sessionTurns, buildGraph, groupByFolder, parseIncoming, folderOf, changedFiles, pickCandidates, OTHER };
