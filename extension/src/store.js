'use strict';
// events.jsonl → 세션/에이전트 구조로 변환하는 순수 함수 모음 (vscode 의존 없음, 단독 테스트 가능)

const fs = require('fs');
const path = require('path');

const LIVE_WINDOW_MS = 10 * 60 * 1000;

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

function buildSessions(events, now = Date.now()) {
  const sessions = new Map();
  events.forEach((e, idx) => {
    if (!e || !e.session_id) return;
    e._idx = idx;
    e._t = Date.parse(e.ts) || 0;
    let s = sessions.get(e.session_id);
    if (!s) {
      s = {
        id: e.session_id, cwd: e.cwd, start: e._t, end: e._t, title: undefined,
        ended: false, events: [], agents: new Map(), editCount: 0, files: new Set(),
      };
      s.agents.set('main', { id: 'main', type: 'Main', events: [], start: e._t, end: e._t });
      sessions.set(e.session_id, s);
    }
    s.events.push(e);
    s.start = Math.min(s.start, e._t);
    s.end = Math.max(s.end, e._t);
    if (!s.title && e.kind === 'prompt' && !e.agent_id) s.title = e.summary;
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
    if (!s.title) s.title = s.cwd ? path.basename(s.cwd) : s.id.slice(0, 8);
  }
  return [...sessions.values()].sort((a, b) => b.end - a.end);
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
    id: s.id, title: s.title, cwd: s.cwd, live: s.live,
    start: new Date(s.start).toISOString(), end: new Date(s.end).toISOString(),
    eventCount: s.events.length, editCount: s.editCount, fileCount: s.files.size, lanes,
  };
}

module.exports = { readEvents, buildSessions, sessionView };
