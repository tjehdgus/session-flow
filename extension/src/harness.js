'use strict';
// 하네스 설정: <작업 폴더>/.claude/session-flow.json
// {
//   "version": 1,
//   "name": "kftc",
//   "enforce": false,                         // true 면 정한 방향 밖 메시지를 hook 이 막는다
//   "members": [ { "session": "<uuid>", "name": "메인 핸들러", "role": "총괄", "main": true } ],
//   "edges":   [ { "from": "<uuid>", "to": "<uuid>" } ],   // 보낼 수 있는 방향
//   "layout":  { "<uuid>": { "x": 0, "y": 0 } }
// }
// 같은 형식을 plugin/scripts/record.js 도 읽는다.

const fs = require('fs');
const path = require('path');

const REL = path.join('.claude', 'session-flow.json');
const configPath = (folder) => path.join(folder, REL);

function empty(folder) {
  return { version: 1, name: path.basename(folder), enforce: false, members: [], edges: [], layout: {} };
}

function load(folder) {
  if (!folder) return null;
  try {
    const o = JSON.parse(fs.readFileSync(configPath(folder), 'utf8'));
    return { ...empty(folder), ...o, members: o.members || [], edges: o.edges || [], layout: o.layout || {} };
  } catch { return null; }
}

function save(folder, cfg) {
  const p = configPath(folder);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  // 멤버가 아닌 세션을 가리키는 방향/배치는 정리
  const ids = new Set(cfg.members.map((m) => m.session));
  const clean = {
    version: 1,
    name: cfg.name || path.basename(folder),
    enforce: !!cfg.enforce,
    members: cfg.members.map((m) => ({ session: m.session, name: m.name || '', role: m.role || '', main: !!m.main })),
    edges: dedupe(cfg.edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to)),
    layout: Object.fromEntries(Object.entries(cfg.layout || {}).filter(([k]) => ids.has(k))),
  };
  if (clean.members.filter((m) => m.main).length > 1) {
    let seen = false;
    clean.members.forEach((m) => { if (m.main) { if (seen) m.main = false; seen = true; } });
  }
  fs.writeFileSync(p, JSON.stringify(clean, null, 2) + '\n');
  return clean;
}

function dedupe(edges) {
  const seen = new Set();
  return edges.filter((e) => { const k = e.from + '→' + e.to; if (seen.has(k)) return false; seen.add(k); return true; });
}

// 세션이 메시지를 보낼 수 있는지 (메시지 1건 판정용)
function allowed(cfg, from, to) {
  if (!cfg) return null;
  const ids = new Set(cfg.members.map((m) => m.session));
  if (!ids.has(from) || !ids.has(to)) return null; // 하네스 밖은 판정하지 않음
  if (!cfg.edges.length) return true;
  return cfg.edges.some((e) => (e.from === from && e.to === to) || (e.from === to && e.to === from));
}

module.exports = { load, save, configPath, allowed, REL };
