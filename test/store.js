// 여러 세션이 메시지를 주고받는 시나리오로 그래프 생성을 확인한다
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const recorder = path.join(root, 'plugin/scripts/record.js');
const { readEvents, buildSessions, buildGraph, groupByFolder, pickCandidates, OTHER } = require(path.join(root, 'extension/src/store'));
const { scanTranscript, norm } = require(path.join(root, 'extension/src/transcripts'));

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

// 세션 고르기: A, B 만 고르면 나머지는 "기타"로
const gs = buildGraph(sessions, { folder: cwd, transcripts, norm, names: { [A]: '메인 핸들러' }, selected: new Set([A, B]) });
assert.deepStrictEqual(gs.nodes.map((n) => n.id).sort(), [OTHER, A, B].sort());
const toOther = gs.edges.find((e) => e.from === A && e.to === OTHER);
assert.strictEqual(toOther.count, 2, 'A→RAG, A→@tta-zz 가 기타로 합쳐짐');
assert.ok(toOther.messages.every((m) => m.via), '어느 세션과 오간 건지 via 로 남김');
assert.ok(!gs.edges.some((e) => e.from === OTHER && e.to === OTHER), '기타끼리 메시지는 안 그림');
assert.strictEqual(gs.edges.find((e) => e.from === B && e.to === A).count, 2);
assert.ok(gs.ghostHandles.some((h) => h.handle === 'tta-zz'));
// 아무도 안 고르면 기타만 남지 않고 빈 그래프
const g0 = buildGraph(sessions, { folder: cwd, transcripts, norm, selected: new Set() });
assert.strictEqual(g0.nodes.filter((n) => n.kind === 'session').length, 0);
// 후보 목록
const cands = pickCandidates(sessions, cwd, { transcripts, names: { [A]: '메인 핸들러' }, selected: new Set([A]), seen: new Set([A, B]) });
assert.deepStrictEqual(cands.map((c) => c.id).sort(), [A, B, C].sort(), '빈 세션·다른 폴더 제외');
assert.strictEqual(cands.find((c) => c.id === C).isNew, true);
assert.strictEqual(cands.find((c) => c.id === A).selected, true);
assert.strictEqual(cands.find((c) => c.id === A).firstPrompt, '역할 나눠서 진행해줘');
assert.strictEqual(cands.find((c) => c.id === B).autoName, 'GNN');

// 서브에이전트 표시
const g3 = buildGraph(sessions, { folder: cwd, transcripts, norm, showSubagents: true });
const sub = g3.nodes.find((n) => n.kind === 'subagent');
assert.ok(sub && sub.label === 'Explore');
assert.ok(g3.edges.find((e) => e.from === A && e.to === sub.id));
assert.ok(g3.edges.find((e) => e.from === sub.id && e.to === A));

// 주소 재사용·재시작: 같은 이름 kftc-73 이 오전엔 B, 오후엔 C. 소켓 주소는 자기 기록으로 정확히 연결
{
  const T = (h) => new Date(Date.UTC(2026, 9, 7, h)).toISOString();
  const evs = [
    { session_id: A, cwd, ts: T(1), kind: 'prompt', summary: '시작', self_addr: '/run/u/1.sock' },
    { session_id: B, cwd, ts: T(1), kind: 'prompt', summary: 'b', self_addr: '/run/u/2.sock' },
    { session_id: C, cwd, ts: T(5), kind: 'prompt', summary: 'c', self_addr: '/run/u/3.sock' },
    // 오전: A → kftc-73 (B 가 받음)
    { session_id: A, cwd, ts: T(2), kind: 'message', target: 'kftc-73', detail: '오전 지시입니다 확인 부탁', summary: '오전' },
    { session_id: B, cwd, ts: T(2), kind: 'message_in', target: 'uds:/run/u/1.sock', detail: '오전 지시입니다 확인 부탁', summary: '오전' },
    // 오후: A → kftc-73 (이번엔 C 가 받음)
    { session_id: A, cwd, ts: T(6), kind: 'message', target: 'kftc-73', detail: '오후 지시는 다른 내용', summary: '오후' },
    { session_id: C, cwd, ts: T(6), kind: 'message_in', target: 'uds:/run/u/1.sock', detail: '오후 지시는 다른 내용', summary: '오후' },
    // 저녁: A → kftc-73, 받은 기록 없음 → 시각상 C
    { session_id: A, cwd, ts: T(8), kind: 'message', target: 'kftc-73', detail: '저녁 지시', summary: '저녁' },
    // C 가 재시작 후 새 소켓으로 A 에게 보냄 (보낸 쪽 기록 없음) → 자기 주소 기록으로 C
    { session_id: C, cwd, ts: T(9), kind: 'prompt', summary: '재시작', self_addr: '/run/u/9.sock' },
    { session_id: A, cwd, ts: T(9), kind: 'message_in', target: 'uds:/run/u/9.sock', detail: '재시작 후 보고', summary: '보고' },
    // ListAgents 결과로 이름 학습
    { session_id: A, cwd, ts: T(10), kind: 'tool', tool: 'ListAgents', detail: '- kftc-c4  uds:/run/u/9.sock  (idle)' },
    { session_id: A, cwd, ts: T(11), kind: 'message', target: 'kftc-c4', detail: '리스트로 찾은 상대', summary: 'x' },
  ];
  const ss = buildSessions(evs, Date.parse(T(12)), [cwd]);
  const gg = buildGraph(ss, { folder: cwd, norm, now: Date.parse(T(12)) });
  const ed = (f, t) => gg.edges.find((e) => e.from === f && e.to === t);
  assert.strictEqual(ed(A, B).count, 1, '오전 kftc-73 = B');
  assert.strictEqual(ed(A, C).count, 3, '오후·저녁 kftc-73 = C, ListAgents 로 kftc-c4 = C');
  assert.strictEqual(ed(C, A).count, 1, '새 소켓 주소도 자기 기록으로 C');
  assert.ok(!gg.nodes.some((n) => n.kind === 'ghost'), '모르는 주소 없음');
  // 기타 숨기기
  const gh = buildGraph(sessions, { folder: cwd, transcripts, norm, selected: new Set([A, B]), hideOther: true });
  assert.ok(!gh.nodes.some((n) => n.id === OTHER));
}

// transcript: 덧붙인 부분만 이어 읽기, 4MB 경계 넘어 있는 /rename, 최신 이름이 이김
{
  const tp = path.join(tmp, 'big.jsonl');
  fs.writeFileSync(tp, JSON.stringify({ type: 'custom-title', customTitle: '옛 이름' }) + '\n');
  assert.strictEqual(scanTranscript(tp).customTitle, '옛 이름');
  const filler = JSON.stringify({ type: 'assistant', message: { content: 'x'.repeat(1000) } }) + '\n';
  fs.appendFileSync(tp, filler.repeat(4500)); // 약 4.5MB
  fs.appendFileSync(tp, JSON.stringify({ type: 'custom-title', customTitle: '산출물' }) + '\n');
  assert.strictEqual(scanTranscript(tp).customTitle, '산출물', '청크 경계 뒤의 /rename');
  fs.appendFileSync(tp, JSON.stringify({ type: 'custom-title', customTitle: '산출물2' }));
  assert.strictEqual(scanTranscript(tp).customTitle, '산출물2', '개행 없는 마지막 줄');
}
// 멤버 연결: 저장된 세션 ID가 이름이 다르고, 같은 이름의 다른 세션이 있으면 이름을 따른다
{
  const { resolveMembers } = require(path.join(root, 'extension/src/harness'));
  const cfg = { members: [{ name: '산출물', session: 'old' }, { name: 'GNN', session: 'g1' }] };
  const ss = [{ id: 'old', end: 1 }, { id: 'new', end: 2 }, { id: 'g1', end: 3 }];
  const r = resolveMembers(cfg, ss, { old: { customTitle: '세션 3f' }, new: { customTitle: '산출물' }, g1: {} });
  assert.strictEqual(r['산출물'].id, 'new');
  assert.strictEqual(r['GNN'].id, 'g1', '이름 맞는 세션이 없으면 저장된 ID');
}

// 작업 중: 질문/메시지 받은 뒤 Stop 전까지만 (10분 안이라도 Stop 후면 대기)
{
  const t = Date.now();
  const mk = (sid, list) => list.map(([kind, ago], i) => ({ ts: new Date(t - ago * 1000).toISOString(), session_id: sid, cwd: '/w', kind, _i: i }));
  const ss = buildSessions([
    ...mk('A', [['prompt', 60], ['tool', 30]]),                 // 응답 중
    ...mk('B', [['prompt', 120], ['tool', 90], ['stop', 80]]),  // 끝남
    ...mk('C', [['stop', 300], ['message_in', 20]]),            // 메시지 받고 다시 일함
    ...mk('D', [['prompt', 3600]]),                             // 오래 아무 기록 없음 (중단 등)
    ...mk('E', [['stop', 200], ['tool', 40], ['message', 10]]), // 질문 기록 없이 메시지로 시작한 작업도 작업 중
    // 다시 켠 세션: 같은 ID로 종료 → 시작 → 메시지 받고 일함 (실제 h100 기록 모양)
    ...mk('F', [['stop', 900], ['session_end', 600], ['session_start', 300], ['harness_brief', 300], ['message_in', 60], ['tool', 30]]),
    ...mk('G', [['tool', 120], ['session_end', 60]]),          // 마지막이 종료면 종료
  ], t, ['/w']);
  const wk = Object.fromEntries(ss.map((x) => [x.id, x.working]));
  assert.deepStrictEqual(wk, { A: true, B: false, C: true, D: false, E: true, F: true, G: false });
  assert.strictEqual(ss.find((x) => x.id === 'F').ended, false, '다시 켜면 종료 아님');
  assert.strictEqual(ss.find((x) => x.id === 'G').ended, true);
  assert.strictEqual(ss.find((x) => x.id === 'B').live, true, 'live(최근 10분)와 working 은 다름');
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`OK — working state · transcript incremental + name-first resolve · nodes: ${g.nodes.map((n) => n.label).join(', ')} | edges: ${g.edges.map((e) => `${label(e.from)}→${label(e.to)}(${e.count})`).join(', ')}`);
