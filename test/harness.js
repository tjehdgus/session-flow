// 하네스 hook: 역할 안내와 차단 판정
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const recorder = path.join(root, 'plugin/scripts/record.js');
const harness = require(path.join(root, 'extension/src/harness'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'session-flow-harness-'));
const dataDir = path.join(tmp, 'data');
const proj = path.join(tmp, 'kftc');
const sub = path.join(proj, 'src', 'gnn');
fs.mkdirSync(sub, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });

const MAIN = 'aaaa-main', GNN = 'bbbb-gnn', RAG = 'cccc-rag', OUT = 'dddd-outsider';
harness.save(proj, {
  name: 'kftc',
  enforce: false,
  members: [
    { session: MAIN, name: '메인 핸들러', role: '작업 분배와 검토', main: true },
    { session: GNN, name: 'GNN', role: 'GNN 학습' },
    { session: RAG, name: 'RAG 및 LLM', role: '판례 검색' },
  ],
  edges: [{ from: MAIN, to: GNN }, { from: GNN, to: MAIN }, { from: MAIN, to: RAG }, { from: RAG, to: MAIN }],
  layout: {},
});
// 확장이 알아낸 주소 매핑
fs.writeFileSync(path.join(dataDir, 'handles.json'), JSON.stringify({ 'kftc-3f': GNN, 'kftc-74': RAG, 'uds:/run/x.sock': MAIN }));

const run = (sid, o, cwd = proj) => {
  const out = execFileSync('node', [recorder], { input: JSON.stringify({ session_id: sid, cwd, ...o }), env: { ...process.env, SESSION_FLOW_DIR: dataDir } }).toString();
  return out ? JSON.parse(out) : null;
};

// 0) 방향을 아직 안 정한 하네스: 제한 없이 안내, 차단도 안 함
const cfg0 = harness.load(proj);
harness.save(proj, { ...cfg0, edges: [], enforce: true });
const r0 = run(MAIN, { hook_event_name: 'SessionStart', source: 'startup' });
const c0 = r0.hookSpecificOutput.additionalContext;
assert.ok(c0.includes('아직 정해지지 않았습니다'), c0);
assert.ok(!c0.includes('직접 주고받지 말고') && !c0.includes('보내지 않습니다'), '방향 미정일 때 제한 문구 없음');
assert.ok(c0.includes('"GNN"') && c0.includes('GNN 학습'), '멤버와 역할 안내');
assert.strictEqual(run(GNN, { hook_event_name: 'PreToolUse', tool_name: 'SendMessage', tool_use_id: 's0', tool_input: { to: 'kftc-74', message: 'x' } }), null, '방향 미정이면 차단 안 함');
harness.save(proj, cfg0);

// 1) 세션 시작: 역할 안내 (하위 폴더에서 시작해도 상위의 설정을 찾음)
const r1 = run(GNN, { hook_event_name: 'SessionStart', source: 'resume' }, sub);
const ctx = r1.hookSpecificOutput.additionalContext;
assert.strictEqual(r1.hookSpecificOutput.hookEventName, 'SessionStart');
assert.ok(ctx.includes('"GNN"') && ctx.includes('(주소: kftc-3f)'), ctx);
assert.ok(ctx.includes('역할: GNN 학습'));
assert.ok(ctx.includes('메인(총괄) 세션: "메인 핸들러"'));
assert.ok(ctx.includes('보낼 수 있는 세션: "메인 핸들러"'));
assert.ok(ctx.includes('"RAG 및 LLM"') && ctx.includes('메인을 거치세요'));
assert.ok(!ctx.includes('uds:'), '읽기 어려운 소켓 주소는 안내에 넣지 않음');

// 2) 같은 설정이면 프롬프트마다 반복하지 않음
assert.strictEqual(run(GNN, { hook_event_name: 'UserPromptSubmit', prompt: '진행해줘' }), null);

// 3) 설정이 바뀌면 다음 프롬프트에서 다시 안내
const cfg = harness.load(proj);
cfg.members.find((m) => m.session === GNN).role = 'GNN 학습과 평가';
harness.save(proj, cfg);
const r3 = run(GNN, { hook_event_name: 'UserPromptSubmit', prompt: '계속' });
assert.ok(r3.hookSpecificOutput.additionalContext.includes('GNN 학습과 평가'));
assert.strictEqual(r3.hookSpecificOutput.hookEventName, 'UserPromptSubmit');

// 4) 메인 세션 안내
const rm = run(MAIN, { hook_event_name: 'SessionStart', source: 'startup' });
assert.ok(rm.hookSpecificOutput.additionalContext.includes('메인(총괄) 세션입니다'));

// 5) 차단 꺼짐: 아무 데나 보내도 막지 않음
assert.strictEqual(run(GNN, { hook_event_name: 'PreToolUse', tool_name: 'SendMessage', tool_use_id: 's1', tool_input: { to: 'kftc-74', message: '직접 연락' } }), null);

// 6) 차단 켜짐
cfg.enforce = true; harness.save(proj, cfg);
const deny = run(GNN, { hook_event_name: 'PreToolUse', tool_name: 'SendMessage', tool_use_id: 's2', tool_input: { to: 'kftc-74', message: 'RAG에 직접' } });
assert.strictEqual(deny.hookSpecificOutput.permissionDecision, 'deny');
assert.ok(deny.hookSpecificOutput.permissionDecisionReason.includes('"RAG 및 LLM"'));
assert.ok(deny.hookSpecificOutput.permissionDecisionReason.includes('보낼 수 있는 대상: "메인 핸들러"'));
// 이름으로 보내도 판정
assert.strictEqual(run(GNN, { hook_event_name: 'PreToolUse', tool_name: 'SendMessage', tool_use_id: 's3', tool_input: { to: '@RAG 및 LLM', message: 'x' } }).hookSpecificOutput.permissionDecision, 'deny');
// 허용된 방향
assert.strictEqual(run(GNN, { hook_event_name: 'PreToolUse', tool_name: 'SendMessage', tool_use_id: 's4', tool_input: { to: '메인 핸들러', message: '보고' } }), null);
// 어느 세션인지 모르는 주소는 막지 않음
assert.strictEqual(run(GNN, { hook_event_name: 'PreToolUse', tool_name: 'SendMessage', tool_use_id: 's5', tool_input: { to: 'kftc-zz', message: '?' } }), null);
// 하네스 밖 세션은 관여하지 않음
assert.strictEqual(run(OUT, { hook_event_name: 'SessionStart', source: 'startup' }), null);
assert.strictEqual(run(OUT, { hook_event_name: 'PreToolUse', tool_name: 'SendMessage', tool_use_id: 's6', tool_input: { to: 'kftc-3f', message: 'x' } }), null);
// 설정 파일이 없는 폴더
const elsewhere = path.join(tmp, 'other'); fs.mkdirSync(elsewhere);
assert.strictEqual(run(GNN, { hook_event_name: 'SessionStart', source: 'startup' }, elsewhere), null);

// 답장 허용: 메인→GNN 방향만 있어도 GNN 이 메인에게 답하는 건 허용
const cfgR = harness.load(proj);
harness.save(proj, { ...cfgR, edges: [{ from: MAIN, to: GNN }, { from: MAIN, to: RAG }] });
assert.strictEqual(run(GNN, { hook_event_name: 'PreToolUse', tool_name: 'SendMessage', tool_use_id: 'r1', tool_input: { to: '메인 핸들러', message: '보고' } }), null, '답장 허용');
assert.strictEqual(run(GNN, { hook_event_name: 'PreToolUse', tool_name: 'SendMessage', tool_use_id: 'r2', tool_input: { to: 'kftc-74', message: 'x' } }).hookSpecificOutput.permissionDecision, 'deny', 'GNN→RAG 는 여전히 차단');
const cGnn = run(GNN, { hook_event_name: 'SessionStart', source: 'resume' }).hookSpecificOutput.additionalContext;
assert.ok(cGnn.includes('받은 메시지에는 답할 수 있습니다'), cGnn);
harness.save(proj, cfgR);

// 자기 소켓 주소 기록
execFileSync('node', [recorder], { input: JSON.stringify({ session_id: RAG, cwd: proj, hook_event_name: 'UserPromptSubmit', prompt: '주소 테스트' }), env: { ...process.env, SESSION_FLOW_DIR: dataDir, CLAUDE_CODE_MESSAGING_SOCKET: '/run/user/1002/cc-socks/777.sock' } });

// 기록: 막힌 메시지는 blocked 로 남음, 안내는 harness_brief
const events = fs.readFileSync(path.join(dataDir, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const blocked = events.filter((e) => e.kind === 'message' && e.blocked);
assert.strictEqual(blocked.length, 3);
assert.ok(events.some((e) => e.session_id === RAG && e.self_addr === '/run/user/1002/cc-socks/777.sock'), '자기 주소 기록');
assert.ok(events.some((e) => e.kind === 'harness_brief' && e.session_id === GNN));

// 설정 저장: 멤버 아닌 방향은 정리, 메인은 하나만
const saved = harness.save(proj, { ...cfg, members: [...cfg.members.map((m) => ({ ...m, main: true }))], edges: [...cfg.edges, { from: MAIN, to: OUT }, { from: GNN, to: GNN }] });
assert.strictEqual(saved.members.filter((m) => m.main).length, 1);
assert.ok(!saved.edges.some((e) => e.to === OUT || e.from === e.to));
assert.strictEqual(harness.allowed(saved, GNN, MAIN), true);
assert.strictEqual(harness.allowed(saved, GNN, RAG), false);
assert.strictEqual(harness.allowed(saved, GNN, OUT), null);

fs.rmSync(tmp, { recursive: true, force: true });
console.log('OK — harness briefing, re-brief on change, enforce/deny, unknown & outsider passthrough');
