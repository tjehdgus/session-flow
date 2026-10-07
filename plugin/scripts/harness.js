'use strict';
// 하네스 hook 로직 (v2: 멤버 = 세션 이름)
//
// <작업 폴더>/.claude/session-flow.json
// {
//   "version": 2, "name": "kftc", "enforce": false,
//   "members": [ { "name": "메인 핸들러", "role": "총괄", "main": true, "session": "<선택: 세션 ID>" } ],
//   "edges":   [ { "from": "메인 핸들러", "to": "GNN" } ],
//   "layout":  { "GNN": { "x": 0, "y": 0 } }
// }
// 멤버 이름은 그 세션의 /rename 이름이자 SendMessage 수신 주소다. 그래서 주소를 추측할 필요가 없다.
//  - 세션 시작/설정 변경 시: 이 세션의 역할, 메인, 보낼 수 있는 대상(이름)을 안내
//  - 차단 모드: 정한 방향(또는 그 답장)이 아닌 멤버/하네스 밖으로 보내는 SendMessage 를 거부
//    어느 세션인지 모르는 주소는 막지 않는다.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REL = path.join('.claude', 'session-flow.json');
const key = (s) => String(s || '').trim().replace(/^@/, '').toLowerCase();

function readJson(p, dflt) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return dflt; } }

// v1(세션 ID 기반) 설정을 v2(이름 기반)로
function normalize(cfg) {
  const members = (cfg.members || []).map((m) => ({ ...m, name: (m.name || '').trim() || (m.session ? m.session.slice(0, 8) : '') }));
  const nameOf = (x) => { const m = members.find((mm) => mm.session === x || key(mm.name) === key(x)); return m ? m.name : x; };
  const edges = (cfg.edges || []).map((e) => ({ from: nameOf(e.from), to: nameOf(e.to) }));
  const layout = {};
  for (const [k, v] of Object.entries(cfg.layout || {})) layout[nameOf(k)] = v;
  return { version: 2, name: cfg.name || '', enforce: !!cfg.enforce, members, edges, layout };
}

function findConfig(cwd) {
  let dir = cwd ? path.resolve(cwd) : null;
  while (dir) {
    const p = path.join(dir, REL);
    const cfg = readJson(p, null);
    if (cfg && Array.isArray(cfg.members)) return { folder: dir, path: p, cfg: normalize(cfg) };
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

// 세션의 /rename 이름: transcript 의 custom-title 레코드. 큰 파일을 매번 읽지 않도록 이어 읽기 캐시.
function sessionName(sid, transcriptPath, cacheFile) {
  if (!sid) return '';
  const cache = cacheFile ? readJson(cacheFile, {}) : {};
  let c = cache[sid] || { path: transcriptPath, offset: 0, title: '' };
  const p = transcriptPath || c.path;
  if (!p) return c.title || '';
  if (c.path !== p) c = { path: p, offset: 0, title: c.title || '' };
  try {
    const size = fs.statSync(p).size;
    if (size < c.offset) c.offset = 0;
    if (size > c.offset) {
      const fd = fs.openSync(p, 'r');
      const len = Math.min(size - c.offset, 64 * 1024 * 1024);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, c.offset);
      fs.closeSync(fd);
      const text = buf.toString('utf8');
      const lastNl = text.lastIndexOf('\n');
      const body = lastNl >= 0 ? text.slice(0, lastNl) : '';
      for (const line of body.split('\n')) {
        if (!line.includes('"custom-title"')) continue;
        try { const o = JSON.parse(line); if (o.type === 'custom-title' && o.customTitle) c.title = String(o.customTitle).trim(); } catch { /* ignore */ }
      }
      c.offset += Buffer.byteLength(body) + (lastNl >= 0 ? 1 : 0);
    }
  } catch { /* 파일 없음 */ }
  if (cacheFile) { cache[sid] = c; try { fs.writeFileSync(cacheFile, JSON.stringify(cache)); } catch { /* ignore */ } }
  return c.title || '';
}

// 이 세션이 어느 멤버인가: 설정에 세션 ID 가 적혀 있거나, /rename 이름이 멤버 이름과 같으면
function whoAmI(cfg, sid, myName) {
  return cfg.members.find((m) => m.session && m.session === sid)
    || (myName ? cfg.members.find((m) => key(m.name) === key(myName)) : undefined);
}

function contextFor(found, me, myName) {
  const { cfg } = found;
  if (!me) return null;
  const main = cfg.members.find((m) => m.main);
  const mates = cfg.members.filter((m) => m !== me);
  const outs = cfg.edges.filter((e) => key(e.from) === key(me.name)).map((e) => e.to);
  const ins = cfg.edges.filter((e) => key(e.to) === key(me.name)).map((e) => e.from);
  const q = (n) => `"${n}"`;
  const lines = [
    `[Session Flow 하네스 "${cfg.name || path.basename(found.folder)}"]`,
    `이 세션은 ${q(me.name)} 입니다.${me.main ? ' 이 하네스의 메인(총괄) 세션입니다.' : ''}`,
  ];
  if (me.role) lines.push(`역할: ${me.role}`);
  if (main && main !== me) lines.push(`메인(총괄): ${q(main.name)}`);
  if (mates.length) lines.push(`멤버: ${mates.map((m) => q(m.name) + (m.role ? ` — ${m.role}` : '')).join(', ')}`);
  if (!cfg.edges.length) {
    lines.push('메시지 방향은 아직 정해지지 않았습니다. 필요한 멤버와 자유롭게 주고받으세요.');
  } else {
    lines.push(outs.length ? `먼저 보낼 수 있는 대상: ${outs.map(q).join(', ')}` : '정해진 방향상 먼저 보낼 대상은 없습니다. 받은 메시지에는 답할 수 있습니다.');
    if (ins.length) lines.push(`보내올 수 있는 세션: ${ins.map(q).join(', ')} (받은 메시지에는 답할 수 있습니다)`);
    const others = mates.filter((m) => !outs.some((o) => key(o) === key(m.name)) && !ins.some((i) => key(i) === key(m.name)));
    if (others.length) lines.push(`${others.map((m) => q(m.name)).join(', ')} 와(과)는 직접 주고받지 말고 ${main && main !== me ? '메인을' : '필요한 멤버를'} 거치세요.`);
    if (cfg.enforce) lines.push('(차단 모드: 위 방향 밖으로 보내는 메시지는 막힙니다.)');
  }
  lines.push('다른 세션에 보낼 때는 SendMessage 의 수신자로 위 이름을 그대로 쓰세요.');
  if (key(myName) !== key(me.name)) {
    lines.push(`참고: 이 세션의 이름이 아직 ${q(me.name)} 로 설정되지 않아 다른 세션이 이 이름으로 보낼 수 없습니다. 사용자에게 이 세션에서 /rename ${me.name} 을 실행해 달라고 알려주세요.`);
  }
  return lines.join('\n');
}

function configHash(found, me, myName) {
  return crypto.createHash('sha1').update(JSON.stringify([found.cfg, me && me.name, myName])).digest('hex').slice(0, 12);
}

// 받는 주소 → 멤버 (멤버면 member, 하네스 밖으로 확인되면 'outside', 모르면 null)
function resolveRecipient(cfg, recipient, { addrs = {}, names = {} } = {}) {
  const r = key(recipient);
  if (!r) return null;
  const byName = cfg.members.find((m) => key(m.name) === r);
  if (byName) return byName;
  let addr = String(recipient).trim().replace(/^@/, '');
  if (/^\//.test(addr) && /\.sock$/.test(addr)) addr = 'uds:' + addr;
  const sid = addrs[addr];
  if (sid) {
    const m = cfg.members.find((mm) => mm.session === sid) || cfg.members.find((mm) => names[sid] && key(mm.name) === key(names[sid]));
    return m || 'outside';
  }
  return null;
}

function checkSend(found, me, recipient, lookups) {
  const { cfg } = found;
  if (!cfg.enforce || !cfg.edges.length || !me) return { ok: true };
  const t = resolveRecipient(cfg, recipient, lookups);
  if (!t) return { ok: true, unverified: true };
  const allowedOut = cfg.edges.filter((e) => key(e.from) === key(me.name)).map((e) => e.to);
  if (t === 'outside') {
    return { ok: false, reason: `Session Flow 하네스 규칙상 하네스 멤버가 아닌 세션으로는 보낼 수 없습니다. ${allowedOut.length ? `보낼 수 있는 대상: ${allowedOut.map((n) => `"${n}"`).join(', ')}.` : ''}`.trim() };
  }
  const ok = cfg.edges.some((e) => (key(e.from) === key(me.name) && key(e.to) === key(t.name)) || (key(e.from) === key(t.name) && key(e.to) === key(me.name)));
  if (ok) return { ok: true, to: t.name };
  return {
    ok: false,
    to: t.name,
    reason: `Session Flow 하네스 규칙상 이 세션에서 "${t.name}"(으)로는 직접 보낼 수 없습니다. `
      + (allowedOut.length ? `보낼 수 있는 대상: ${allowedOut.map((n) => `"${n}"`).join(', ')}.` : '이 세션은 먼저 보낼 대상이 없습니다.')
      + ' 필요하면 메인을 거쳐 전달하세요.',
  };
}

module.exports = { findConfig, normalize, sessionName, whoAmI, contextFor, configHash, checkSend, resolveRecipient, readJson, REL };
