'use strict';
// events.jsonl → 세션/에이전트 구조로 변환하는 순수 함수 모음 (vscode 의존 없음, 단독 테스트 가능)

const fs = require('fs');
const path = require('path');

const LIVE_WINDOW_MS = 10 * 60 * 1000;
const QUIET_KINDS = new Set(['session_start', 'session_end', 'stop']);

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
    if (!s.title && e.kind === 'prompt' && !e.agent_id) s.title = e.summary;
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
        sent.push({ from: s.id, toHandle: String(e.target).replace(/^@/, ''), text: e.detail || e.summary || '', summary: e.summary, ts: e.ts, t: e._t, idx: e._idx, agent: e.agent_type });
      }
      if (e.kind === 'message_in' && e.target) {
        received.push({ receiver: s.id, fromHandle: e.target, key: norm(e.detail || e.summary, 600), ts: e.ts, t: e._t, text: e.detail || e.summary, idx: e._idx });
      }
    }
    const tr = transcripts[s.id];
    if (tr) for (const r of tr.received) received.push({ receiver: s.id, fromHandle: r.fromHandle, key: r.key, text: r.text });
  }

  // 2) 핸들 → 세션 매핑 학습
  const learned = {};
  //  (a) 받은 메시지 내용이 누군가 보낸 메시지와 같으면: 보낸 대상 핸들 = 받은 세션, 보낸이 핸들 = 보낸 세션
  for (const r of received) {
    if (!r.key) continue;
    const m = sent.find((x) => x.from !== r.receiver && norm(x.text) && r.key.includes(norm(x.text)));
    r.match = m;
    if (m) {
      if (!learned[m.toHandle]) learned[m.toHandle] = r.receiver;
      if (!learned[r.fromHandle]) learned[r.fromHandle] = m.from;
    }
  }
  //  (b) "<폴더명>-<세션ID 앞자리>" 형태 추정
  const guess = (h) => {
    const mm = /^(.*?)-([0-9a-f]{2,12})$/i.exec(h);
    if (!mm) return undefined;
    const hits = sessions.filter((s) => s.id.toLowerCase().startsWith(mm[2].toLowerCase()) && (!s.cwd || s.cwd.split(/[\\/]/).pop() === mm[1]));
    return hits.length === 1 ? hits[0].id : undefined;
  };
  const resolve = (h) => {
    if (aliases[h] && byId.has(aliases[h])) return { id: aliases[h], how: 'manual' };
    if (learned[h] && byId.has(learned[h])) return { id: learned[h], how: 'learned' };
    const g = guess(h);
    if (g) return { id: g, how: 'guess' };
    return undefined;
  };

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
    const r = resolve(m.toHandle);
    let to;
    if (r) to = r.id;
    else { to = `@${m.toHandle}`; ghosts.set(to, m.toHandle); }
    sentKeys.add(`${m.from}|${to}|${norm(m.text)}`);
    addMsg(m.from, to, { ts: m.ts, t: m.t, text: m.text, idx: m.idx, dir: 'out' });
  }
  // 보낸 쪽 기록이 없는 메시지(상대 세션에 플러그인이 아직 안 붙은 경우)는 받은 쪽 기록으로 보충
  for (const r of received) {
    if (r.t === undefined) continue; // transcript 에서 읽은 건 시간이 없어 엣지로 쓰지 않음
    const s = resolve(r.fromHandle);
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
      label: names[s.id] || tr.title || s.title,
      autoLabel: tr.title || s.title,
      sub: s.cwd ? s.cwd.split(/[\\/]/).pop() : '',
      cwd: s.cwd,
      handle: handleOf[s.id],
      live: s.live,
      eventCount: s.events.length,
      editCount: s.editCount,
      fileCount: s.files.size,
      last: s.end,
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

  const ids = new Set(nodes.map((n) => n.id));
  const edges = [...edgeMap.values()]
    .filter((ed) => ids.has(ed.from) && ids.has(ed.to))
    .map((ed) => ({
      ...ed,
      active: now - ed.last < ACTIVE_EDGE_MS,
      messages: ed.messages.sort((a, b) => (a.t || 0) - (b.t || 0)).map((m) => ({ ...m, t: undefined })),
    }));
  return { nodes, edges, learned };
}

module.exports = { readEvents, buildSessions, sessionView, buildGraph, groupByFolder, parseIncoming, folderOf };
