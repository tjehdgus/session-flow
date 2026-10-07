// 기록 화면(timeline.js)을 jsdom 으로 렌더링해 턴 카드·필터·diff 열기를 확인한다.
'use strict';
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const { timelineHtml } = require(path.join(root, 'extension/src/timeline'));
const { buildSessions, sessionTurns } = require(path.join(root, 'extension/src/store'));

let JSDOM;
try { ({ JSDOM } = require(process.env.JSDOM_PATH || 'jsdom')); } catch { /* optional */ }
const html = timelineHtml();
assert.ok(!/ style="/.test(html), 'CSP: 인라인 style 금지');
if (!JSDOM) { new Function(html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1]); console.log('(jsdom 없음: 문법만 확인)'); process.exit(0); }

const t0 = Date.parse('2026-10-07T01:00:00Z');
const ts = (m) => new Date(t0 + m * 60000).toISOString();
const ev = [
  { ts: ts(0), session_id: 'S', kind: 'session_start', cwd: '/k' },
  { ts: ts(1), session_id: 'S', kind: 'prompt', summary: '로더 고쳐줘', detail: '로더 고쳐줘' },
  { ts: ts(2), session_id: 'S', kind: 'tool', tool: 'Bash', summary: 'pytest -q' },
  { ts: ts(3), session_id: 'S', kind: 'tool', tool: 'Edit', file: '/k/a.py', summary: 'a.py', has_before: true, has_after: true },
  { ts: ts(4), session_id: 'S', kind: 'tool_error', tool: 'Bash', summary: 'exit 1' },
  { ts: ts(5), session_id: 'S', kind: 'message_in', target: '메인', summary: '지표 보내줘', detail: '지표 보내줘' },
  { ts: ts(6), session_id: 'S', kind: 'message', target: 'RAG', summary: '<b>직접</b>', blocked: true },
];
const [s] = buildSessions(ev.map((e, i) => ({ ...e, _idx: i })), t0 + 7 * 60000);
const turns = sessionTurns(s);
assert.strictEqual(turns.length, 2);

const posted = [];
const dom = new JSDOM(html, { runScripts: 'dangerously', beforeParse(w) { w.acquireVsCodeApi = () => ({ postMessage: (m) => posted.push(m) }); } });
const w = dom.window, D = w.document;
assert.ok(posted.some((m) => m.type === 'ready'));
w.dispatchEvent(new w.MessageEvent('message', { data: { type: 'session', session: { id: 'S', title: 'GNN', role: 'GNN 학습', live: true, eventCount: 7, fileCount: 1, turns }, sessions: [{ id: 'S', title: 'GNN', live: true }, { id: 'T', title: '메인', live: false }] } }));

const cards = () => [...D.querySelectorAll('.turn')];
assert.strictEqual(D.getElementById('title').textContent, 'GNN');
assert.ok(D.getElementById('meta').textContent.includes('역할: GNN 학습'));
assert.strictEqual(cards().length, 2);
assert.ok(cards()[0].classList.contains('in'), '최신(받은 메시지)이 위');
assert.ok(cards()[0].textContent.includes('보냄 1 (차단 1)'));
assert.ok(cards()[1].textContent.includes('Bash 2') && cards()[1].textContent.includes('파일 1개 수정') && cards()[1].textContent.includes('실패 1'));
assert.strictEqual(D.querySelectorAll('.turn b').length, 0, 'XSS-safe');
// 수정 행 → diff 열기
[...D.querySelectorAll('.it.edit')][0].click();
assert.strictEqual(posted.pop().idx, 3);
// 명령 행 → 상세 펼침
[...D.querySelectorAll('.it.bash')][0].click();
assert.ok(D.querySelector('.det').textContent.includes('pytest'));
// 필터
D.querySelector('[data-f=edit]').click();
assert.strictEqual(cards().length, 1);
D.querySelector('[data-f=msg]').click();
assert.strictEqual(cards().length, 1);
D.querySelector('[data-f=all]').click();
// 카드 접기
cards()[1].querySelector('.th').click();
assert.strictEqual(cards()[1].querySelector('.tb'), null);
// 세션 바꾸기
const p = D.getElementById('picker'); p.value = 'T'; p.dispatchEvent(new w.Event('change'));
assert.deepStrictEqual({ ...posted.pop() }, { type: 'select', id: 'T' });
console.log('OK — timeline: turn cards newest-first, chips, diff open, detail, filters, collapse, picker');
