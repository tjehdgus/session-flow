'use strict';
// Session Flow (v2): 열린 작업 폴더의 Claude Code 세션들을 하네스로 묶어 설계·관찰·개입한다.
// - 세션은 작업 폴더(와 하위 폴더)에서 실행된 것만 다룬다. 다른 폴더의 세션은 가져오지 않는다.
// - 멤버 = 세션의 /rename 이름. 하네스 파일은 <작업 폴더>/.claude/session-flow.json
const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readEvents, buildSessions, sessionTurns } = require('./store');
const { timelineHtml } = require('./timeline');
const { panelHtml } = require('./panel');
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
const roots = () => (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath.replace(/[\\/]+$/, ''));
const snapFile = (id, phase) => path.join(dataDir(), 'snapshots', `${String(id).replace(/[^A-Za-z0-9_-]/g, '_')}.${phase}`);
const hhmmss = (ts) => { const d = new Date(ts); return isNaN(d) ? '' : d.toLocaleTimeString([], { hour12: false }); };

const ICONS = {
  tool_edit: 'diff', Bash: 'terminal', Read: 'file', Grep: 'search', Glob: 'search', WebFetch: 'globe', WebSearch: 'globe',
  delegate: 'arrow-right', subagent_stop: 'arrow-left', subagent_start: 'debug-start', prompt: 'comment',
  message: 'mail', message_in: 'mail-read', tool_error: 'error', harness_brief: 'info',
};
function eventLabel(e) {
  switch (e.kind) {
    case 'prompt': return `질문: ${e.summary || ''}`;
    case 'delegate': return `→ ${e.target}: ${e.summary || ''}`;
    case 'message': return `✉ → ${e.target || ''}: ${e.summary || ''}${e.blocked ? ' (차단됨)' : ''}`;
    case 'message_in': return `✉ ← ${e.target || ''}: ${e.summary || ''}`;
    case 'subagent_start': return `시작: ${e.summary || ''}`;
    case 'subagent_stop': return '← 결과 반환';
    case 'tool_error': return `${e.tool} 실패: ${e.summary || ''}`;
    case 'harness_brief': return '하네스 역할 안내';
    default: return `${e.tool}  ${e.file ? path.basename(e.file) : (e.summary || '')}`;
  }
}

class Model {
  constructor() { this.sessions = []; this.all = []; this.byIdx = new Map(); this.tr = {}; this._emitter = new vscode.EventEmitter(); this.onDidChange = this._emitter.event; }
  reload() {
    const events = readEvents(eventsFile());
    const rs = roots();
    this.all = buildSessions(events, Date.now(), rs);
    // 열린 작업 폴더(와 하위 폴더)의 세션만
    this.sessions = this.all.filter((s) => rs.includes(s.folder));
    this.byIdx = new Map(events.map((e) => [e._idx, e]));
    this.tr = this.transcripts();
    for (const s of this.sessions) {
      const t = this.tr[s.id] || {};
      s.displayName = t.customTitle || t.title || s.title;
    }
    this._emitter.fire();
  }
  // /rename 은 훅 이벤트를 남기지 않으므로 transcript 의 이름만 주기적으로 다시 확인한다
  refreshTitles() {
    const before = JSON.stringify(Object.fromEntries(Object.entries(this.tr).map(([k, v]) => [k, v.customTitle || ''])));
    const tr = this.transcripts();
    const after = JSON.stringify(Object.fromEntries(Object.entries(tr).map(([k, v]) => [k, v.customTitle || ''])));
    if (before === after) return false;
    this.tr = tr;
    for (const s of this.sessions) { const t = tr[s.id] || {}; s.displayName = t.customTitle || t.title || s.title; }
    this._emitter.fire();
    return true;
  }
  find(id) { return this.sessions.find((s) => s.id === id); }
  transcripts() {
    const out = {};
    const dirByFolder = {};
    for (const s of this.sessions) if (s.transcriptPath && !dirByFolder[s.folder]) dirByFolder[s.folder] = path.dirname(s.transcriptPath);
    const guessDir = (cwd) => path.join(os.homedir(), '.claude', 'projects', String(cwd || '').replace(/[^A-Za-z0-9]/g, '-'));
    for (const s of this.sessions) {
      let p = s.transcriptPath;
      if (!p || !fs.existsSync(p)) {
        p = [dirByFolder[s.folder], guessDir(s.cwd)].filter(Boolean).map((d) => path.join(d, `${s.id}.jsonl`)).find((c) => fs.existsSync(c));
      }
      const info = scanTranscript(p);
      if (info) out[s.id] = info;
    }
    return out;
  }
}

// 사이드바: 작업 폴더 → 세션(하네스 멤버 먼저) → 에이전트 → 이벤트
class TreeProvider {
  constructor(model) { this.model = model; this._emitter = new vscode.EventEmitter(); this.onDidChangeTreeData = this._emitter.event; model.onDidChange(() => this._emitter.fire()); }
  getChildren(node) {
    if (!node) return roots().map((folder) => ({ type: 'folder', folder }));
    if (node.type === 'folder') {
      // 하네스 멤버는 하네스 이름·역할로 보여준다 (메인 먼저, 그다음 멤버, 나머지)
      const cfg = harness.load(node.folder);
      const bySid = {};
      if (cfg) {
        const res = harness.resolveMembers(cfg, this.model.sessions, this.model.tr);
        cfg.members.forEach((m, i) => { const s = res[m.name]; if (s) bySid[s.id] = { ...m, order: i }; });
      }
      const rank = (s) => (bySid[s.id] ? (bySid[s.id].main ? 0 : 1) : 2);
      return this.model.sessions.filter((s) => s.folder === node.folder && (s.activity > 0 || bySid[s.id]))
        .sort((a, b) => rank(a) - rank(b) || ((bySid[a.id] || {}).order ?? 0) - ((bySid[b.id] || {}).order ?? 0) || (b.end - a.end))
        .map((s) => ({ type: 'session', s, member: bySid[s.id] || null, named: !!bySid[s.id] && ((this.model.tr[s.id] || {}).customTitle || '').toLowerCase() === bySid[s.id].name.toLowerCase() }));
    }
    if (node.type === 'session') return [...node.s.agents.values()].filter((a) => a.events.length).map((a) => ({ type: 'agent', s: node.s, a }));
    if (node.type === 'agent') return node.a.events.filter((e) => !['stop', 'session_start', 'session_end'].includes(e.kind)).map((e) => ({ type: 'event', s: node.s, e }));
    return [];
  }
  getTreeItem(node) {
    if (node.type === 'folder') {
      const it = new vscode.TreeItem(`${path.basename(node.folder)} 하네스`, vscode.TreeItemCollapsibleState.Expanded);
      const live = this.model.sessions.filter((s) => s.folder === node.folder && s.working).length;
      it.description = live ? `● ${live} 작업 중` : '';
      it.tooltip = node.folder;
      it.iconPath = new vscode.ThemeIcon('type-hierarchy');
      it.contextValue = 'folder';
      it.command = { command: 'sessionFlow.openHarness', title: '하네스 열기', arguments: [node.folder] };
      return it;
    }
    if (node.type === 'session') {
      const m = node.member;
      const it = new vscode.TreeItem(m ? m.name : node.s.displayName, vscode.TreeItemCollapsibleState.Collapsed);
      it.description = [m && m.main ? '메인' : null, m && !node.named ? '이름 필요' : null, node.s.working ? '● 작업 중' : null, m && m.role ? m.role : `${node.s.events.length} events`].filter(Boolean).join(' · ');
      it.tooltip = [m ? `하네스 멤버 "${m.name}"${m.role ? ` — ${m.role}` : ''}` : '하네스 멤버 아님', m && !node.named ? `세션 이름(/rename)이 아직 "${m.name}"가 아닙니다. 하네스 화면에서 /rename 을 채울 수 있습니다.` : null, `세션: ${node.s.displayName}`, node.s.cwd || '', node.s.id].filter(Boolean).join('\n');
      it.iconPath = new vscode.ThemeIcon(node.s.working ? 'pulse' : m ? (m.main ? 'star-full' : 'account') : 'history');
      it.contextValue = 'session';
      it.command = m
        ? { command: 'sessionFlow.focusMember', title: '이벤트 보기', arguments: [node.s.folder, m.name] }
        : { command: 'sessionFlow.openTimeline', title: '기록', arguments: [node] };
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
    it.command = { command: 'sessionFlow.openEvent', title: '열기', arguments: [e._idx] };
    return it;
  }
}

function activate(context) {
  const model = new Model();
  const tree = new TreeProvider(model);

  // ── 스냅샷 / 이벤트 문서 ──
  const snapProvider = { provideTextDocumentContent(uri) { const [, phase, id] = uri.path.split('/'); try { return fs.readFileSync(snapFile(decodeURIComponent(id), phase), 'utf8'); } catch { return ''; } } };
  const detailProvider = {
    provideTextDocumentContent(uri) {
      const e = model.byIdx.get(Number(new URLSearchParams(uri.query).get('idx')));
      if (!e) return '이벤트를 찾을 수 없습니다.';
      return [`# ${eventLabel(e)}`, '', `- 시간: ${e.ts}`, `- 에이전트: ${e.agent_type || 'Main'}${e.agent_id ? ` (${e.agent_id})` : ''}`,
        e.file ? `- 파일: ${e.file}` : null, e.summary ? `- 요약: ${e.summary}` : null, e.block_reason ? `- 차단 이유: ${e.block_reason}` : null,
        '', '```', e.detail || '(내용 없음)', '```'].filter((x) => x !== null).join('\n');
    },
  };

  const MAX_DIFF_LINES = 4000;
  const readSnap = (e, phase) => { try { return fs.readFileSync(snapFile(e.tool_use_id, phase), 'utf8'); } catch { return ''; } };
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
    return { file: a.file, add: d.add, del: d.del, isNew: d.isNew, hunks, truncated, from: a.ts, to: b.ts };
  }
  async function openRangeDiff(firstIdx, lastIdx) {
    const a = model.byIdx.get(Number(firstIdx)), b = model.byIdx.get(Number(lastIdx ?? firstIdx));
    if (!a || !b || !a.tool_use_id || !b.tool_use_id) return;
    const name = a.file ? path.basename(a.file) : 'file';
    const left = vscode.Uri.from({ scheme: SNAP_SCHEME, path: `/before/${encodeURIComponent(a.tool_use_id)}/${name}` });
    const right = vscode.Uri.from({ scheme: SNAP_SCHEME, path: `/after/${encodeURIComponent(b.tool_use_id)}/${name}` });
    await vscode.commands.executeCommand('vscode.diff', left, right, `${name} (${a === b ? hhmmss(b.ts) : `${hhmmss(a.ts)} → ${hhmmss(b.ts)}`})`, { preview: true });
  }
  async function openEvent(idx) {
    const e = model.byIdx.get(Number(idx));
    if (!e) return;
    if (e.kind === 'tool' && e.tool_use_id && (e.has_after || e.has_before)) return openRangeDiff(idx, idx);
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.from({ scheme: DETAIL_SCHEME, path: `/event-${idx}.md`, query: `idx=${idx}&t=${Date.now()}` }));
    await vscode.window.showTextDocument(doc, { preview: true });
  }

  // ── Claude Code 세션 열기 / 입력창 채우기 ──
  const claudeUri = (q) => vscode.Uri.parse(`${vscode.env.uriScheme}://anthropic.claude-code/open?${q}`);
  async function openClaudeSession(sid) {
    let ok = false;
    try { ok = await vscode.env.openExternal(claudeUri(`session=${encodeURIComponent(sid)}`)); } catch { ok = false; }
    if (!ok) {
      const s = model.find(sid);
      const c = await vscode.window.showWarningMessage('Claude Code 확장으로 세션을 열지 못했습니다. 터미널에서 이어서 열까요? 이미 다른 곳에 열려 있으면 대화가 섞일 수 있습니다.', '터미널에서 열기');
      if (c) { const t = vscode.window.createTerminal({ name: `Claude: ${(s && s.displayName) || sid.slice(0, 8)}`, cwd: s && s.cwd }); t.show(); t.sendText(`claude --resume ${sid}`); }
    }
  }
  // 그 세션 입력창에 문장을 채운다 (전송은 사용자가). 안 되면 클립보드로.
  async function instruct(sid, text) {
    let ok = false;
    try { ok = await vscode.env.openExternal(claudeUri(`session=${encodeURIComponent(sid)}&prompt=${encodeURIComponent(text)}`)); } catch { ok = false; }
    if (!ok) {
      await vscode.env.clipboard.writeText(text);
      await openClaudeSession(sid);
      vscode.window.showInformationMessage('입력할 문장을 클립보드에 복사했습니다. 세션 입력창에 붙여넣으세요.');
    }
  }

  // ── 타임라인 패널 ──
  let tl; let tlSid;
  function postTimeline() {
    if (!tl) return;
    const s = model.find(tlSid) || model.sessions[0];
    // 하네스 멤버면 하네스 이름·역할로 보여준다
    const folder = s && s.folder;
    const cfg = folder && harness.load(folder);
    const res = cfg ? harness.resolveMembers(cfg, model.sessions, model.tr) : {};
    const memberOf = (sid) => cfg && cfg.members.find((m) => res[m.name] && res[m.name].id === sid);
    const nameOf = (x) => { const m = memberOf(x.id); return m ? m.name : x.displayName; };
    const me = s && memberOf(s.id);
    tl.webview.postMessage({
      type: 'session',
      session: s ? { id: s.id, title: nameOf(s), role: me ? me.role : '', live: s.live, eventCount: s.events.length, fileCount: s.files.size, turns: sessionTurns(s) } : null,
      sessions: model.sessions.filter((x) => x.activity > 0).map((x) => ({ id: x.id, title: nameOf(x), live: x.live })),
    });
  }
  function openTimeline(arg) {
    const sid = typeof arg === 'string' ? arg : arg && arg.s ? arg.s.id : null;
    if (sid) tlSid = sid; else if (!tlSid && model.sessions[0]) tlSid = model.sessions[0].id;
    if (tl) { tl.reveal(); postTimeline(); return; }
    tl = vscode.window.createWebviewPanel('sessionFlow.timeline', 'Session Flow 기록', vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true });
    tl.webview.html = timelineHtml(tl.webview);
    tl.onDidDispose(() => { tl = undefined; });
    tl.webview.onDidReceiveMessage((m) => {
      if (m.type === 'ready') postTimeline();
      if (m.type === 'open') openEvent(m.idx);
      if (m.type === 'select') { tlSid = m.id; postTimeline(); }
      if (m.type === 'openFile' && m.file) vscode.window.showTextDocument(vscode.Uri.file(m.file), { preview: true });
    });
  }

  // ── 하네스 패널 ──
  let hp; let hpFolder; let pendingFocus = null;
  const lineCache = new Map();
  const folderNow = () => (hpFolder && roots().includes(hpFolder) ? hpFolder : roots()[0]);
  function postState() {
    if (!hp) return;
    const folder = folderNow();
    if (!folder) return;
    const state = harness.viewState({ folder, cfg: harness.load(folder), sessions: model.sessions, transcripts: model.tr, norm });
    // 수정 이벤트에 +/− 줄 수 (스냅샷 비교, idx 별로 캐시)
    for (const a of state.activity) {
      if (a.kind !== 'edit') continue;
      let c = lineCache.get(a.idx);
      if (!c) { const e = model.byIdx.get(a.idx); const d = e && e.tool_use_id ? diffLines(readSnap(e, 'before'), readSnap(e, 'after')) : null; c = d ? { add: d.add, del: d.del } : { add: null, del: null }; lineCache.set(a.idx, c); }
      a.add = c.add; a.del = c.del;
    }
    hp.title = `${state.name} 하네스`;
    hp.webview.postMessage({ type: 'state', state });
    if (pendingFocus) { hp.webview.postMessage({ type: 'focus', name: pendingFocus }); pendingFocus = null; }
  }
  // 사이드바에서 멤버 세션을 누르면: 하네스 화면을 열고 그 멤버의 이벤트 목록을 보여준다
  function focusMember(folder, name) {
    pendingFocus = name;
    if (hp) { if (typeof folder === 'string') hpFolder = folder; hp.reveal(); postState(); return; }
    openHarness(folder);
  }
  function edit(fn) {
    const folder = folderNow();
    if (!folder) return;
    const cfg = harness.load(folder) || harness.empty(folder);
    if (fn(cfg) === false) return;
    try { harness.save(folder, cfg); } catch (e) { vscode.window.showErrorMessage(`하네스 파일을 저장하지 못했습니다: ${e.message}`); return; }
    postState();
  }
  let layoutTimer;
  function saveLayout(positions) {
    clearTimeout(layoutTimer);
    layoutTimer = setTimeout(() => edit((c) => { c.layout = Object.fromEntries(c.members.filter((m) => positions[m.name]).map((m) => [m.name, positions[m.name]])); }), 600);
  }
  async function renameMember(name, sid) {
    const v = (await vscode.window.showInputBox({ title: '멤버 이름 바꾸기', prompt: '세션의 /rename 이름도 같이 바꿔야 메시지 주소가 맞습니다', value: name }) || '').trim();
    if (!v || v === name) return;
    edit((c) => { harness.renameMember(c, name, v); });
    if (sid) instruct(sid, `/rename ${v}`);
  }
  // 하네스 이름과 /rename 이름이 다른 멤버들: 각 세션 입력창에 /rename 을 차례로 채운다
  async function fixNames() {
    const folder = folderNow();
    const st = folder && harness.viewState({ folder, cfg: harness.load(folder), sessions: model.sessions, transcripts: model.tr, norm });
    const todo = st ? st.members.filter((m) => m.sid && !m.named) : [];
    if (!todo.length) { vscode.window.showInformationMessage('모든 멤버의 세션 이름이 하네스 이름과 같습니다.'); return; }
    for (const m of todo) { await instruct(m.sid, `/rename ${m.name}`); await new Promise((r) => setTimeout(r, 400)); }
    vscode.window.showInformationMessage(`${todo.length}개 세션 입력창에 /rename 을 채웠습니다. 각 세션에서 엔터를 누르면 이름이 맞춰집니다.`);
  }
  async function askWrite() {
    const folder = folderNow();
    const cfg = folder && harness.load(folder);
    const main = cfg && cfg.members.find((m) => m.main);
    const mainSid = main && (harness.resolveMembers(cfg, model.sessions, model.tr)[main.name] || {}).id;
    const items = model.sessions.filter((s) => s.folder === folder && s.activity > 0).sort((a, b) => (b.id === mainSid) - (a.id === mainSid) || b.live - a.live || b.end - a.end)
      .map((s) => ({ label: s.displayName, description: `${s.id === mainSid ? '메인 · ' : ''}${s.working ? '작업 중 · ' : ''}${s.events.length} events`, sid: s.id }));
    if (!items.length) { vscode.window.showInformationMessage('이 폴더에 기록된 세션이 없습니다. 세션에서 작업을 시작한 뒤 다시 시도하세요.'); return; }
    const pick = await vscode.window.showQuickPick(items, { title: '어느 세션에게 하네스 작성을 맡길까요?', placeHolder: '역할 분담을 가장 잘 아는 세션 (보통 메인)' });
    if (pick) instruct(pick.sid, '/session-flow:harness');
  }
  function openHarness(folder) {
    if (typeof folder === 'string') hpFolder = folder;
    if (!roots().length) { vscode.window.showWarningMessage('작업 폴더를 연 뒤에 사용할 수 있습니다. Session Flow 는 열린 작업 폴더의 세션만 다룹니다.'); return; }
    if (hp) { hp.reveal(); postState(); return; }
    hp = vscode.window.createWebviewPanel('sessionFlow.harness', '하네스', vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true });
    hp.webview.html = panelHtml();
    hp.onDidDispose(() => { hp = undefined; });
    hp.webview.onDidReceiveMessage((m) => {
      switch (m.type) {
        case 'ready': postState(); break;
        case 'addMember': edit((c) => {
          if (c.members.some((x) => x.name.toLowerCase() === m.name.toLowerCase())) return false;
          c.members.push({ name: m.name, role: '', main: !c.members.length, session: m.sid });
          if (m.at) c.layout[m.name] = m.at;
        }); if (m.rename) instruct(m.sid, `/rename ${m.name}`); break;
        case 'removeMember': edit((c) => { c.members = c.members.filter((x) => x.name !== m.name); }); break;
        case 'updateMember': edit((c) => { const x = c.members.find((y) => y.name === m.name); if (!x) return false; if (m.role !== undefined) x.role = m.role; }); break;
        case 'setMain': edit((c) => { c.members.forEach((x) => { x.main = x.name === m.name; }); }); break;
        case 'renameMember': renameMember(m.name, m.sid); break;
        case 'addRule': edit((c) => { if (!c.edges.some((e) => e.from === m.from && e.to === m.to)) c.edges.push({ from: m.from, to: m.to }); }); break;
        case 'removeRule': edit((c) => { c.edges = c.edges.filter((e) => !(e.from === m.from && e.to === m.to)); }); break;
        case 'connectMain': edit((c) => {
          const main = c.members.find((x) => x.main); if (!main) return false;
          c.members.filter((x) => x !== main).forEach((x) => {
            if (!c.edges.some((e) => e.from === main.name && e.to === x.name)) c.edges.push({ from: main.name, to: x.name });
            if (!c.edges.some((e) => e.from === x.name && e.to === main.name)) c.edges.push({ from: x.name, to: main.name });
          });
        }); break;
        case 'setEnforce': edit((c) => { c.enforce = !!m.on; }); break;
        case 'layout': saveLayout(m.positions || {}); break;
        case 'openSession': openClaudeSession(m.sid); break;
        case 'instruct': instruct(m.sid, m.text); break;
        case 'askWrite': askWrite(); break;
        case 'fixNames': fixNames(); break;
        case 'open': openEvent(m.idx); break;
        case 'diff': hp.webview.postMessage({ type: 'diffResult', key: m.key, diff: computeDiff(m.first, m.last) }); break;
        case 'openDiff': openRangeDiff(m.first, m.last); break;
        case 'openFile': if (m.file) vscode.window.showTextDocument(vscode.Uri.file(m.file), { preview: true }); break;
        case 'openTimeline': openTimeline(m.sid); break;
        default: break;
      }
    });
  }

  // ── 상태바 ──
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  status.command = 'sessionFlow.openHarness';
  function updateStatus() {
    const live = model.sessions.filter((s) => s.working).length;
    status.text = `$(type-hierarchy) 하네스${live ? `: ${live} 작업 중` : ''}`;
    status.tooltip = `Session Flow · 기록 위치 ${eventsFile()}`;
    status.show();
  }

  model.onDidChange(() => { updateStatus(); postTimeline(); postState(); });

  // ── 감시: 이벤트 기록 + 하네스 파일 (세션이 직접 작성해도 반영) ──
  const watched = new Set();
  let timer;
  const kick = () => { clearTimeout(timer); timer = setTimeout(() => model.reload(), 200); };
  function watch() {
    for (const f of watched) fs.unwatchFile(f);
    watched.clear();
    try { fs.mkdirSync(dataDir(), { recursive: true }); } catch { /* ignore */ }
    [eventsFile(), ...roots().map(harness.configPath)].forEach((f) => { fs.watchFile(f, { interval: 1000 }, kick); watched.add(f); });
  }
  watch();
  model.reload();
  const titleTimer = setInterval(() => { try { model.refreshTitles(); } catch { /* ignore */ } }, 5000);
  if (titleTimer.unref) titleTimer.unref();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('sessionFlow.sessions', tree),
    vscode.workspace.registerTextDocumentContentProvider(SNAP_SCHEME, snapProvider),
    vscode.workspace.registerTextDocumentContentProvider(DETAIL_SCHEME, detailProvider),
    vscode.commands.registerCommand('sessionFlow.openHarness', openHarness),
    vscode.commands.registerCommand('sessionFlow.openTimeline', openTimeline),
    vscode.commands.registerCommand('sessionFlow.focusMember', focusMember),
    vscode.commands.registerCommand('sessionFlow.openEvent', openEvent),
    vscode.commands.registerCommand('sessionFlow.openClaude', (node) => node && node.s && openClaudeSession(node.s.id)),
    vscode.commands.registerCommand('sessionFlow.askWrite', askWrite),
    vscode.commands.registerCommand('sessionFlow.fixNames', fixNames),
    vscode.commands.registerCommand('sessionFlow.refresh', () => model.reload()),
    vscode.commands.registerCommand('sessionFlow.openDataFolder', () => vscode.env.openExternal(vscode.Uri.file(dataDir()))),
    vscode.workspace.onDidChangeConfiguration((ev) => { if (ev.affectsConfiguration('sessionFlow.dataDir')) { watch(); model.reload(); } }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => { watch(); model.reload(); }),
    status,
    { dispose: () => { clearInterval(titleTimer); for (const f of watched) fs.unwatchFile(f); } },
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
