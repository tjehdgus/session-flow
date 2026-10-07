// 하네스 hook (v2: 멤버 = 세션 /rename 이름): 역할 안내, 재안내, 차단 판정, 주소 기록, 구버전 변환
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const recorder = path.join(root, 'plugin/scripts/record.js');
const H = require(path.join(root, 'plugin/scripts/harness.js'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'session-flow-harness-'));
const dataDir = path.join(tmp, 'data');
const proj = path.join(tmp, 'kftc');
const sub = path.join(proj, 'src', 'gnn');
fs.mkdirSync(sub, { recursive: true });
fs.mkdirSync(path.join(proj, '.claude'), { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });

const MAIN = 'aaaa-main', GNN = 'bbbb-gnn', RAG = 'cccc-rag', OUT = 'dddd-outsider', NONAME = 'eeee-noname';
// 각 세션의 transcript 에 /rename 기록
const tr = (sid, title) => {
  const p = path.join(tmp, sid + '.jsonl');
  fs.writeFileSync(p, [JSON.stringify({ type: 'user', message: { content: 'hi' } }), title ? JSON.stringify({ type: 'custom-title', customTitle: title, sessionId: sid }) : ''].filter(Boolean).join('\n') + '\n');
  return p;
};
const TP = { [MAIN]: tr(MAIN, '메인 핸들러'), [GNN]: tr(GNN, 'GNN'), [RAG]: tr(RAG, 'RAG 및 LLM'), [OUT]: tr(OUT, '다른 작업'), [NONAME]: tr(NONAME, '') };

const writeCfg = (c) => fs.writeFileSync(path.join(proj, '.claude', 'session-flow.json'), JSON.stringify(c));
const base = {
  version: 2, name: 'kftc', enforce: false,
  members: [
    { name: '메인 핸들러', role: '작업 분배와 검토', main: true },
    { name: 'GNN', role: 'GNN 학습' },
    { name: 'RAG 및 LLM', role: '판례 검색' },
    { name: 'TTA 전문가', role: '시험 산출물', session: NONAME }, // 아직 /rename 안 한 세션
  ],
  edges: [],
};
writeCfg(base);

const run = (sid, o, extraEnv = {}, cwd = proj) => {
  const out = execFileSync('node', [recorder], {
    input: JSON.stringify({ session_id: sid, cwd, transcript_path: TP[sid], ...o }),
    env: { ...process.env, SESSION_FLOW_DIR: dataDir, ...extraEnv },
  }).toString();
  return out ? JSON.parse(out) : null;
};
const ctxOf = (r) => r && r.hookSpecificOutput.additionalContext;

// 1) 방향 미정: 제한 없이 멤버·역할 안내, 이름이 곧 주소
const c1 = ctxOf(run(GNN, { hook_event_name: 'SessionStart', source: 'resume' }, { CLAUDE_CODE_MESSAGING_SOCKET: '/run/u/2.sock' }, sub));
assert.ok(c1.includes('이 세션은 "GNN" 입니다') && c1.includes('역할: GNN 학습'), c1);
assert.ok(c1.includes('메인(총괄): "메인 핸들러"'));
assert.ok(c1.includes('아직 정해지지 않았습니다') && !c1.includes('직접 주고받지 말고'));
assert.ok(c1.includes('수신자로 위 이름을 그대로'));
assert.ok(!c1.includes('/rename'), '이름이 맞으면 rename 안내 없음');

// 2) 같은 설정이면 반복 안 함, 바뀌면 다음 질문에서 재안내
assert.strictEqual(run(GNN, { hook_event_name: 'UserPromptSubmit', prompt: '진행' }), null);
writeCfg({ ...base, edges: [{ from: '메인 핸들러', to: 'GNN' }, { from: '메인 핸들러', to: 'RAG 및 LLM' }] });
const c2 = ctxOf(run(GNN, { hook_event_name: 'UserPromptSubmit', prompt: '계속' }));
assert.ok(c2.includes('보내올 수 있는 세션: "메인 핸들러"'), c2);
assert.ok(c2.includes('"RAG 및 LLM"') && c2.includes('메인을 거치세요'));

// 3) 메인
const cm = ctxOf(run(MAIN, { hook_event_name: 'SessionStart', source: 'startup' }, { CLAUDE_CODE_MESSAGING_SOCKET: '/run/u/1.sock' }));
assert.ok(cm.includes('메인(총괄) 세션입니다') && cm.includes('먼저 보낼 수 있는 대상: "GNN", "RAG 및 LLM"'), cm);

// 4) 이름이 없는(세션 ID 로만 등록된) 멤버에게는 /rename 안내
const cn = ctxOf(run(NONAME, { hook_event_name: 'SessionStart', source: 'startup' }));
assert.ok(cn.includes('이 세션은 "TTA 전문가"') && cn.includes('/rename TTA 전문가'), cn);

// 5) 하네스 밖 세션은 관여 안 함
assert.strictEqual(run(OUT, { hook_event_name: 'SessionStart', source: 'startup' }), null);

// 6) 차단
const send = (sid, to) => run(sid, { hook_event_name: 'PreToolUse', tool_name: 'SendMessage', tool_use_id: 'x' + Math.random(), tool_input: { to, message: 'm' } });
assert.strictEqual(send(GNN, 'RAG 및 LLM'), null, '차단 꺼짐');
writeCfg({ ...base, enforce: true, edges: [{ from: '메인 핸들러', to: 'GNN' }, { from: '메인 핸들러', to: 'RAG 및 LLM' }] });
const d1 = send(GNN, 'RAG 및 LLM');
assert.strictEqual(d1.hookSpecificOutput.permissionDecision, 'deny');
assert.ok(d1.hookSpecificOutput.permissionDecisionReason.includes('"RAG 및 LLM"'));
assert.strictEqual(send(GNN, '@메인 핸들러'), null, '정한 방향에 대한 답장 허용');
assert.strictEqual(send(MAIN, 'GNN'), null, '정한 방향');
assert.strictEqual(send(GNN, 'kftc-zz'), null, '모르는 주소는 통과');
// 소켓 주소로 보내도 판정: /run/u/1.sock 는 메인(위에서 기록됨)
assert.strictEqual(send(GNN, 'uds:/run/u/1.sock'), null, '소켓 주소 = 메인 → 답장 허용');
run(OUT, { hook_event_name: 'UserPromptSubmit', prompt: 'x' }, { CLAUDE_CODE_MESSAGING_SOCKET: '/run/u/9.sock' });
assert.strictEqual(send(GNN, 'uds:/run/u/9.sock').hookSpecificOutput.permissionDecision, 'deny', '하네스 밖 세션');
// 방향을 비우면 차단 안 함
writeCfg({ ...base, enforce: true, edges: [] });
assert.strictEqual(send(GNN, 'RAG 및 LLM'), null);

// 7) 기록: 주소 표, 이름 캐시, 막힌 메시지, 안내 이벤트
const addrs = JSON.parse(fs.readFileSync(path.join(dataDir, 'addr.json'), 'utf8'));
assert.strictEqual(addrs['uds:/run/u/1.sock'], MAIN);
assert.strictEqual(addrs['uds:/run/u/9.sock'], OUT);
const titles = JSON.parse(fs.readFileSync(path.join(dataDir, 'titles.json'), 'utf8'));
assert.strictEqual(titles[GNN].title, 'GNN');
const events = fs.readFileSync(path.join(dataDir, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
assert.strictEqual(events.filter((e) => e.kind === 'message' && e.blocked).length, 2);
assert.ok(events.some((e) => e.kind === 'harness_brief' && e.session_id === GNN));

// 8) 이름 캐시는 이어 읽기: /rename 이 나중에 바뀌어도 반영
fs.appendFileSync(TP[GNN], JSON.stringify({ type: 'custom-title', customTitle: 'GNN 학습', sessionId: GNN }) + '\n');
assert.strictEqual(H.sessionName(GNN, TP[GNN], path.join(dataDir, 'titles.json')), 'GNN 학습');

// 9) 구버전(세션 ID 기반) 설정 변환
const v1 = H.normalize({ name: 'k', members: [{ session: MAIN, name: '메인 핸들러', main: true }, { session: GNN, name: 'GNN' }], edges: [{ from: MAIN, to: GNN }], layout: { [GNN]: { x: 1, y: 2 } } });
assert.deepStrictEqual(v1.edges, [{ from: '메인 핸들러', to: 'GNN' }]);
assert.deepStrictEqual(v1.layout, { GNN: { x: 1, y: 2 } });
assert.strictEqual(v1.version, 2);

fs.rmSync(tmp, { recursive: true, force: true });
console.log('OK — v2 harness hook: name identity, briefing, rename hint, enforce/reply/outside/unknown, addr & title caches, v1 migration');
