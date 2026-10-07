'use strict';
const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readEvents, buildSessions, sessionView } = require('./store');
const { timelineHtml } = require('./timeline');

const SNAP_SCHEME = 'session-flow-snap';
const DETAIL_SCHEME = 'session-flow-detail';

function dataDir() {
  const cfg = vscode.workspace.getConfiguration('sessionFlow').get('dataDir');
  if (cfg && cfg.trim()) return cfg.replace(/^~(?=$|[\\/])/, os.homedir());
  return process.env.SESSION_FLOW_DIR || path.join(os.homedir(), '.session-flow');
}
const eventsFile = () => path.join(dataDir(), 'events.jsonl');
const snapFile = (id, phase) => path.join(dataDir(), 'snapshots', `${String(id).replace(/[^A-Za-z0-9_-]/g, '_')}.${phase}`);

function hhmmss(ts) {
  const d = new Date(ts);
  return isNaN(d) ? '' : d.toLocaleTimeString([], { hour12: false });
}

const ICONS = {
  tool_edit: 'diff', Bash: 'terminal', Read: 'file', Grep: 'search', Glob: 'search',
  WebFetch: 'globe', WebSearch: 'globe', delegate: 'arrow-right', subagent_stop: 'arrow-left',
  subagent_start: 'debug-start', prompt: 'comment', message: 'mail', tool_error: 'error',
};

function eventLabel(e) {
  switch (e.kind) {
    case 'prompt': return `Prompt: ${e.summary || ''}`;
    case 'delegate': return `→ ${e.target}: ${e.summary || ''}`;
    case 'message': return `✉ ${e.target || ''}: ${e.summary || ''}`;
    case 'subagent_start': return `시작: ${e.summary || ''}`;
    case 'subagent_stop': return `← 결과 반환`;
    case 'tool_error': return `${e.tool} 실패: ${e.summary || ''}`;
    default: return `${e.tool}  ${e.file ? path.basename(e.file) : (e.summary || '')}`;
  }
}

class Model {
  constructor() { this.sessions = []; this.byIdx = new Map(); this._emitter = new vscode.EventEmitter(); this.onDidChange = this._emitter.event; }
  reload() {
    const events = readEvents(eventsFile());
    this.sessions = buildSessions(events);
    this.byIdx = new Map(events.map((e) => [e._idx, e]));
    this._emitter.fire();
  }
  find(id) { return this.sessions.find((s) => s.id === id); }
}

class TreeProvider {
  constructor(model) {
    this.model = model;
    this._emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._emitter.event;
    model.onDidChange(() => this._emitter.fire());
  }
  getChildren(node) {
    if (!node) return this.model.sessions.map((s) => ({ type: 'session', s }));
    if (node.type === 'session') return [...node.s.agents.values()].filter((a) => a.events.length).map((a) => ({ type: 'agent', s: node.s, a }));
    if (node.type === 'agent') return node.a.events.filter((e) => !['stop', 'session_start', 'session_end'].includes(e.kind)).map((e) => ({ type: 'event', s: node.s, e }));
    return [];
  }
  getTreeItem(node) {
    if (node.type === 'session') {
      const it = new vscode.TreeItem(node.s.title, vscode.TreeItemCollapsibleState.Collapsed);
      it.description = `${node.s.live ? '● LIVE · ' : ''}${node.s.events.length} events · ${node.s.files.size} files`;
      it.tooltip = `${node.s.cwd || ''}\n${node.s.id}`;
      it.iconPath = new vscode.ThemeIcon(node.s.live ? 'pulse' : 'history');
      it.contextValue = 'session';
      it.command = { command: 'sessionFlow.openTimeline', title: 'Open timeline', arguments: [node] };
      return it;
    }
    if (node.type === 'agent') {
      const it = new vscode.TreeItem(node.a.id === 'main' ? 'Main' : `↳ ${node.a.type}`, vscode.TreeItemCollapsibleState.Collapsed);
      it.description = `${node.a.events.length} events`;
      it.iconPath = new vscode.ThemeIcon(node.a.id === 'main' ? 'account' : 'organization');
      return it;
    }
    const e = node.e;
    const isEdit = e.kind === 'tool' && (e.has_after || e.has_before);
    const it = new vscode.TreeItem(eventLabel(e), vscode.TreeItemCollapsibleState.None);
    it.description = hhmmss(e.ts);
    it.tooltip = e.summary || '';
    it.iconPath = new vscode.ThemeIcon(isEdit ? ICONS.tool_edit : (ICONS[e.kind] || ICONS[e.tool] || 'circle-small'));
    it.command = { command: 'sessionFlow.openEvent', title: 'Open', arguments: [e._idx] };
    return it;
  }
}

function activate(context) {
  const model = new Model();
  const tree = new TreeProvider(model);

  const snapProvider = {
    provideTextDocumentContent(uri) {
      // uri.path = /<phase>/<toolUseId>/<basename>
      const [, phase, id] = uri.path.split('/');
      try { return fs.readFileSync(snapFile(id, phase), 'utf8'); } catch { return ''; }
    },
  };
  const detailProvider = {
    provideTextDocumentContent(uri) {
      const idx = Number(new URLSearchParams(uri.query).get('idx'));
      const e = model.byIdx.get(idx);
      if (!e) return '이벤트를 찾을 수 없습니다.';
      return [
        `# ${eventLabel(e)}`, '',
        `- 시간: ${e.ts}`,
        `- 에이전트: ${e.agent_type || 'Main'}${e.agent_id ? ` (${e.agent_id})` : ''}`,
        e.file ? `- 파일: ${e.file}` : null,
        e.summary ? `- 요약: ${e.summary}` : null,
        '', '```', e.detail || '(내용 없음)', '```',
      ].filter((x) => x !== null).join('\n');
    },
  };

  async function openEvent(idx) {
    const e = model.byIdx.get(Number(idx));
    if (!e) return;
    if (e.kind === 'tool' && e.tool_use_id && (e.has_after || e.has_before)) {
      const name = e.file ? path.basename(e.file) : 'file';
      const id = encodeURIComponent(e.tool_use_id);
      const left = vscode.Uri.from({ scheme: SNAP_SCHEME, path: `/before/${id}/${name}` });
      const right = vscode.Uri.from({ scheme: SNAP_SCHEME, path: `/after/${id}/${name}` });
      await vscode.commands.executeCommand('vscode.diff', left, right, `${name} (${e.agent_type || 'Main'} · ${hhmmss(e.ts)})`, { preview: true });
      return;
    }
    const uri = vscode.Uri.from({ scheme: DETAIL_SCHEME, path: `/event-${idx}.md`, query: `idx=${idx}&t=${Date.now()}` });
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: true });
  }

  // 타임라인 패널 (세션당 하나)
  let panel;
  let panelSessionId;
  function postSession() {
    if (!panel) return;
    const s = model.find(panelSessionId) || model.sessions[0];
    panel.webview.postMessage({
      type: 'session',
      session: s ? sessionView(s) : null,
      sessions: model.sessions.map((x) => ({ id: x.id, title: x.title, live: x.live })),
    });
  }
  function openTimeline(node) {
    if (node && node.s) panelSessionId = node.s.id;
    else if (!panelSessionId && model.sessions[0]) panelSessionId = model.sessions[0].id;
    if (!panel) {
      panel = vscode.window.createWebviewPanel('sessionFlow.timeline', 'Session Flow', vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true });
      panel.webview.html = timelineHtml(panel.webview);
      panel.onDidDispose(() => { panel = undefined; });
      panel.webview.onDidReceiveMessage((m) => {
        if (m.type === 'ready') postSession();
        if (m.type === 'open') openEvent(m.idx);
        if (m.type === 'select') { panelSessionId = m.id; postSession(); }
        if (m.type === 'openFile' && m.file) vscode.window.showTextDocument(vscode.Uri.file(m.file), { preview: true });
      });
    } else {
      panel.reveal();
      postSession();
    }
  }

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  status.command = 'sessionFlow.openTimeline';
  function updateStatus() {
    const live = model.sessions.filter((s) => s.live).length;
    status.text = `$(pulse) Session Flow${live ? `: ${live} live` : ''}`;
    status.tooltip = `기록 위치: ${eventsFile()}`;
    status.show();
  }

  model.onDidChange(() => { updateStatus(); postSession(); });

  // events.jsonl 감시 (워크스페이스 밖 경로라 fs.watchFile 폴링 사용)
  let watched;
  let timer;
  function watch() {
    if (watched) fs.unwatchFile(watched);
    watched = eventsFile();
    try { fs.mkdirSync(path.dirname(watched), { recursive: true }); } catch { /* ignore */ }
    fs.watchFile(watched, { interval: 1000 }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => model.reload(), 200);
    });
  }
  watch();
  model.reload();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('sessionFlow.sessions', tree),
    vscode.workspace.registerTextDocumentContentProvider(SNAP_SCHEME, snapProvider),
    vscode.workspace.registerTextDocumentContentProvider(DETAIL_SCHEME, detailProvider),
    vscode.commands.registerCommand('sessionFlow.openTimeline', openTimeline),
    vscode.commands.registerCommand('sessionFlow.openEvent', openEvent),
    vscode.commands.registerCommand('sessionFlow.refresh', () => model.reload()),
    vscode.commands.registerCommand('sessionFlow.openDataFolder', () => vscode.env.openExternal(vscode.Uri.file(dataDir()))),
    vscode.workspace.onDidChangeConfiguration((ev) => { if (ev.affectsConfiguration('sessionFlow.dataDir')) { watch(); model.reload(); } }),
    status,
    { dispose: () => watched && fs.unwatchFile(watched) },
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
