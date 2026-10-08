#!/usr/bin/env node
'use strict';
// Session Flow 터미널 보기: IDE 없이 SSH 터미널에서 하네스 멤버·메시지 흐름·이벤트를 실시간으로 본다.
//   session-flow [작업 폴더]        실시간 화면 (기본: 현재 폴더)
//   session-flow --once [작업 폴더]  한 번 출력하고 끝
// 키: Tab/→ 다음 멤버만 · ← 이전 · a 전체 · q 종료
// 확장과 같은 기록(~/.session-flow)과 하네스 파일(<폴더>/.claude/session-flow.json)을 읽는다.

const fs = require('fs');
const os = require('os');
const path = require('path');
const SRC = path.join(__dirname, '..', 'extension', 'src');
const { readEvents, buildSessions } = require(path.join(SRC, 'store'));
const { scanTranscript, norm } = require(path.join(SRC, 'transcripts'));
const { diffLines } = require(path.join(SRC, 'diff'));
const harness = require(path.join(SRC, 'harness'));

// ── 옵션 ──
const args = process.argv.slice(2);
if (args.includes('-h') || args.includes('--help')) {
  console.log('사용법: session-flow [--once] [--no-color] [--debug] [작업 폴더]\n키: Tab/→ 다음 멤버 · ← 이전 · a 전체 · q 종료');
  process.exit(0);
}
const once = args.includes('--once') || !process.stdout.isTTY;
const color = !args.includes('--no-color') && !process.env.NO_COLOR && !!process.stdout.isTTY;
const folder = path.resolve(args.find((a) => !a.startsWith('-')) || process.cwd()).replace(/[\\/]+$/, '');
const dataDir = process.env.SESSION_FLOW_DIR || path.join(os.homedir(), '.session-flow');
const eventsFile = path.join(dataDir, 'events.jsonl');

// ── 글자 폭 (한글·한자·이모지는 2칸) ──
const wide = (c) => (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff)
  || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1f300 && c <= 0x1faff);
const width = (s) => { let w = 0; for (const ch of String(s)) w += wide(ch.codePointAt(0)) ? 2 : 1; return w; };
function fit(s, w, pad = true) {
  s = String(s == null ? '' : s).replace(/\s+/g, ' ');
  let out = '', cur = 0;
  for (const ch of s) {
    const cw = wide(ch.codePointAt(0)) ? 2 : 1;
    if (cur + cw > w - (width(s) > w ? 1 : 0)) { out += '…'; cur += 1; break; }
    out += ch; cur += cw;
  }
  return pad ? out + ' '.repeat(Math.max(0, w - cur)) : out;
}

// ── 색 ──
const C = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const dim = C('2'), bold = C('1'), green = C('32'), red = C('31'), yellow = C('33'), blue = C('34'), magenta = C('35'), cyan = C('36');
const KIND = { msg: ['보냄', magenta], in: ['받음', blue], block: ['차단', red], edit: ['수정', yellow], sub: ['위임', green] };

// ── 데이터 ──
const lineCache = new Map();
const snapFile = (id, phase) => path.join(dataDir, 'snapshots', `${String(id).replace(/[^A-Za-z0-9_-]/g, '_')}.${phase}`);
const readSnap = (id, phase) => { try { return fs.readFileSync(snapFile(id, phase), 'utf8'); } catch { return ''; } };
function load() {
  const events = readEvents(eventsFile);
  const sessions = buildSessions(events, Date.now(), [folder]).filter((s) => s.folder === folder);
  const byIdx = new Map(events.map((e) => [e._idx, e])); // _idx 는 buildSessions 가 붙인다
  const tr = {};
  const guessDir = (cwd) => path.join(os.homedir(), '.claude', 'projects', String(cwd || '').replace(/[^A-Za-z0-9]/g, '-'));
  for (const s of sessions) {
    let p = s.transcriptPath;
    if (!p || !fs.existsSync(p)) p = [guessDir(folder), guessDir(s.cwd)].map((d) => path.join(d, `${s.id}.jsonl`)).find((c) => fs.existsSync(c));
    const info = scanTranscript(p);
    if (info) tr[s.id] = info;
  }
  const cfg = harness.load(folder);
  const st = harness.viewState({ folder, cfg, sessions, transcripts: tr, norm });
  for (const a of st.activity) {
    if (a.kind !== 'edit') continue;
    let c = lineCache.get(a.idx);
    if (!c) { const e = byIdx.get(a.idx); const d = e && e.tool_use_id ? diffLines(readSnap(e.tool_use_id, 'before'), readSnap(e.tool_use_id, 'after')) : null; c = d ? { add: d.add, del: d.del } : {}; lineCache.set(a.idx, c); }
    Object.assign(a, c);
  }
  st._sessions = sessions;
  return st;
}

// --debug: 멤버별 "작업 중" 판정 근거 (최근 기록 종류와 시각)
function debug() {
  const st = load();
  const t = (ms) => (ms ? new Date(ms).toLocaleTimeString([], { hour12: false }) : '-');
  const out = [`${st.name} 하네스 진단 · 지금 ${t(Date.now())} · 기록 ${eventsFile}`];
  for (const m of st.members) {
    const s = st._sessions.find((x) => x.id === m.sid);
    out.push('', `■ ${m.name}  세션 ${m.sid ? m.sid.slice(0, 8) : '없음'}  작업 중=${m.working}  최근10분=${m.live}`);
    if (!s) continue;
    out.push(`  마지막 질문/받은 메시지 ${t(s.turnAt)} · 마지막 응답 끝(Stop) ${t(s.stopAt)} · 마지막 기록 ${t(s.end)}${s.ended ? ' · 세션 종료됨' : ''}`);
    const recent = s.events.slice(-10).map((e) => `${t(e._t)} ${e.agent_id ? '(sub) ' : ''}${e.kind}${e.tool ? ':' + e.tool : ''}`);
    out.push('  최근 기록: ' + recent.join(' | '));
  }
  console.log(out.join('\n'));
}
if (args.includes('--debug')) { debug(); process.exit(0); }

// ── 화면 ──
const ago = (t) => { if (!t) return ''; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? '방금' : m < 60 ? m + '분 전' : m < 1440 ? Math.round(m / 60) + '시간 전' : Math.round(m / 1440) + '일 전'; };
const hms = (ts) => { const d = new Date(ts); return isNaN(d) ? '        ' : [d.getHours(), d.getMinutes(), d.getSeconds()].map((v) => String(v).padStart(2, '0')).join(':'); };
const base = (f) => String(f || '').split(/[\\/]/).pop();
const key = (s) => String(s || '').trim().toLowerCase();

let S = null, filter = null, seen = null, runners = [];
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
function describe(a, me) {
  const inbound = me && (a.kind === 'msg' || a.kind === 'block') && key(a.to) === key(me);
  const k = a.kind === 'msg' && inbound ? 'in' : a.kind;
  const d = a.kind === 'edit' ? `${a.from} · ${base(a.file)}${a.add == null ? '' : ` +${a.add} −${a.del}`}`
    : a.kind === 'sub' ? `${a.from} · ${a.agent} ${a.n}개`
    : `${a.from} → ${a.to}: ${a.text || ''}`;
  return { k, d };
}
function render() {
  const W = Math.max(60, process.stdout.columns || 100), H = Math.max(20, process.stdout.rows || 40);
  const out = [];
  const rule = dim('─'.repeat(W));
  if (!S) { out.push('불러오는 중…'); return out; }
  const live = S.members.filter((m) => m.working).length;
  const msgs = S.traffic.reduce((a, t) => a + t.count, 0);
  const title = `${bold(S.name + ' 하네스')}  ${dim(`멤버 ${S.members.length}${live ? ` · 작업 중 ${live}` : ''} · 멤버 간 메시지 ${msgs}`)}`;
  out.push(title + ' '.repeat(Math.max(1, W - width(`${S.name} 하네스  멤버 ${S.members.length}${live ? ` · 작업 중 ${live}` : ''} · 멤버 간 메시지 ${msgs}`) - 8)) + dim(hms(Date.now())));
  out.push(rule);
  if (!S.members.length) {
    out.push(`하네스 멤버가 없습니다. (${harness.configPath(folder)})`);
    out.push(dim('IDE의 하네스 화면에서 멤버를 추가하거나, 메인 세션에서 /session-flow:harness 를 실행하세요.'));
  }
  // 멤버
  const nameW = Math.min(16, Math.max(6, ...S.members.map((m) => width(m.name))));
  const roleW = Math.max(10, W - nameW - 30);
  for (const m of S.members) {
    const mark = m.main ? yellow('★') : ' ';
    const nm = filter && key(filter) === key(m.name) ? cyan(bold(fit(m.name, nameW))) : bold(fit(m.name, nameW));
    const status = !m.sid ? red(fit('세션 없음', 10)) : m.working ? green(fit((once ? '●' : SPIN[Math.floor(Date.now() / 120) % SPIN.length]) + ' 작업 중', 10)) : dim(fit('대기', 10));
    const warn = m.sid && !m.named ? red(' 이름 필요') : '';
    out.push(` ${mark} ${nm} ${status} ${fit(m.role || '', roleW - (warn ? 10 : 0))}${warn} ${dim(fit(ago(m.last), 8, false))}`);
  }
  out.push(rule);
  // 흐름: 가장 많이 오간 방향들
  const top = S.traffic.slice().sort((a, b) => b.last - a.last).slice(0, 6);
  if (top.length) {
    const parts = top.map((t) => `${t.from}→${t.to} ${t.count}${t.blocked ? red(` 차단${t.blocked}`) : ''}`);
    out.push(`${dim('흐름')}  ${fit(parts.join(dim(' · ')), W - 6, false)}`);
  }
  // 지금 오가는 메시지 (점이 받는 쪽으로 이동)
  const now = Date.now();
  runners = runners.filter((r) => now - r.t0 < r.ms + 1500);
  const shown = runners.slice(-3);
  if (shown.length) {
    for (const r of shown) {
      const p = Math.min(1, (now - r.t0) / r.ms), L = 18;
      const pos = Math.round(p * (L - 1));
      const track = Array.from({ length: L }, (_, i) => (i === pos ? (r.kind === 'block' && p >= 0.6 ? '✕' : '●') : '─')).join('');
      const lane = r.kind === 'block' && p >= 0.6 ? red(track.slice(0, Math.round(0.6 * L)) + '│') : magenta(track) + '▶';
      out.push(`${dim('지금')}  ${fit(r.from, nameW, false)} ${lane} ${fit(r.to, nameW, false)}  ${dim(fit(`"${r.text}"`, Math.max(10, W - nameW * 2 - 34), false))}`);
    }
  }
  out.push(rule);
  // 이벤트
  const list = (S.activity || []).filter((a) => !filter || key(a.from) === key(filter) || key(a.to) === key(filter));
  out.push(`${bold(filter ? `${filter} 이벤트` : '이벤트')}  ${dim(once ? '' : 'Tab/→ 멤버별 · a 전체 · q 종료')}`);
  const room = Math.max(3, (once ? 40 : H - out.length - 1));
  if (!list.length) out.push(dim('  아직 기록된 메시지·수정이 없습니다.'));
  for (const a of list.slice(0, room)) {
    const { k, d } = describe(a, filter);
    const [label, col] = KIND[k];
    const fresh = now - (freshAt.get(a.idx) || 0) < 8000; // 방금 들어온 줄은 굵게
    const line = ` ${dim(hms(a.ts))}  ${col(label)}  ${fit(d, W - 18, false)}`;
    out.push(fresh ? bold(line) : line);
  }
  return out;
}
const freshAt = new Map();

function refresh() {
  let st;
  try { st = load(); } catch (e) { S = S || { name: path.basename(folder), members: [], traffic: [], activity: [] }; return; }
  const max = (st.activity || []).reduce((a, x) => Math.max(a, x.idx), -1);
  if (seen != null) {
    for (const a of st.activity.filter((x) => x.idx > seen && (x.kind === 'msg' || x.kind === 'block')).reverse()) {
      runners.push({ from: a.from, to: a.to, text: String(a.text || '').replace(/\s+/g, ' ').slice(0, 40), kind: a.kind, t0: Date.now() + runners.length * 300, ms: 1500 });
    }
    for (const a of st.activity.filter((x) => x.idx > seen)) freshAt.set(a.idx, Date.now());
  }
  seen = Math.max(seen == null ? -1 : seen, max);
  S = st;
}

function draw() {
  const lines = render();
  if (once) { process.stdout.write(lines.join('\n') + '\n'); return; }
  process.stdout.write('\x1b[H' + lines.map((l) => l + '\x1b[K').join('\n') + '\x1b[J');
}

refresh();
if (once) { draw(); process.exit(0); }

// ── 실시간 ──
process.stdout.write('\x1b[?1049h\x1b[?25l'); // 대체 화면, 커서 숨김
const restore = () => { process.stdout.write('\x1b[?25h\x1b[?1049l'); };
process.on('exit', restore);
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
process.stdout.on('resize', draw);
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', (b) => {
    const s = b.toString();
    const names = (S && S.members.map((m) => m.name)) || [];
    const i = filter ? names.findIndex((n) => key(n) === key(filter)) : -1;
    if (s === 'q' || s === '\x03') process.exit(0);
    else if (s === 'a' || s === '\x1b') filter = null;
    else if (s === '\t' || s === '\x1b[C') filter = names.length ? names[(i + 1) % names.length] : null;
    else if (s === '\x1b[D' || s === '\x1b[Z') filter = names.length ? names[(i - 1 + names.length) % names.length] : null;
    draw();
  });
}
let pending;
const kick = () => { clearTimeout(pending); pending = setTimeout(() => { refresh(); draw(); }, 200); };
fs.watchFile(eventsFile, { interval: 1000 }, kick);
fs.watchFile(harness.configPath(folder), { interval: 1000 }, kick);
setInterval(() => { if (runners.length || (S && S.members.some((m) => m.working))) draw(); }, 120);   // 점 이동, 작업 중 표시
setInterval(() => { refresh(); draw(); }, 5000);             // /rename 같은 이름 변경, 시간 표시
draw();
