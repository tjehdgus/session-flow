'use strict';
// 하네스 hook 로직: <작업 폴더>/.claude/session-flow.json 을 읽어
//  - 세션 시작/설정 변경 시 "당신의 역할, 메인, 보낼 수 있는 대상"을 세션에 알려주고
//  - 차단 모드(enforce)면 허용되지 않은 세션으로 가는 SendMessage 를 막는다.
// 판정할 수 없는 주소(아직 어느 세션인지 모르는 핸들)는 막지 않는다.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REL = path.join('.claude', 'session-flow.json');

function findConfig(cwd) {
  let dir = cwd ? path.resolve(cwd) : null;
  while (dir) {
    const p = path.join(dir, REL);
    try {
      const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (cfg && Array.isArray(cfg.members)) return { folder: dir, path: p, cfg: { edges: [], enforce: false, ...cfg } };
    } catch { /* 다음 상위 폴더 */ }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

const norm = (s) => String(s || '').trim().replace(/^@/, '').toLowerCase();

function readJson(p, dflt) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return dflt; } }

// 이 세션을 가리키는 것으로 알려진 주소들 (kftc-3f 같은 짧은 이름만; uds 경로는 사람이 읽기 어려워 제외)
function addressesOf(sid, handles) {
  return Object.entries(handles || {}).filter(([h, v]) => v === sid && !/^uds:/.test(h)).map(([h]) => h);
}

function label(m, handles) {
  const addr = addressesOf(m.session, handles);
  return `"${m.name || m.session.slice(0, 8)}"${addr.length ? ` (주소: ${addr.join(', ')})` : ''}`;
}

function contextFor(found, sid, handles) {
  const { cfg } = found;
  const me = cfg.members.find((m) => m.session === sid);
  if (!me) return null;
  const byId = new Map(cfg.members.map((m) => [m.session, m]));
  const main = cfg.members.find((m) => m.main);
  const outs = cfg.edges.filter((e) => e.from === sid).map((e) => byId.get(e.to)).filter(Boolean);
  const ins = cfg.edges.filter((e) => e.to === sid).map((e) => byId.get(e.from)).filter(Boolean);
  const lines = [
    `[Session Flow 하네스 "${cfg.name || path.basename(found.folder)}"]`,
    `이 세션은 ${label(me, handles)} 입니다.${me.main ? ' 이 하네스의 메인(총괄) 세션입니다.' : ''}`,
  ];
  if (me.role) lines.push(`역할: ${me.role}`);
  if (main && !me.main) lines.push(`메인(총괄) 세션: ${label(main, handles)}`);
  const mates = cfg.members.filter((m) => m.session !== sid);
  if (!cfg.edges.length) {
    // 방향을 아직 정하지 않은 하네스: 제한하지 않는다
    if (mates.length) lines.push(`함께 일하는 멤버: ${mates.map((m) => label(m, handles) + (m.role ? ` — ${m.role}` : '')).join(', ')}`);
    lines.push('메시지 방향은 아직 정해지지 않았습니다. 필요한 멤버와 자유롭게 주고받으세요.');
    lines.push('다른 세션에 보낼 때는 SendMessage 를 쓰고, 정확한 주소는 ListAgents 로 확인하세요.');
    return lines.join('\n');
  }
  lines.push(outs.length ? `메시지를 보낼 수 있는 세션: ${outs.map((m) => label(m, handles)).join(', ')}` : '정해진 방향상 이 세션이 먼저 보낼 대상은 없습니다. 받은 메시지에는 답할 수 있습니다.');
  if (ins.length) lines.push(`메시지를 보내올 수 있는 세션: ${ins.map((m) => label(m, handles)).join(', ')}`);
  const others = mates.filter((m) => !outs.includes(m) && !ins.includes(m));
  if (others.length) lines.push(`나머지 멤버(${others.map((m) => `"${m.name || m.session.slice(0, 8)}"`).join(', ')})와는 직접 주고받지 말고${main && !me.main ? ' 메인을 거치세요' : ' 필요한 세션을 거치세요'}.`);
  lines.push('다른 세션에 보낼 때는 SendMessage 를 쓰고, 정확한 주소는 ListAgents 로 확인하세요.');
  if (cfg.enforce) lines.push('(차단 모드: 위 대상이 아닌 세션으로 보내는 메시지는 막힙니다. 받은 메시지에 대한 답장은 허용됩니다.)');
  return lines.join('\n');
}

function configHash(found, handles, sid) {
  return crypto.createHash('sha1').update(JSON.stringify([found.cfg, addressesOf(sid, handles)])).digest('hex').slice(0, 12);
}

// 받는 주소 → 세션 ID (모르면 null)
function resolveRecipient(cfg, recipient, handles) {
  const r = norm(recipient);
  if (!r) return null;
  for (const m of cfg.members) {
    if (norm(m.name) === r || norm(m.session) === r) return m.session;
  }
  for (const [h, sid] of Object.entries(handles || {})) {
    if (norm(h) === r) return sid;
  }
  return null;
}

function checkSend(found, sid, recipient, handles) {
  const { cfg } = found;
  if (!cfg.enforce || !cfg.edges.length) return { ok: true }; // 방향을 안 정했으면 막지 않음
  const me = cfg.members.find((m) => m.session === sid);
  if (!me) return { ok: true }; // 하네스 밖 세션은 관여하지 않음
  const to = resolveRecipient(cfg, recipient, handles);
  if (!to) return { ok: true, unverified: true };
  if (cfg.edges.some((e) => e.from === sid && e.to === to)) return { ok: true, to };
  // 상대가 나에게 보낼 수 있는 방향이면 답장은 허용 (지시 → 보고 흐름이 끊기지 않게)
  if (cfg.edges.some((e) => e.from === to && e.to === sid)) return { ok: true, to, reply: true };
  const byId = new Map(cfg.members.map((m) => [m.session, m]));
  const allowedTo = cfg.edges.filter((e) => e.from === sid).map((e) => byId.get(e.to)).filter(Boolean);
  const target = byId.get(to);
  return {
    ok: false,
    to,
    reason: `Session Flow 하네스 규칙상 이 세션에서 ${target ? `"${target.name || to.slice(0, 8)}"` : '그 세션'}(으)로는 직접 보낼 수 없습니다. `
      + (allowedTo.length ? `보낼 수 있는 대상: ${allowedTo.map((m) => label(m, handles)).join(', ')}.` : '이 세션은 다른 세션에 직접 보내지 않도록 설정되어 있습니다.')
      + ' 필요하면 메인 세션을 거쳐 전달하세요.',
  };
}

module.exports = { findConfig, contextFor, configHash, checkSend, resolveRecipient, readJson };
