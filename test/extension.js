// v2 확장(extension.js)을 가짜 vscode API 로 실행: 작업 폴더 세션만, 하네스 편집, 세션 열기/입력창 채우기
'use strict';
const Module = require('module');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'session-flow-ext-'));
const dataDir = path.join(tmp, 'data');
const proj = path.join(tmp, 'kftc');
const outside = path.join(tmp, 'kftc-butterflyray');
fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
fs.mkdirSync(outside);
process.env.SESSION_FLOW_DIR = dataDir;

const MAIN = 'aaaa1111-main', GNN = 'bbbb2222-gnn', RAG = 'cccc3333-rag', NONAME = 'dddd4444-x', OUT = 'eeee5555-out';
const tr = (sid, title) => { const p = path.join(tmp, sid + '.jsonl'); fs.writeFileSync(p, (title ? JSON.stringify({ type: 'custom-title', customTitle: title, sessionId: sid }) : JSON.stringify({ type: 'ai-title', aiTitle: '자동 제목' })) + '\n'); return p; };
const TP = { [MAIN]: tr(MAIN, '메인 핸들러'), [GNN]: tr(GNN, 'GNN'), [RAG]: tr(RAG, 'RAG 및 LLM'), [NONAME]: tr(NONAME, ''), [OUT]: tr(OUT, '바깥 세션') };
const rec = (sid, o, cwd = proj) => execFileSync('node', [path.join(root, 'plugin/scripts/record.js')], { input: JSON.stringify({ session_id: sid, cwd, transcript_path: TP[sid], ...o }), env: { ...process.env } });
rec(MAIN, { hook_event_name: 'UserPromptSubmit', prompt: '역할 나눠서 진행' });
rec(GNN, { hook_event_name: 'UserPromptSubmit', prompt: 'GNN 맡아줘' }, path.join(proj, 'src'));
rec(RAG, { hook_event_name: 'UserPromptSubmit', prompt: 'RAG 맡아줘' });
rec(NONAME, { hook_event_name: 'UserPromptSubmit', prompt: '데이터 로더 확인' });
rec(OUT, { hook_event_name: 'UserPromptSubmit', prompt: '다른 프로젝트' }, outside);
// 메시지: 메인 → GNN (이름으로), GNN → 메인, 메인 → 이름 없는 세션
rec(MAIN, { hook_event_name: 'PreToolUse', tool_name: 'SendMessage', tool_use_id: 't1', tool_input: { to: 'GNN', message: '학습 시작해줘' } });
rec(GNN, { hook_event_name: 'PreToolUse', tool_name: 'SendMessage', tool_use_id: 't2', tool_input: { to: '메인 핸들러', message: '시작했습니다' } });
rec(MAIN, { hook_event_name: 'PreToolUse', tool_name: 'SendMessage', tool_use_id: 't3', tool_input: { to: 'kftc-dd', message: '로더 상태 알려줘' } });
rec(NONAME, { hook_event_name: 'UserPromptSubmit', prompt: '<cross-session-message from="uds:/run/u/1.sock">로더 상태 알려줘</cross-session-message>' });

// ── 가짜 vscode ──
const external = []; const commands = {}; let handler; const posted = []; let clipboard = '';
let quickPickAnswer = (items) => items[0]; let inputAnswer = 'GNN 학습';
class EventEmitter { constructor() { this.l = []; this.event = (f) => { this.l.push(f); return { dispose() {} }; }; } fire(x) { this.l.forEach((f) => f(x)); } }
const uri = (s) => ({ toString: () => s });
const vscode = {
  EventEmitter, TreeItem: class { constructor(label, state) { this.label = label; this.state = state; } },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 }, ThemeIcon: class { constructor(id) { this.id = id; } },
  StatusBarAlignment: { Left: 1 }, ViewColumn: { Active: -1 },
  Uri: { parse: uri, file: (p) => uri('file://' + p), from: (o) => uri(`${o.scheme}:${o.path}`) },
  env: { uriScheme: 'antigravity', openExternal: async (u) => { external.push(u.toString()); return true; }, clipboard: { writeText: async (t) => { clipboard = t; } } },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: proj } }],
    getConfiguration: () => ({ get: () => '' }),
    onDidChangeConfiguration: () => ({ dispose() {} }), onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
    registerTextDocumentContentProvider: () => ({ dispose() {} }), openTextDocument: async () => ({}),
  },
  window: {
    createStatusBarItem: () => ({ show() {}, dispose() {} }),
    registerTreeDataProvider: (id, p) => { vscode._tree = p; return { dispose() {} }; },
    createWebviewPanel: () => ({
      webview: { set html(v) { this._h = v; }, postMessage: (m) => { posted.push(m); return Promise.resolve(true); }, onDidReceiveMessage: (f) => { handler = f; } },
      onDidDispose: () => {}, reveal() {}, set title(v) { this._t = v; },
    }),
    showInformationMessage: () => Promise.resolve(undefined), showWarningMessage: () => Promise.resolve(undefined),
    showErrorMessage: (m) => { throw new Error('showErrorMessage: ' + m); },
    showInputBox: async () => inputAnswer, showQuickPick: async (items) => quickPickAnswer(items),
    showTextDocument: async () => ({}), createTerminal: () => ({ show() {}, sendText() {} }),
  },
  commands: { registerCommand: (id, f) => { commands[id] = f; return { dispose() {} }; }, executeCommand: async () => {} },
};
const origLoad = Module._load;
Module._load = function (req, ...rest) { return req === 'vscode' ? vscode : origLoad.call(this, req, ...rest); };
const ext = require(path.join(root, 'extension/src/extension.js'));
const context = { subscriptions: [], globalState: { get: (k, d) => d, update: async () => {} } };
ext.activate(context);

(async () => {
  const wait = (ms = 20) => new Promise((r) => setTimeout(r, ms));
  const state = () => posted.filter((m) => m.type === 'state').pop().state;
  const send = async (m) => { handler(m); await wait(); };
  const cfgPath = path.join(proj, '.claude', 'session-flow.json');
  const cfg = () => JSON.parse(fs.readFileSync(cfgPath, 'utf8'));

  // 사이드바: 작업 폴더 하나, 그 안의 세션만 (하위 폴더 포함, 바깥 폴더 제외)
  const roots = vscode._tree.getChildren();
  assert.strictEqual(roots.length, 1);
  const sess = vscode._tree.getChildren(roots[0]);
  assert.deepStrictEqual(sess.map((x) => x.s.id).sort(), [MAIN, GNN, RAG, NONAME].sort());
  assert.ok(!sess.some((x) => x.s.id === OUT), '바깥 폴더 세션 제외');
  assert.strictEqual(sess.find((x) => x.s.id === GNN).s.displayName, 'GNN', '/rename 이름 표시');

  // 하네스 열기: 아직 없음, 왼쪽 목록에 4개 (이름 있는 3 + 이름 필요 1)
  commands['sessionFlow.openHarness']();
  await send({ type: 'ready' });
  let s = state();
  assert.strictEqual(s.exists, false);
  assert.strictEqual(s.tray.length, 4);
  assert.strictEqual(s.tray.find((t) => t.sid === NONAME).name, '');
  assert.ok(!s.tray.some((t) => t.sid === OUT));

  // (멤버 추가 뒤 사이드바 확인은 아래에서)
  // 멤버 추가 (이름 있는 세션)
  await send({ type: 'addMember', sid: MAIN, name: '메인 핸들러', at: { x: 0, y: 0 } });
  await send({ type: 'addMember', sid: GNN, name: 'GNN' });
  await send({ type: 'addMember', sid: RAG, name: 'RAG 및 LLM' });
  assert.strictEqual(cfg().members.length, 3);
  assert.strictEqual(cfg().members.find((m) => m.main).name, '메인 핸들러', '첫 멤버가 메인');
  s = state();
  assert.ok(s.exists && s.members.every((m) => m.sid && m.named));
  assert.strictEqual(s.tray.length, 1, '남은 건 이름 없는 세션');
  // 메시지: 메인↔GNN 은 멤버끼리, 메인→이름 없는 세션은 "외부"
  const t1 = s.traffic.find((t) => t.from === '메인 핸들러' && t.to === 'GNN');
  assert.ok(t1 && t1.count === 1 && t1.ok, '방향 미정이면 ok');
  assert.strictEqual(s.members.find((m) => m.name === '메인 핸들러').external.out, 1);

  // 이름 없는 세션: 이름 붙이고 추가 → 입력창에 /rename 채우기
  await send({ type: 'addMember', sid: NONAME, name: 'TTA 전문가', rename: true });
  assert.strictEqual(external.pop(), `antigravity://anthropic.claude-code/open?session=${NONAME}&prompt=${encodeURIComponent('/rename TTA 전문가')}`);
  s = state();
  const tta = s.members.find((m) => m.name === 'TTA 전문가');
  assert.ok(tta.sid === NONAME && !tta.named, '세션 ID로 연결, 이름은 아직');

  // 사이드바: 멤버는 하네스 이름으로, 메인 먼저, /rename 안 된 멤버는 "이름 필요"
  const sb = vscode._tree.getChildren(vscode._tree.getChildren()[0]);
  assert.strictEqual(vscode._tree.getTreeItem(sb[0]).label, '메인 핸들러');
  assert.ok(vscode._tree.getTreeItem(sb[0]).description.startsWith('메인'));
  const ttaItem = vscode._tree.getTreeItem(sb.find((x) => x.s.id === NONAME));
  assert.strictEqual(ttaItem.label, 'TTA 전문가', '세션 이름이 없어도 하네스 이름으로');
  assert.ok(ttaItem.description.includes('이름 필요'));

  // 이름 맞추기: /rename 안 된 멤버(TTA 전문가) 입력창 채우기
  external.length = 0;
  await send({ type: 'fixNames' });
  await wait(500);
  assert.deepStrictEqual(external, [`antigravity://anthropic.claude-code/open?session=${NONAME}&prompt=${encodeURIComponent('/rename TTA 전문가')}`]);

  // 역할, 메인, 방향, 전원 연결, 차단, 배치
  await send({ type: 'updateMember', name: 'GNN', role: 'GNN 학습·평가' });
  await send({ type: 'addRule', from: 'GNN', to: 'RAG 및 LLM' });
  await send({ type: 'connectMain' });
  await send({ type: 'setEnforce', on: true });
  let c = cfg();
  assert.strictEqual(c.members.find((m) => m.name === 'GNN').role, 'GNN 학습·평가');
  assert.strictEqual(c.edges.length, 7, '메인↔3명 왕복 6 + GNN→RAG');
  assert.strictEqual(c.enforce, true);
  await send({ type: 'removeRule', from: 'GNN', to: 'RAG 및 LLM' });
  await send({ type: 'setMain', name: 'GNN' });
  c = cfg();
  assert.strictEqual(c.edges.length, 6);
  assert.strictEqual(c.members.find((m) => m.main).name, 'GNN');
  await send({ type: 'layout', positions: { GNN: { x: 5, y: 6 }, 없음: { x: 0, y: 0 } } });
  await wait(700);
  assert.deepStrictEqual(cfg().layout.GNN, { x: 5, y: 6 });
  assert.ok(!('없음' in cfg().layout));

  // 이름 바꾸기: 방향·배치 키도 바뀌고, 그 세션 입력창에 /rename
  inputAnswer = 'GNN 학습';
  await send({ type: 'renameMember', name: 'GNN', sid: GNN });
  await wait(30);
  c = cfg();
  assert.ok(c.members.some((m) => m.name === 'GNN 학습') && !c.members.some((m) => m.name === 'GNN'));
  assert.ok(c.edges.some((e) => e.from === 'GNN 학습') && !c.edges.some((e) => e.from === 'GNN' || e.to === 'GNN'));
  assert.ok(c.layout['GNN 학습']);
  assert.ok(external.pop().endsWith(encodeURIComponent('/rename GNN 학습')));

  // 세션 열기 / 지시 보내기 (입력창 채우기)
  await send({ type: 'openSession', sid: RAG });
  assert.strictEqual(external.pop(), `antigravity://anthropic.claude-code/open?session=${RAG}`);
  await send({ type: 'instruct', sid: RAG, text: '벤치마크 결과 공유해줘' });
  assert.ok(external.pop().endsWith('&prompt=' + encodeURIComponent('벤치마크 결과 공유해줘')));
  // 입력창 채우기가 안 되면 클립보드로
  vscode.env.openExternal = async (u) => { external.push(u.toString()); return !String(u.toString()).includes('prompt='); };
  await send({ type: 'instruct', sid: RAG, text: '다시 확인' });
  await wait(30);
  assert.strictEqual(clipboard, '다시 확인');
  vscode.env.openExternal = async (u) => { external.push(u.toString()); return true; };

  // 세션에게 하네스 작성 맡기기 → 메인(GNN 학습) 세션이 먼저 제시, /session-flow:harness 채우기
  let offered;
  quickPickAnswer = (items) => { offered = items; return items[0]; };
  await send({ type: 'askWrite' });
  await wait(30);
  assert.strictEqual(offered[0].sid, GNN, '메인이 맨 위');
  assert.ok(external.pop().endsWith(`session=${GNN}&prompt=${encodeURIComponent('/session-flow:harness')}`));

  // 멤버에서 빼기 → 관련 방향 정리, 다시 왼쪽 목록으로
  await send({ type: 'removeMember', name: 'TTA 전문가' });
  c = cfg();
  assert.ok(!c.members.some((m) => m.name === 'TTA 전문가'));
  assert.ok(!c.edges.some((e) => e.from === 'TTA 전문가' || e.to === 'TTA 전문가'));
  assert.ok(state().tray.some((t) => t.sid === NONAME));

  // 세션이 직접 하네스 파일을 써도 반영 (구버전 형식도 변환)
  fs.writeFileSync(cfgPath, JSON.stringify({ name: 'kftc', members: [{ session: MAIN, name: '메인 핸들러', main: true }, { session: RAG, name: 'RAG 및 LLM' }], edges: [{ from: MAIN, to: RAG }] }));
  commands['sessionFlow.refresh']();
  await wait(30);
  s = state();
  assert.deepStrictEqual(s.edges, [{ from: '메인 핸들러', to: 'RAG 및 LLM' }]);
  assert.strictEqual(s.members.length, 2);

  // diff 요청 (스냅샷 없음 → null)
  await send({ type: 'diff', key: 'k', first: 0, last: 0 });
  assert.strictEqual(posted.filter((m) => m.type === 'diffResult').pop().diff, null);

  context.subscriptions.forEach((d) => d.dispose && d.dispose());
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('OK — v2 extension: folder-only sessions, add/rename/remove members, rules, enforce, layout, open/instruct, ask-write, external file edits');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
