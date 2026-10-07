// hook 기록 → 세션 빌드까지 한 번에 확인하는 스모크 테스트
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const recorder = path.join(root, 'plugin/scripts/record.js');
const { readEvents, buildSessions, sessionView } = require(path.join(root, 'extension/src/store'));
const { timelineHtml } = require(path.join(root, 'extension/src/timeline'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'session-flow-'));
const dataDir = path.join(tmp, 'data');
const proj = path.join(tmp, 'proj');
fs.mkdirSync(proj);
const target = path.join(proj, 'retriever.py');
fs.writeFileSync(target, 'def retrieve(query):\n    return db.search(query)\n');

const S = 'sess-1';
const common = { session_id: S, cwd: proj, transcript_path: '/x.jsonl', permission_mode: 'default' };
const send = (o) => execFileSync('node', [recorder], {
  input: JSON.stringify({ ...common, ...o }),
  env: { ...process.env, SESSION_FLOW_DIR: dataDir },
});

send({ hook_event_name: 'SessionStart', source: 'startup' });
send({ hook_event_name: 'UserPromptSubmit', prompt: 'retriever에 top-k 추가해줘' });
send({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 'toolu_A', tool_input: { subagent_type: 'Explore', description: '검색 위치 찾기', prompt: 'similarity_search 호출 위치를 모두 찾아줘' } });
send({ hook_event_name: 'SubagentStart', agent_id: 'ag-1', agent_type: 'Explore' });
send({ hook_event_name: 'PostToolUse', agent_id: 'ag-1', agent_type: 'Explore', tool_name: 'Grep', tool_use_id: 'toolu_G', tool_input: { pattern: 'db.search' }, tool_response: { content: 'retriever.py:2' } });
send({ hook_event_name: 'SubagentStop', agent_id: 'ag-1', agent_type: 'Explore', last_assistant_message: 'retriever.py 2번째 줄 한 곳입니다.' });
send({ hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_use_id: 'toolu_A', tool_input: { subagent_type: 'Explore' }, tool_response: { content: [{ type: 'text', text: 'retriever.py 2번째 줄' }] } });

const editInput = { file_path: target, old_string: 'def retrieve(query):', new_string: 'def retrieve(query, k=5):' };
send({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_use_id: 'toolu_E', tool_input: editInput });
fs.writeFileSync(target, 'def retrieve(query, k=5):\n    return db.search(query)[:k]\n');
send({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_use_id: 'toolu_E', tool_input: editInput, tool_response: { success: true } });

const newFile = path.join(proj, 'test_retriever.py');
send({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_use_id: 'toolu_W', tool_input: { file_path: newFile, content: 'x' } });
fs.writeFileSync(newFile, 'def test_k():\n    assert True\n');
send({ hook_event_name: 'PostToolUse', tool_name: 'Write', tool_use_id: 'toolu_W', tool_input: { file_path: newFile, content: 'x' } });

send({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'toolu_B', tool_input: { command: 'pytest -q' }, tool_response: { stdout: '2 passed', stderr: '' } });
send({ hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_use_id: 'toolu_F', tool_input: { command: 'ruff .' }, error: 'command not found: ruff' });
send({ hook_event_name: 'Stop' });
send({ hook_event_name: 'NotARealEvent' });
execFileSync('node', [recorder], { input: 'not json', env: { ...process.env, SESSION_FLOW_DIR: dataDir } }); // 깨진 입력도 exit 0

// 검증
const events = readEvents(path.join(dataDir, 'events.jsonl'));
const kinds = events.map((e) => e.kind);
assert.deepStrictEqual(kinds, ['session_start', 'prompt', 'delegate', 'subagent_start', 'tool', 'subagent_stop', 'tool', 'tool', 'tool', 'tool', 'tool_error', 'stop']);

const snap = (id, p) => fs.readFileSync(path.join(dataDir, 'snapshots', `${id}.${p}`), 'utf8');
assert.match(snap('toolu_E', 'before'), /def retrieve\(query\):/);
assert.match(snap('toolu_E', 'after'), /k=5/);
assert.strictEqual(snap('toolu_W', 'before'), '');
assert.match(snap('toolu_W', 'after'), /test_k/);
assert.ok(fs.existsSync(path.join(dataDir, 'errors.log')), '깨진 입력은 errors.log 에 기록');

const [s] = buildSessions(events);
assert.strictEqual(s.title, 'retriever에 top-k 추가해줘');
assert.strictEqual(s.agents.size, 2);
assert.strictEqual(s.editCount, 2);
assert.strictEqual(s.live, true);
const view = sessionView(s);
assert.deepStrictEqual(view.lanes.map((l) => l.type), ['Main', 'Explore']);
assert.strictEqual(view.lanes[1].events.length, 3);
assert.ok(view.lanes[0].events.find((e) => e.kind === 'delegate').detail.includes('similarity_search'));
assert.strictEqual(view.lanes[0].events.find((e) => e.kind === 'tool' && e.tool === 'Agent').detail, 'retriever.py 2번째 줄');
assert.ok(JSON.stringify(view));

// webview 스크립트 문법 확인
const html = timelineHtml({});
const script = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];
new Function(script); // SyntaxError 면 throw
assert.ok(!/ style="/.test(html), 'CSP 때문에 인라인 style 속성 금지');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`OK — ${events.length} events, lanes: ${view.lanes.map((l) => `${l.type}(${l.events.length})`).join(', ')}`);
