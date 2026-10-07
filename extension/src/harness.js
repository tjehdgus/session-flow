'use strict';
// 하네스 모델 (v2: 멤버 = 세션 /rename 이름). 파일: <작업 폴더>/.claude/session-flow.json
// plugin/scripts/harness.js 와 같은 형식을 쓴다.

const fs = require('fs');
const path = require('path');
const { buildGraph, changedFiles, OTHER } = require('./store');

const REL = path.join('.claude', 'session-flow.json');
const configPath = (folder) => path.join(folder, REL);
const key = (s) => String(s || '').trim().replace(/^@/, '').toLowerCase();

function normalize(cfg, folder) {
  const members = (cfg.members || []).map((m) => ({
    name: (m.name || '').trim() || (m.session ? m.session.slice(0, 8) : ''),
    role: m.role || '', main: !!m.main, ...(m.session ? { session: m.session } : {}),
  })).filter((m) => m.name);
  const nameOf = (x) => { const m = members.find((mm) => mm.session === x || key(mm.name) === key(x)); return m ? m.name : x; };
  return {
    version: 2,
    name: cfg.name || (folder ? path.basename(folder) : ''),
    enforce: !!cfg.enforce,
    members,
    edges: (cfg.edges || []).map((e) => ({ from: nameOf(e.from), to: nameOf(e.to) })),
    layout: Object.fromEntries(Object.entries(cfg.layout || {}).map(([k, v]) => [nameOf(k), v])),
  };
}

function load(folder) {
  if (!folder) return null;
  try { return normalize(JSON.parse(fs.readFileSync(configPath(folder), 'utf8')), folder); } catch { return null; }
}

function empty(folder) { return normalize({}, folder); }

function save(folder, cfg) {
  const c = normalize(cfg, folder);
  const names = new Set(c.members.map((m) => key(m.name)));
  // 멤버 아닌 이름을 가리키는 방향/배치 정리, 중복 제거, 메인은 하나
  const seen = new Set();
  c.edges = c.edges.filter((e) => {
    const k = key(e.from) + '→' + key(e.to);
    if (!names.has(key(e.from)) || !names.has(key(e.to)) || key(e.from) === key(e.to) || seen.has(k)) return false;
    seen.add(k); return true;
  });
  c.layout = Object.fromEntries(Object.entries(c.layout).filter(([k]) => names.has(key(k))));
  let mainSeen = false;
  c.members.forEach((m) => { if (m.main) { if (mainSeen) m.main = false; mainSeen = true; } });
  const p = configPath(folder);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(c, null, 2) + '\n');
  return c;
}

// 이름 바꾸기: 방향·배치 키도 같이
function renameMember(cfg, from, to) {
  const k = key(from);
  cfg.members.forEach((m) => { if (key(m.name) === k) m.name = to; });
  cfg.edges.forEach((e) => { if (key(e.from) === k) e.from = to; if (key(e.to) === k) e.to = to; });
  if (cfg.layout[from]) { cfg.layout[to] = cfg.layout[from]; delete cfg.layout[from]; }
  return cfg;
}

const allowedDir = (cfg, f, t) => !cfg.edges.length
  || cfg.edges.some((e) => (key(e.from) === key(f) && key(e.to) === key(t)) || (key(e.from) === key(t) && key(e.to) === key(f)));

// 멤버 → 세션: 설정에 적힌 세션 ID, 아니면 /rename 이름이 같은 세션 중 가장 최근
function resolveMembers(cfg, sessions, transcripts) {
  const map = {};
  for (const m of cfg.members) {
    let s = m.session ? sessions.find((x) => x.id === m.session) : null;
    if (!s) {
      const hits = sessions.filter((x) => key((transcripts[x.id] || {}).customTitle) === key(m.name));
      s = hits.sort((a, b) => b.end - a.end)[0] || null;
    }
    map[m.name] = s;
  }
  return map;
}

// 화면에 보낼 상태 한 덩어리
function viewState({ folder, cfg, sessions, transcripts, aliases = {}, norm, now = Date.now() }) {
  const inFolder = sessions.filter((s) => s.folder === folder);
  const c = cfg || empty(folder);
  const bySession = resolveMembers(c, inFolder, transcripts);
  const sidToName = {};
  for (const [name, s] of Object.entries(bySession)) if (s) sidToName[s.id] = name;

  // 주소록: /rename 이름과 멤버 이름이 곧 메시지 주소
  const book = { ...aliases };
  for (const s2 of inFolder.slice().sort((a, b) => a.end - b.end)) { const ct = (transcripts[s2.id] || {}).customTitle; if (ct) book[ct] = s2.id; }
  for (const [name, s2] of Object.entries(bySession)) if (s2) book[name] = s2.id;
  const g = buildGraph(inFolder, {
    folder, transcripts, norm, aliases: book, now,
    names: sidToName,
    selected: new Set(Object.keys(sidToName)),
  });

  // 멤버끼리의 실제 메시지 (이름 기준), 멤버 밖과의 메시지는 노드별 "외부"로
  const traffic = [];
  const external = {};
  for (const e of g.edges) {
    const f = e.from === OTHER ? null : sidToName[e.from];
    const t = e.to === OTHER ? null : sidToName[e.to];
    if (f && t) {
      traffic.push({ from: f, to: t, count: e.count, last: e.last, active: e.active, blocked: e.blocked, messages: e.messages, ok: allowedDir(c, f, t) });
    } else if (f || t) {
      const who = f || t;
      const x = external[who] || (external[who] = { out: 0, in: 0, messages: [] });
      if (f) x.out += e.count; else x.in += e.count;
      x.messages.push(...e.messages.map((m) => ({ ...m, dir: f ? 'out' : 'in' })));
    }
  }

  const nodeOf = (sid) => g.nodes.find((n) => n.id === sid);
  const members = c.members.map((m) => {
    const s = bySession[m.name];
    const n = s ? nodeOf(s.id) : null;
    const tr = s ? transcripts[s.id] || {} : {};
    return {
      name: m.name, role: m.role, main: m.main,
      sid: s ? s.id : null,
      named: !!(s && key(tr.customTitle) === key(m.name)),
      live: !!(s && s.live),
      last: s ? s.end : 0,
      eventCount: s ? s.events.length : 0,
      fileCount: s ? s.files.size : 0,
      recent: n ? n.recent : [],
      changedFiles: s ? changedFiles(s) : [],
      external: external[m.name] ? { out: external[m.name].out, in: external[m.name].in, messages: external[m.name].messages.slice(-20) } : { out: 0, in: 0, messages: [] },
    };
  });

  const memberSids = new Set(members.map((m) => m.sid).filter(Boolean));
  const tray = inFolder
    .filter((s) => !memberSids.has(s.id) && s.activity > 0)
    .map((s) => {
      const tr = transcripts[s.id] || {};
      const first = s.events.find((e) => e.kind === 'prompt' && !e.agent_id && !/^\s*(<|continue from where you left off)/i.test(e.summary || ''));
      return { sid: s.id, name: tr.customTitle || '', label: tr.customTitle || tr.title || s.title, last: s.end, eventCount: s.events.length, live: s.live, firstPrompt: first ? first.summary : '' };
    })
    .sort((a, b) => b.last - a.last);

  return {
    folder, name: c.name || path.basename(folder), exists: !!cfg, enforce: c.enforce,
    members, edges: c.edges, traffic, tray, layout: c.layout,
  };
}

module.exports = { load, save, empty, normalize, renameMember, resolveMembers, viewState, allowedDir, configPath, REL };
