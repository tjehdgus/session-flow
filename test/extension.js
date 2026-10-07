// extension.js 를 가짜 vscode API 로 실행해 하네스 흐름(멤버 저장 → 방향 → 차단 → 세션 열기)을 확인한다
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
fs.mkdirSync(proj);
process.env.SESSION_FLOW_DIR = dataDir;

// 세션 3개 기록
const rec = (sid, o) => execFileSync('node', [path.join(root, 'plugin/scripts/record.js')], { input: JSON.stringify({ session_id: sid, cwd: proj, ...o }), env: { ...process.env } });
const A = 'aaaa1111-main', B = 'bbbb2222-gnn', C = 'cccc3333-rag';
rec(A, { hook_event_name: 'UserPromptSubmit', prompt: '역할 나눠서 진행' });
rec(B, { hook_event_name: 'UserPromptSubmit', prompt: 'GNN 맡아줘' });
rec(C, { hook_event_name: 'UserPromptSubmit', prompt: 'RAG 맡아줘' });
rec(A, { hook_event_name: 'PreToolUse', tool_name: 'SendMessage', tool_use_id: 't1', tool_input: { to: 'kftc-bb', message: '학습 시작해줘' } });

// ── 가짜 vscode ──
const posted = [];
const external = [];
const commands = {};
let handler;
class EventEmitter { constructor() { this.l = []; this.event = (f) => { this.l.push(f); return { dispose() {} }; }; } fire(x) { this.l.forEach((f) => f(x)); } }
const uri = (s) => ({ toString: () => s, s });
const vscode = {
  EventEmitter,
  TreeItem: class { constructor(label, state) { this.label = label; this.state = state; } },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ThemeIcon: class { constructor(id) { this.id = id; } },
  StatusBarAlignment: { Left: 1 },
  ViewColumn: { Active: -1 },
  Uri: { parse: uri, file: (p) => uri('file://' + p), from: (o) => uri(`${o.scheme}:${o.path}`) },
  env: { uriScheme: 'antigravity', openExternal: async (u) => { external.push(u.toString()); return true; } },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: proj } }],
    getConfiguration: () => ({ get: () => '' }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
    registerTextDocumentContentProvider: () => ({ dispose() {} }),
    openTextDocument: async () => ({}),
  },
  window: {
    createStatusBarItem: () => ({ show() {}, dispose() {} }),
    registerTreeDataProvider: (id, p) => { vscode._tree = p; return { dispose() {} }; },
    createWebviewPanel: () => ({
      webview: { set html(v) { this._html = v; }, postMessage: (m) => { posted.push(m); return Promise.resolve(true); }, onDidReceiveMessage: (f) => { handler = f; } },
      onDidDispose: () => {}, reveal() {}, set title(v) { this._t = v; },
    }),
    showInformationMessage: () => Promise.resolve(undefined),
    showWarningMessage: () => Promise.resolve(undefined),
    showErrorMessage: (m) => { throw new Error('showErrorMessage: ' + m); },
    showInputBox: async () => '메인 핸들러(총괄)',
    showTextDocument: async () => ({}),
    createTerminal: () => ({ show() {}, sendText() {} }),
  },
  commands: { registerCommand: (id, f) => { commands[id] = f; return { dispose() {} }; }, executeCommand: async () => {} },
};
const origLoad = Module._load;
Module._load = function (req, ...rest) { return req === 'vscode' ? vscode : origLoad.call(this, req, ...rest); };

const ext = require(path.join(root, 'extension/src/extension.js'));
const store = new Map();
const context = { subscriptions: [], globalState: { get: (k, d) => (store.has(k) ? store.get(k) : d), update: async (k, v) => { store.set(k, v); } } };
ext.activate(context);

(async () => {
  const last = () => posted.filter((m) => m.type === 'graph').pop();
  const send = async (m) => { handler(m); await new Promise((r) => setTimeout(r, 20)); };

  // 사이드바: 작업 폴더 하나에 세션 3개
  const roots = vscode._tree.getChildren();
  assert.strictEqual(roots.length, 1);
  assert.strictEqual(roots[0].g.sessions.length, 3);

  commands['sessionFlow.openGraph']();
  await send({ type: 'ready' });
  let g = last();
  assert.ok(g.picker.needsSetup, '처음엔 멤버 고르기');
  assert.strictEqual(g.harness.exists, false);

  // 멤버 저장 → 프로젝트 설정 파일
  await send({ type: 'savePicks', folder: proj, selected: [A, B, C], seen: [A, B, C], names: { [A]: '메인 핸들러', [B]: 'GNN', [C]: 'RAG 및 LLM' }, aliases: {}, roles: { [A]: '총괄', [B]: 'GNN 학습', [C]: '' }, main: A });
  const cfgPath = path.join(proj, '.claude', 'session-flow.json');
  let cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  assert.strictEqual(cfg.members.length, 3);
  assert.strictEqual(cfg.members.find((m) => m.main).session, A);
  assert.strictEqual(cfg.members.find((m) => m.session === B).role, 'GNN 학습');
  g = last();
  assert.ok(g.harness.exists && !g.picker.needsSetup);
  assert.ok(g.graph.nodes.some((n) => n.label === 'GNN'), '하네스 이름이 노드 이름');

  // 방향 추가/삭제, 메인 변경, 차단
  await send({ type: 'addRule', from: A, to: B });
  await send({ type: 'addRule', from: B, to: A });
  await send({ type: 'addRule', from: A, to: B }); // 중복 무시
  await send({ type: 'removeRule', from: B, to: A });
  await send({ type: 'connectMain' });
  cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  assert.strictEqual(cfg.edges.length, 4, '메인(A) ↔ B, C 왕복');
  await send({ type: 'removeRule', from: A, to: C });
  await send({ type: 'removeRule', from: C, to: A });
  await send({ type: 'setMain', id: B });
  await send({ type: 'setEnforce', on: true });
  cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  assert.deepStrictEqual(cfg.edges, [{ from: A, to: B }, { from: B, to: A }]);
  assert.strictEqual(cfg.members.find((m) => m.main).session, B);
  assert.strictEqual(cfg.enforce, true);
  assert.strictEqual(last().harness.enforce, true);

  // 배치 저장 (지연 저장)
  await send({ type: 'positions', positions: { [A]: { x: 10, y: 20 }, zzz: { x: 0, y: 0 } } });
  await new Promise((r) => setTimeout(r, 900));
  cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  assert.deepStrictEqual(cfg.layout, { [A]: { x: 10, y: 20 } });

  // 세션 열기: IDE 자체 URI 스킴 사용
  await send({ type: 'openSession', id: B });
  assert.strictEqual(external.pop(), `antigravity://anthropic.claude-code/open?session=${B}`);
  commands['sessionFlow.openClaude']({ s: { id: C } });
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(external.pop().endsWith(`session=${C}`));

  // 이름 바꾸기 → 하네스 이름도 변경
  await send({ type: 'rename', id: A, current: '메인 핸들러' });
  await new Promise((r) => setTimeout(r, 20));
  cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  assert.strictEqual(cfg.members.find((m) => m.session === A).name, '메인 핸들러(총괄)');

  // hook 이 쓸 주소 매핑 공유 파일
  assert.ok(fs.existsSync(path.join(dataDir, 'handles.json')));

  // 새 세션이 생기면 알림 대상 (자동 추가 안 함)
  rec('eeee5555-new', { hook_event_name: 'UserPromptSubmit', prompt: '새 작업' });
  commands['sessionFlow.refresh']();
  g = last();
  assert.strictEqual(g.picker.newCount, 1);
  assert.ok(!g.graph.nodes.some((n) => n.id === 'eeee5555-new'));

  context.subscriptions.forEach((d) => d.dispose && d.dispose());
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('OK — extension: picker save → config, rules, main, enforce, layout, open session, rename, new-session alert');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
