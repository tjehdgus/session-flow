// 터미널 보기(cli/session-flow.js): 실제 훅 기록 + 하네스 파일로 --once 출력을 확인한다.
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'session-flow-cli-'));
const dataDir = path.join(tmp, 'data');
const proj = path.join(tmp, 'kftc');
fs.mkdirSync(path.join(proj, '.claude'), { recursive: true });
const env = { ...process.env, SESSION_FLOW_DIR: dataDir, HOME: tmp };

const MAIN = 'aaaa-main', GNN = 'bbbb-gnn';
const tr = (sid, title) => { const p = path.join(tmp, sid + '.jsonl'); fs.writeFileSync(p, JSON.stringify({ type: 'custom-title', customTitle: title }) + '\n'); return p; };
const TP = { [MAIN]: tr(MAIN, '총괄'), [GNN]: tr(GNN, 'GNN') };
const rec = (sid, o) => execFileSync('node', [path.join(root, 'plugin/scripts/record.js')], { input: JSON.stringify({ session_id: sid, cwd: proj, transcript_path: TP[sid], ...o }), env });
rec(MAIN, { hook_event_name: 'UserPromptSubmit', prompt: '역할 나눠서 진행' });
rec(GNN, { hook_event_name: 'UserPromptSubmit', prompt: 'GNN 맡아줘' });
rec(MAIN, { hook_event_name: 'PreToolUse', tool_name: 'SendMessage', tool_use_id: 't1', tool_input: { to: 'GNN', message: '학습 시작해줘' } });
const f = path.join(proj, 'train.py');
fs.writeFileSync(f, 'a\nb\n');
rec(GNN, { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_use_id: 'e1', tool_input: { file_path: f } });
fs.writeFileSync(f, 'a\nB\nc\n');
rec(GNN, { hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_use_id: 'e1', tool_input: { file_path: f } });
rec(GNN, { hook_event_name: 'PreToolUse', tool_name: 'SendMessage', tool_use_id: 't2', tool_input: { to: '총괄', message: 'AUC 0.913 나왔어요' } });
fs.writeFileSync(path.join(proj, '.claude', 'session-flow.json'), JSON.stringify({ version: 2, name: 'kftc', members: [{ name: '총괄', role: '작업 분배', main: true }, { name: 'GNN', role: 'GNN 학습' }], edges: [] }));

const run = (...a) => execFileSync('node', [path.join(root, 'cli/session-flow.js'), '--once', '--no-color', ...a], { env, encoding: 'utf8' });
const out = run(proj);
assert.ok(out.startsWith('kftc 하네스'), out);
assert.ok(/★ 총괄\s+(● 작업 중|대기)\s+작업 분배/.test(out), '메인 멤버 줄');
assert.ok(/ {3}GNN\s+(● 작업 중|대기)\s+GNN 학습/.test(out), '멤버 줄');
assert.ok(out.includes('흐름  GNN→총괄 1 · 총괄→GNN 1') || out.includes('흐름  총괄→GNN 1 · GNN→총괄 1'), '흐름 요약');
const ev = out.split('\n').filter((l) => /^ \d\d:\d\d:\d\d  /.test(l));
assert.strictEqual(ev.length, 3, out);
assert.ok(ev[0].includes('보냄  GNN → 총괄: AUC 0.913 나왔어요'), '최신이 위');
assert.ok(ev[1].includes('수정  GNN · train.py +2 −1'), '수정 줄 수');
assert.ok(ev[2].includes('보냄  총괄 → GNN: 학습 시작해줘'));
assert.ok(!/\x1b\[/.test(out), '--no-color 면 색 코드 없음');

// 하네스 파일이 없는 폴더
const empty = path.join(tmp, 'empty'); fs.mkdirSync(empty);
assert.ok(run(empty).includes('하네스 멤버가 없습니다'));

fs.rmSync(tmp, { recursive: true, force: true });
console.log('OK — cli: members, flow summary, event log (newest first, edit +/−), no-color, empty harness');
