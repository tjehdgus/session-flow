'use strict';
const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readEvents, buildSessions, sessionView, buildGraph, groupByFolder, pickCandidates } = require('./store');
const { timelineHtml } = require('./timeline');
const { graphHtml } = require('./graph');
const { scanTranscript, norm } = require('./transcripts');
const { diffLines } = require('./diff');
const harness = require('./harness');

const SNAP_SCHEME = 'session-flow-snap';
const DETAIL_SCHEME = 'session-flow-detail';

function dataDir() {
  const cfg = vscode.workspace.getConfiguration('sessionFlow').get('dataDir');
  if (cfg && cfg.trim()) return cfg.replace(/^~(?=$|[\\/])/, os.homedir());
  return process.env.SESSION_FLOW_DIR || path.join(os.homedir(), '.session-flow');
}
const eventsFile = () => path.join(dataDir(), 'events.jsonl');
const roots = () => (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath);
const visible = (s) => s.activity > 0;
const namesFile = () => path.join(dataDir(), 'names.json');

// 사용자가 지정한 세션 이름 / 핸들 연결. 사람이 직접 고칠 수도 있게 JSON 파일로 둔다.
function loadNames() {
  try {
    const o = JSON.parse(fs.readFileSync(namesFile(), 'utf8'));
    return { names: o.names || {}, aliases: o.aliases || {}, picks: o.picks || {} };
  } catch { return { names: {}, aliases: {}, picks: {} }; }
}
function saveNames(v) {
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(namesFile(), JSON.stringify(v, null, 2));
}
const snapFile = (id, phase) => path.join(dataDir(), 'snapshots', `${String(id).replace(/[^A-Za-z0-9_-]/g, '_')}.${phase}`);

function hhmmss(ts) {
  const d = new Date(ts);
  return isNaN(d) ? '' : d.toLocaleTimeString([], { hour12: false });
}

const ICONS = {
  tool_edit: 'diff', Bash: 'terminal', Read: 'file', Grep: 'search', Glob: 'search',
  WebFetch: 'globe', WebSearch: 'globe', delegate: 'arrow-right', subagent_stop: 'arrow-left',
  subagent_start: 'debug-start', prompt: 'comment', message: 'mail', message_in: 'mail-read', tool_error: 'error',
};

function eventLabel(e) {
  switch (e.kind) {
    case 'prompt': return `Prompt: ${e.summary || ''}`;
    case 'delegate': return `→ ${e.target}: ${e.summary || ''}`;
    case 'message': return `✉ → ${e.target || ''}: ${e.summary || ''}`;
    case 'message_in': return `✉ ← ${e.target || ''}: ${e.summary || ''}`;
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
    this.sessions = buildSessions(events, Date.now(), roots());
    this.byIdx = new Map(events.map((e) => [e._idx, e]));
    this.applyNames(loadNames().names, this.transcripts());
    this._emitter.fire();
  }
  find(id) { return this.sessions.find((s) => s.id === id); }
  transcripts() {
    const out = {};
    // 기록 파일 위치를 모르는 세션은 같은 폴더의 다른 세션 기록 위치에서 "<세션ID>.jsonl" 로 찾는다
    const dirByFolder = {};
    for (const s of this.sessions) if (s.transcriptPath && !dirByFolder[s.folder]) dirByFolder[s.folder] = path.dirname(s.transcriptPath);
    const guessDir = (cwd) => path.join(os.homedir(), '.claude', 'projects', String(cwd || '').replace(/[^A-Za-z0-9]/g, '-'));
    for (const s of this.sessions) {
      let p = s.transcriptPath;
      if (!p || !fs.existsSync(p)) {
        const cands = [dirByFolder[s.folder], guessDir(s.cwd)].filter(Boolean).map((d) => path.join(d, `${s.id}.jsonl`));
        p = cands.find((c) => fs.existsSync(c));
      }
      const info = scanTranscript(p);
      if (info) out[s.id] = info;
    }
    return out;
  }
  // 트리/타임라인에도 그래프와 같은 이름을 쓰도록 표시 이름을 덧입힌다
  applyNames(names, transcripts) {
    for (const s of this.sessions) {
      const t = transcripts[s.id];
      s.displayName = names[s.id] || (t && (t.title || t.summary)) || s.title;
    }
  }
}

class TreeProvider {
  constructor(model) {
    this.model = model;
    this._emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._emitter.event;
    model.onDidChange(() => this._emitter.fire());
  }
  getChildren(node) {
    if (!node) return groupByFolder(this.model.sessions.filter(visible)).map((g) => ({ type: 'folder', g }));
    if (node.type === 'folder') return node.g.sessions.map((s) => ({ type: 'session', s }));
    if (node.type === 'session') return [...node.s.agents.values()].filter((a) => a.events.length).map((a) => ({ type: 'agent', s: node.s, a }));
    if (node.type === 'agent') return node.a.events.filter((e) => !['stop', 'session_start', 'session_end'].includes(e.kind)).map((e) => ({ type: 'event', s: node.s, e }));
    return [];
  }
  getTreeItem(node) {
    if (node.type === 'folder') {
      const inWs = roots().includes(node.g.folder);
      const it = new vscode.TreeItem(node.g.name, inWs ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
      it.description = `세션 ${node.g.sessions.length}${node.g.live ? ` · ● ${node.g.live} 작업 중` : ''}`;
      it.tooltip = node.g.folder;
      it.iconPath = new vscode.ThemeIcon(inWs ? 'root-folder-opened' : 'folder');
      it.contextValue = 'folder';
      it.command = { command: 'sessionFlow.openGraph', title: 'Open graph', arguments: [node] };
      return it;
    }
    if (node.type === 'session') {
      const it = new vscode.TreeItem(node.s.displayName || node.s.title, vscode.TreeItemCollapsibleState.Collapsed);
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

  const MAX_DIFF_LINES = 4000;
  const readSnap = (e, phase) => { try { return fs.readFileSync(snapFile(e.tool_use_id, phase), 'utf8'); } catch { return ''; } };
  // first ~ last 이벤트 사이의 파일 변경 (같은 이벤트면 그 수정 하나)
  function computeDiff(firstIdx, lastIdx) {
    const a = model.byIdx.get(Number(firstIdx)), b = model.byIdx.get(Number(lastIdx ?? firstIdx));
    if (!a || !b || !a.tool_use_id || !b.tool_use_id) return null;
    const d = diffLines(readSnap(a, 'before'), readSnap(b, 'after'));
    let budget = MAX_DIFF_LINES, truncated = false;
    const hunks = [];
    for (const h of d.hunks) {
      if (budget <= 0) { truncated = true; break; }
      const lines = h.lines.slice(0, budget);
      if (lines.length < h.lines.length) truncated = true;
      budget -= lines.length;
      hunks.push({ ...h, lines });
    }
    return { file: a.file, add: d.add, del: d.del, isNew: d.isNew, deleted: d.deleted, hunks, truncated, edits: undefined, from: a.ts, to: b.ts, agent: b.agent_type };
  }
  async function openRangeDiff(firstIdx, lastIdx) {
    const a = model.byIdx.get(Number(firstIdx)), b = model.byIdx.get(Number(lastIdx ?? firstIdx));
    if (!a || !b || !a.tool_use_id || !b.tool_use_id) return;
    const name = a.file ? path.basename(a.file) : 'file';
    const left = vscode.Uri.from({ scheme: SNAP_SCHEME, path: `/before/${encodeURIComponent(a.tool_use_id)}/${name}` });
    const right = vscode.Uri.from({ scheme: SNAP_SCHEME, path: `/after/${encodeURIComponent(b.tool_use_id)}/${name}` });
    const label = a === b ? hhmmss(b.ts) : `${hhmmss(a.ts)} → ${hhmmss(b.ts)}`;
    await vscode.commands.executeCommand('vscode.diff', left, right, `${name} (${label})`, { preview: true });
  }

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
      sessions: model.sessions.map((x) => ({ id: x.id, title: x.displayName || x.title, live: x.live })),
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

  // 세션 그래프 패널
  const POS_KEY = 'sessionFlow.positions';
  const OPT_KEY = 'sessionFlow.graphOptions';
  let graphPanel;
  let graphFolder;
  const folderGroups = () => groupByFolder(model.sessions.filter(visible));
  function currentFolder() {
    const groups = folderGroups();
    if (graphFolder && groups.some((g) => g.folder === graphFolder)) return graphFolder;
    const ws = roots();
    const hit = groups.find((g) => ws.includes(g.folder));
    return (hit || groups[0] || {}).folder;
  }
  const graphOptions = () => ({ showSubagents: false, showOther: true, windowHours: 24, ...context.globalState.get(OPT_KEY, {}) });
  function postGraph() {
    if (!graphPanel) return;
    const opts = graphOptions();
    const { names, aliases, picks } = loadNames();
    const transcripts = model.transcripts();
    const folder = currentFolder();
    const pick = folder ? picks[folder] : undefined;
    const cfg = harness.load(folder);
    // 하네스가 있으면 멤버가 곧 그래프에 넣을 세션. 이름도 하네스 쪽이 우선
    const selected = cfg ? new Set(cfg.members.map((x) => x.session)) : (pick ? new Set(pick.selected || []) : null);
    const seen = new Set([...(pick ? pick.seen || [] : []), ...(cfg ? cfg.members.map((x) => x.session) : [])]);
    const allNames = { ...names };
    if (cfg) cfg.members.forEach((x) => { if (x.name) allNames[x.session] = x.name; });
    const g = buildGraph(model.sessions, {
      folder, names: allNames, aliases, transcripts, norm, selected,
      windowMs: opts.windowHours ? opts.windowHours * 3600 * 1000 : 0,
      showSubagents: opts.showSubagents,
      hideOther: opts.showOther === false,
    });
    const folders = folderGroups().map((x) => ({ folder: x.folder, name: x.name, count: x.sessions.length, live: x.live }));
    graphPanel.title = `Session Flow: ${(folders.find((x) => x.folder === folder) || {}).name || ''}`;
    const candidates = folder ? pickCandidates(model.sessions, folder, { names: allNames, transcripts, selected, seen }) : [];
    if (cfg) candidates.forEach((c) => { const mm = cfg.members.find((x) => x.session === c.id); if (mm) { c.role = mm.role; c.main = mm.main; } });
    persistHandles(g.learned, aliases);
    const sessionIds = new Set(candidates.map((c) => c.id));
    const handles = g.ghostHandles.map((h) => ({ ...h, linked: '' }))
      .concat(Object.entries(aliases).filter(([, sid]) => sessionIds.has(sid)).map(([h, sid]) => ({ handle: h, label: '@' + String(h).replace(/^uds:/, '').split(/[\\/]/).pop().replace(/\.sock$/, ''), count: 0, sample: '', linked: sid })));
    const configured = !!(cfg || pick);
    const picker = { needsSetup: !configured && candidates.length > 0, candidates, handles, newCount: configured ? candidates.filter((c) => c.isNew).length : 0 };
    const hv = cfg ? { exists: true, enforce: cfg.enforce, members: cfg.members, edges: cfg.edges, path: harness.REL } : { exists: false, enforce: false, members: [], edges: [], path: harness.REL };
    const positions = { ...context.globalState.get(POS_KEY, {}), ...(cfg ? cfg.layout : {}) };
    graphPanel.webview.postMessage({ type: 'graph', graph: { nodes: g.nodes, edges: g.edges }, positions, options: { ...opts, folder }, folders, picker, harness: hv });
  }
  async function renameSession(id, current) {
    const v = await vscode.window.showInputBox({ title: '세션 이름', prompt: '그래프와 목록에 표시할 이름 (비우면 자동 이름)', value: current || '' });
    if (v === undefined) return;
    const data = loadNames();
    if (v.trim()) data.names[id] = v.trim(); else delete data.names[id];
    saveNames(data);
    // 하네스 멤버면 프로젝트 설정의 이름도 바꾼다 (세션 안내 문구에 쓰임)
    const s = model.find(id);
    const cfg = s && harness.load(s.folder);
    const mem = cfg && cfg.members.find((x) => x.session === id);
    if (mem) { mem.name = v.trim(); try { harness.save(s.folder, cfg); } catch { /* ignore */ } }
    model.reload();
  }
  // 세션 고르기 저장: 그래프에 넣을 세션, 이름, 수신자 연결
  function savePicks(m) {
    const data = loadNames();
    const folder = m.folder || currentFolder();
    if (!folder) return;
    data.picks[folder] = { selected: m.selected || [], seen: [...new Set([...(m.seen || []), ...(m.selected || [])])] };
    for (const [sid, nm] of Object.entries(m.names || {})) {
      if (nm && nm.trim()) data.names[sid] = nm.trim(); else delete data.names[sid];
    }
    // 하네스 설정(프로젝트 폴더): 멤버·이름·역할·메인. 기존 방향/배치는 유지
    const cfg = harness.load(folder) || { name: path.basename(folder), enforce: false, members: [], edges: [], layout: {} };
    cfg.members = (m.selected || []).map((sid) => ({ session: sid, name: (m.names || {})[sid] || '', role: (m.roles || {})[sid] || '', main: m.main === sid }));
    try { harness.save(folder, cfg); } catch (e) { vscode.window.showErrorMessage(`하네스 설정을 저장하지 못했습니다: ${e.message}`); }
    for (const [h, sid] of Object.entries(m.aliases || {})) {
      if (sid) data.aliases[h] = sid; else delete data.aliases[h];
    }
    saveNames(data);
    notified.clear();
    model.reload();
  }
  // 새 세션은 그래프에 넣지 않고 "본 것"으로만 표시
  function ignoreNew(folder) {
    const data = loadNames();
    const pick = data.picks[folder] || (data.picks[folder] = { selected: [], seen: [] });
    const ids = model.sessions.filter((s) => s.folder === folder && s.activity > 0).map((s) => s.id);
    pick.seen = [...new Set([...(pick.seen || []), ...ids])];
    saveNames(data);
    model.reload();
  }
  // A안: 고르기를 한 폴더에 새 세션이 생기면 알림만 띄운다 (자동 추가 안 함)
  const notified = new Set();
  function checkNewSessions() {
    const { picks } = loadNames();
    const folders = new Set([...Object.keys(picks), ...folderGroups().map((g) => g.folder).filter((f) => harness.load(f))]);
    for (const folder of folders) {
      const pick = picks[folder] || {};
      const cfg = harness.load(folder);
      const seen = new Set([...(pick.seen || []), ...(cfg ? cfg.members.map((x) => x.session) : [])]);
      const fresh = model.sessions.filter((s) => s.folder === folder && s.activity > 0 && !seen.has(s.id) && !notified.has(s.id));
      if (!fresh.length) continue;
      fresh.forEach((s) => notified.add(s.id));
      const name = path.basename(folder);
      vscode.window.showInformationMessage(`${name}에 새 세션 ${fresh.length}개가 생겼습니다. 그래프에 추가할까요?`, '세션 고르기', '추가 안 함').then((c) => {
        if (c === '세션 고르기') { openGraph(folder); setTimeout(() => graphPanel && graphPanel.webview.postMessage({ type: 'openPicker' }), 300); }
        if (c === '추가 안 함') ignoreNew(folder);
      });
    }
  }

  // 하네스 편집 (그래프에서 오는 요청)
  function editHarness(fn) {
    const folder = currentFolder();
    if (!folder) return;
    const cfg = harness.load(folder);
    if (!cfg) { vscode.window.showWarningMessage('먼저 "멤버 고르기"로 하네스에 넣을 세션을 정해주세요.'); return; }
    fn(cfg);
    try { harness.save(folder, cfg); } catch (e) { vscode.window.showErrorMessage(`하네스 설정을 저장하지 못했습니다: ${e.message}`); return; }
    postGraph();
  }
  let layoutTimer;
  function saveLayout(positions) {
    clearTimeout(layoutTimer);
    layoutTimer = setTimeout(() => {
      const folder = currentFolder();
      const cfg = folder && harness.load(folder);
      if (!cfg) return;
      cfg.layout = Object.fromEntries(cfg.members.filter((x) => positions[x.session]).map((x) => [x.session, positions[x.session]]));
      try { harness.save(folder, cfg); } catch { /* ignore */ }
    }, 800);
  }
  // hook 이 차단 판정에 쓸 수 있도록, 알아낸 주소(kftc-3f 등) → 세션 매핑을 공유한다
  let lastHandles = '';
  function persistHandles(learned, aliases) {
    const merged = { ...learned, ...aliases };
    const txt = JSON.stringify(merged);
    if (txt === lastHandles) return;
    lastHandles = txt;
    try { fs.mkdirSync(dataDir(), { recursive: true }); fs.writeFileSync(path.join(dataDir(), 'handles.json'), JSON.stringify(merged, null, 2)); } catch { /* ignore */ }
  }
  // 더블클릭: 그 세션의 Claude Code 를 연다 (이미 열려 있으면 그 탭으로 이동)
  async function openClaudeSession(id) {
    const uri = vscode.Uri.parse(`${vscode.env.uriScheme}://anthropic.claude-code/open?session=${encodeURIComponent(id)}`);
    let ok = false;
    try { ok = await vscode.env.openExternal(uri); } catch { ok = false; }
    if (!ok) {
      const s = model.find(id);
      const pickTerm = await vscode.window.showWarningMessage('Claude Code 확장으로 세션을 열지 못했습니다. 터미널에서 이어서 열까요? 이미 다른 곳에 열려 있으면 대화가 섞일 수 있습니다.', '터미널에서 열기');
      if (pickTerm) {
        const t = vscode.window.createTerminal({ name: `Claude: ${(s && s.displayName) || id.slice(0, 8)}`, cwd: s && s.cwd });
        t.show();
        t.sendText(`claude --resume ${id}`);
      }
    }
  }

  async function linkHandle(handle) {
    const items = model.sessions.map((s) => ({ label: s.displayName || s.title, description: s.cwd || '', detail: s.id, id: s.id }));
    const pick = await vscode.window.showQuickPick(items, { title: `@${handle} 은(는) 어느 세션인가요?`, matchOnDescription: true, matchOnDetail: true });
    if (!pick) return;
    const data = loadNames();
    data.aliases[handle] = pick.id;
    saveNames(data);
    model.reload();
  }
  function openGraph(node) {
    if (node && node.g) graphFolder = node.g.folder;
    else if (typeof node === 'string') graphFolder = node;
    if (graphPanel) { graphPanel.reveal(); postGraph(); return; }
    graphPanel = vscode.window.createWebviewPanel('sessionFlow.graph', 'Session Graph', vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true });
    graphPanel.webview.html = graphHtml();
    graphPanel.onDidDispose(() => { graphPanel = undefined; });
    graphPanel.webview.onDidReceiveMessage((m) => {
      if (m.type === 'ready') postGraph();
      if (m.type === 'open') openEvent(m.idx);
      if (m.type === 'diff') graphPanel && graphPanel.webview.postMessage({ type: 'diffResult', key: m.key, diff: computeDiff(m.first, m.last) });
      if (m.type === 'openDiff') openRangeDiff(m.first, m.last);
      if (m.type === 'openFile' && m.file) vscode.window.showTextDocument(vscode.Uri.file(m.file), { preview: true });
      if (m.type === 'openTimeline') { const s = model.find(m.id); if (s) openTimeline({ s }); }
      if (m.type === 'positions') { context.globalState.update(POS_KEY, m.positions); saveLayout(m.positions); }
      if (m.type === 'options' && m.options.folder) { graphFolder = m.options.folder; delete m.options.folder; }
      if (m.type === 'options') { context.globalState.update(OPT_KEY, { ...graphOptions(), ...m.options }).then(postGraph); }
      if (m.type === 'rename') renameSession(m.id, m.current);
      if (m.type === 'savePicks') savePicks(m);
      if (m.type === 'openSession') openClaudeSession(m.id);
      if (m.type === 'addRule') editHarness((c) => { if (!c.edges.some((e) => e.from === m.from && e.to === m.to)) c.edges.push({ from: m.from, to: m.to }); });
      if (m.type === 'removeRule') editHarness((c) => { c.edges = c.edges.filter((e) => !(e.from === m.from && e.to === m.to)); });
      if (m.type === 'setMain') editHarness((c) => { c.members.forEach((x) => { x.main = x.session === m.id; }); });
      if (m.type === 'connectMain') editHarness((c) => {
        const main = c.members.find((x) => x.main);
        if (!main) return;
        c.members.filter((x) => x.session !== main.session).forEach((x) => {
          if (!c.edges.some((e) => e.from === main.session && e.to === x.session)) c.edges.push({ from: main.session, to: x.session });
          if (!c.edges.some((e) => e.from === x.session && e.to === main.session)) c.edges.push({ from: x.session, to: main.session });
        });
      });
      if (m.type === 'setEnforce') editHarness((c) => { c.enforce = !!m.on; });
      if (m.type === 'ignoreNew') ignoreNew(m.folder);
      if (m.type === 'link') linkHandle(m.handle);
    });
  }

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  status.command = 'sessionFlow.openGraph';
  function updateStatus() {
    const live = model.sessions.filter((s) => s.live).length;
    status.text = `$(pulse) Session Flow${live ? `: ${live} live` : ''}`;
    status.tooltip = `기록 위치: ${eventsFile()}`;
    status.show();
  }

  model.onDidChange(() => { updateStatus(); postSession(); postGraph(); checkNewSessions(); });

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
    vscode.commands.registerCommand('sessionFlow.openGraph', openGraph),
    vscode.commands.registerCommand('sessionFlow.pickSessions', (node) => { openGraph(node); setTimeout(() => graphPanel && graphPanel.webview.postMessage({ type: 'openPicker' }), 300); }),
    vscode.commands.registerCommand('sessionFlow.openClaude', (node) => node && node.s && openClaudeSession(node.s.id)),
    vscode.commands.registerCommand('sessionFlow.renameSession', (node) => node && node.s && renameSession(node.s.id, node.s.displayName)),
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
