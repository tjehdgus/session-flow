// 여러 세션이 메시지를 주고받는 시나리오로 그래프 생성을 확인한다
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const recorder = path.join(root, 'plugin/scripts/record.js');
const { readEvents, buildSessions, buildGraph, groupByFolder } = require(path.join(root, 'extension/src/store'));
const { scanTranscript, norm } = require(path.join(root, 'extension/src/transcripts'));
const { graphHtml } = require(path.join(root, 'extension/src/graph'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'session-flow-graph-'));
const dataDir = path.join(tmp, 'data');
const cwd = path.join(tmp, 'kftc');
fs.mkdirSync(cwd);

const A = 'aa11-main', B = '3f22-gnn', C = 'cc33-rag';
const trB = path.join(tmp, 'B.jsonl');
const trC = path.join(tmp, 'C.jsonl');
fs.writeFileSync(trB, [
  JSON.stringify({ type: 'user', message: { content: 'hi' } }),
  JSON.stringify({ type: 'custom-title', customTitle: 'GNN', sessionId: B }),
].join('\n') + '\n');
// C 는 hook 으로는 메시지를 못 받았고 transcript 에만 남아 있는 경우
fs.writeFileSync(trC, [
  JSON.stringify({ type: 'custom-title', customTitle: 'RAG 및 LLM', sessionId: C }),
  JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: '<cross-session-message from="uds:/tmp/claude/kftc-aa.sock">[메인→RAG] 리트리버 벤치마크 결과 공유해줘</cross-session-message>' }] } }),
].join('\n') + '\n');

const send = (sid, tp, o) => execFileSync('node', [recorder], {
  input: JSON.stringify({ session_id: sid, cwd, transcript_path: tp, ...o }),
  env: { ...process.env, SESSION_FLOW_DIR: dataDir },
});

send(A, '/nope/A.jsonl', { hook_event_name: 'SessionStart', source: 'startup' });
send(B, trB, { hook_event_name: 'SessionStart', source: 'resume' });
send(C, trC, { hook_event_name: 'SessionStart', source: 'resume' });
send(A, '/nope/A.jsonl', { hook_event_name: 'UserPromptSubmit', prompt: '역할 나눠서 진행해줘' });

// A → B (핸들 kftc-3f), B 쪽엔 프롬프트로 도착
send(A, '/nope/A.jsonl', { hook_event_name: 'PreToolUse', tool_name: 'SendMessage', tool_use_id: 't1', tool_input: { to: 'kftc-3f', message: '[종괄 → GNN] 926fa12 확인했습니다. 캐시 생성 승인합니다.' } });
send(B, trB, { hook_event_name: 'UserPromptSubmit', prompt: '<cross-session-message from="uds:/tmp/claude/kftc-aa.sock">\n[종괄 → GNN] 926fa12 확인했습니다. 캐시 생성 승인합니다.\n</cross-session-message>' });
// B → A 답장 (핸들 kftc-aa 는 위 수신 기록으로 학습됨)
send(B, trB, { hook_event_name: 'PreToolUse', tool_name: 'SendMessage', tool_use_id: 't2', tool_input: { to: 'kftc-aa', message: '캐시 생성 시작했습니다. 1시간 정도 걸립니다.' } });
send(B, trB, { hook_event_name: 'PreToolUse', tool_name: 'SendMessage', tool_use_id: 't3', tool_input: { to: 'kftc-aa', message: '학습 끝났습니다. 지표 공유합니다.' } });
// A → C (핸들 kftc-c9: 접두가 세션 ID 와 안 맞음, transcript 내용으로 학습)
send(A, '/nope/A.jsonl', { hook_event_name: 'PreToolUse', tool_name: 'SendMessage', tool_use_id: 't4', tool_input: { to: 'kftc-c9', message: '[메인→RAG] 리트리버 벤치마크 결과 공유해줘' } });
// A → 아무도 모르는 세션
send(A, '/nope/A.jsonl', { hook_event_name: 'PreToolUse', tool_name: 'SendMessage', tool_use_id: 't5', tool_input: { to: 'tta-zz', message: 'TTA 문서 검토 부탁해' } });
// 서브에이전트
send(A, '/nope/A.jsonl', { hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 't6', tool_input: { subagent_type: 'Explore', description: '코드 위치 찾기', prompt: '라벨 규칙 코드 찾아줘' } });
send(A, '/nope/A.jsonl', { hook_event_name: 'SubagentStart', agent_id: 'ag1', agent_type: 'Explore' });
send(A, '/nope/A.jsonl', { hook_event_name: 'PostToolUse', agent_id: 'ag1', agent_type: 'Explore', tool_name: 'Grep', tool_use_id: 't7', tool_input: { pattern: 'label_rule' } });
send(A, '/nope/A.jsonl', { hook_event_name: 'SubagentStop', agent_id: 'ag1', agent_type: 'Explore', last_assistant_message: 'account_pipeline.py 에 있습니다' });

// A 가 파일을 두 번 수정
const tf = path.join(cwd, 'pipeline.py');
fs.writeFileSync(tf, 'def label(x):\n    return x.role\n\ndef train():\n    pass\n');
send(A, '/nope/A.jsonl', { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_use_id: 'e1', tool_input: { file_path: tf, old_string: 'x.role', new_string: 'x.check' } });
fs.writeFileSync(tf, 'def label(x):\n    return x.check\n\ndef train():\n    pass\n');
send(A, '/nope/A.jsonl', { hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_use_id: 'e1', tool_input: { file_path: tf, old_string: 'x.role', new_string: 'x.check' } });
send(A, '/nope/A.jsonl', { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_use_id: 'e2', tool_input: { file_path: tf } });
fs.writeFileSync(tf, 'def label(x):\n    return x.check\n\ndef train(rule=None):\n    pass\n');
send(A, '/nope/A.jsonl', { hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_use_id: 'e2', tool_input: { file_path: tf } });

// 빈 세션(재개만 하고 아무것도 안 함) — 그래프에서 숨김
send('ee55-empty', '/nope/E.jsonl', { hook_event_name: 'SessionStart', source: 'resume' });
send('ee55-empty', '/nope/E.jsonl', { hook_event_name: 'Stop' });
// 다른 폴더의 세션
const other = path.join(tmp, 'other'); fs.mkdirSync(other);
execFileSync('node', [recorder], { input: JSON.stringify({ session_id: 'oo99', cwd: other, hook_event_name: 'UserPromptSubmit', prompt: '다른 프로젝트 작업' }), env: { ...process.env, SESSION_FLOW_DIR: dataDir } });
// 이전 버전 플러그인이 남긴 기록: 받은 메시지가 그냥 prompt 로 저장됨
fs.appendFileSync(path.join(dataDir, 'events.jsonl'), JSON.stringify({ v: 1, ts: new Date().toISOString(), session_id: C, cwd, kind: 'prompt', summary: '<cross-session-message from="uds:x">옛날 형식 메시지', detail: '<cross-session-message from="uds:x">옛날 형식 메시지</cross-session-message>' }) + '\n');

const events = readEvents(path.join(dataDir, 'events.jsonl'));
const sessions = buildSessions(events, Date.now(), [cwd]);
assert.strictEqual(sessions.length, 5);
const groups = groupByFolder(sessions);
assert.strictEqual(groups.length, 2);
assert.strictEqual(groups.find((x) => x.folder === cwd).sessions.length, 4);
const sB = sessions.find((x) => x.id === B);
assert.ok(sB.events.some((e) => e.kind === 'message_in' && e.target === 'uds:/tmp/claude/kftc-aa.sock'), 'cross-session-message 는 message_in');
const sC = sessions.find((x) => x.id === C);
assert.ok(sC.events.some((e) => e.kind === 'message_in' && e.detail === '옛날 형식 메시지'), '옛 기록도 message_in 으로 변환');
assert.ok(!sC.title.includes('cross-session'), '받은 메시지가 세션 제목이 되지 않음');
const transcripts = {};
for (const s of sessions) { const t = scanTranscript(s.transcriptPath); if (t) transcripts[s.id] = t; }
assert.strictEqual(transcripts[B].title, 'GNN');
assert.strictEqual(transcripts[C].received.length, 1);

const g = buildGraph(sessions, { folder: cwd, transcripts, norm, names: { [A]: '메인 핸들러' } });
assert.ok(!g.nodes.some((n) => n.id === 'ee55-empty'), '빈 세션 숨김');
assert.ok(!g.nodes.some((n) => n.id === 'oo99'), '다른 폴더 세션 제외');
const label = (id) => g.nodes.find((n) => n.id === id).label;
const edge = (f, t) => g.edges.find((e) => e.from === f && e.to === t);

assert.strictEqual(label(A), '메인 핸들러');          // 수동 이름
assert.strictEqual(label(B), 'GNN');                  // transcript 제목
assert.strictEqual(label(C), 'RAG 및 LLM');
assert.strictEqual(g.learned['kftc-3f'], B);
assert.strictEqual(g.learned['uds:/tmp/claude/kftc-aa.sock'], A);
assert.strictEqual(g.learned['kftc-c9'], C);
assert.strictEqual(edge(A, B).count, 1);
assert.strictEqual(edge(B, A).count, 2);              // 왕복
assert.strictEqual(edge(A, C).count, 1);
assert.ok(edge(A, '@tta-zz'), '모르는 핸들은 유령 노드로');
assert.strictEqual(g.nodes.find((n) => n.id === '@tta-zz').kind, 'ghost');
assert.ok(!g.edges.some((e) => e.from === B && e.to === B), '받은 메시지가 중복 엣지가 되지 않음');
assert.ok(edge(A, B).active);

// 변경된 파일: 세션 전체 누적 diff
const nA = g.nodes.find((n) => n.id === A);
assert.strictEqual(nA.changedFiles.length, 1);
assert.strictEqual(nA.changedFiles[0].edits, 2);
const { diffLines } = require(path.join(root, 'extension/src/diff'));
const snap = (id, ph) => fs.readFileSync(path.join(dataDir, 'snapshots', id + '.' + ph), 'utf8');
const cum = diffLines(snap('e1', 'before'), snap('e2', 'after'));
assert.strictEqual(cum.add, 2); assert.strictEqual(cum.del, 2);
const one = diffLines(snap('e2', 'before'), snap('e2', 'after'));
assert.strictEqual(one.add, 1); assert.strictEqual(one.del, 1);

// 수동 연결이 학습보다 우선
const g2 = buildGraph(sessions, { folder: cwd, transcripts, norm, aliases: { 'tta-zz': C } });
assert.strictEqual(g2.edges.find((e) => e.from === A && e.to === C).count, 2);
assert.ok(!g2.nodes.some((n) => n.id === '@tta-zz'));
const gx = g2.nodes.find((n) => n.id === '@uds:x');
assert.ok(gx && gx.label === '@x', '보낸 쪽을 모르는 메시지는 짧은 이름의 유령 노드');

// 서브에이전트 표시
const g3 = buildGraph(sessions, { folder: cwd, transcripts, norm, showSubagents: true });
const sub = g3.nodes.find((n) => n.kind === 'subagent');
assert.ok(sub && sub.label === 'Explore');
assert.ok(g3.edges.find((e) => e.from === A && e.to === sub.id));
assert.ok(g3.edges.find((e) => e.from === sub.id && e.to === A));

// webview 를 jsdom 으로 실제 렌더링 (jsdom 이 있으면)
let JSDOM;
try { ({ JSDOM } = require(process.env.JSDOM_PATH || 'jsdom')); } catch { /* optional */ }
if (JSDOM) {
  const posted = [];
  const html = graphHtml();
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(win) {
      win.acquireVsCodeApi = () => ({ postMessage: (m) => posted.push(m) });
      win.HTMLElement.prototype.setPointerCapture = () => {};
    },
  });
  const w = dom.window;
  assert.ok(posted.some((m) => m.type === 'ready'));
  w.dispatchEvent(new w.MessageEvent('message', { data: { type: 'graph', graph: { nodes: g3.nodes, edges: g3.edges }, positions: {}, options: { showSubagents: true, windowHours: 24 } } }));
  const nodeEls = w.document.querySelectorAll('.node');
  assert.strictEqual(nodeEls.length, g3.nodes.length);
  assert.strictEqual(w.document.querySelectorAll('line.edge-line').length, g3.edges.length);
  assert.strictEqual(w.document.querySelectorAll('line.edge-line.active').length >= 1, true);
  // 노드 클릭 → 상세 패널
  const target = [...nodeEls].find((e) => e.textContent.includes('GNN'));
  target.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 10 }));
  target.dispatchEvent(new w.MouseEvent('pointerup', { bubbles: true, button: 0, clientX: 10, clientY: 10 }));
  assert.strictEqual(w.document.querySelector('#side h2').textContent, 'GNN', '노드 클릭 → 그 세션 상세');
  // 화살표 클릭 → 메시지 내역
  w.document.querySelector('line.edge-hit').dispatchEvent(new w.Event('click', { bubbles: true }));
  assert.ok(w.document.querySelectorAll('#side .msg').length >= 1);
  // 노드 → 변경된 파일 → diff
  const aEl = [...w.document.querySelectorAll('.node')].find((e) => e.textContent.includes('메인 핸들러') || e.dataset.id === A);
  aEl.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 10 }));
  aEl.dispatchEvent(new w.MouseEvent('pointerup', { bubbles: true, button: 0, clientX: 10, clientY: 10 }));
  const fileBtn = w.document.querySelector('#side .fl');
  assert.ok(fileBtn, '변경된 파일 목록');
  fileBtn.dispatchEvent(new w.Event('click', { bubbles: true }));
  const req = posted.filter((m) => m.type === 'diff').pop();
  assert.ok(req && req.first !== req.last, '누적 diff 요청');
  assert.ok(w.document.getElementById('side').textContent.includes('불러오는 중'));
  w.dispatchEvent(new w.MessageEvent('message', { data: { type: 'diffResult', key: req.key, diff: { file: tf, ...cum, from: 'x', to: 'y' } } }));
  assert.strictEqual(w.document.querySelectorAll('#side .dl.add').length, 2);
  assert.strictEqual(w.document.querySelectorAll('#side .dl.del').length, 2);
  assert.ok(w.document.getElementById('side').classList.contains('wide'));
  // 그래프가 갱신돼도 diff 화면 유지
  w.dispatchEvent(new w.MessageEvent('message', { data: { type: 'graph', graph: { nodes: g3.nodes, edges: g3.edges }, positions: {}, options: { showSubagents: true, windowHours: 24 } } }));
  assert.strictEqual(w.document.querySelectorAll('#side .dl.add').length, 2);
  w.document.querySelector('#side .back').dispatchEvent(new w.Event('click', { bubbles: true }));
  assert.ok(w.document.querySelector('#side .fl'), '돌아가기 → 세션 상세');
  // 텍스트는 마크업으로 해석되지 않아야 함
  w.dispatchEvent(new w.MessageEvent('message', { data: { type: 'graph', graph: { nodes: [{ ...g3.nodes[0], label: '<img src=x onerror=alert(1)>' }], edges: [] }, positions: {}, options: { showSubagents: false, windowHours: 24 } } }));
  assert.strictEqual(w.document.querySelectorAll('#nodes img').length, 0);
  console.log('jsdom render OK');
} else {
  new Function(graphHtml().match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1]);
  console.log('(jsdom 없음: 스크립트 문법만 확인)');
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`OK — nodes: ${g.nodes.map((n) => n.label).join(', ')} | edges: ${g.edges.map((e) => `${label(e.from)}→${label(e.to)}(${e.count})`).join(', ')}`);
