'use strict';
// 세션 그래프 Webview. 점 격자 캔버스 위에 세션 노드를 놓고, 주고받은 메시지를 방향별 화살표로 잇는다.
// 데이터는 postMessage 로 받고, 텍스트는 textContent 로만 넣는다.

function nonce() {
  let s = '';
  const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
}

function graphHtml() {
  const n = nonce();
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${n}'; script-src 'nonce-${n}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Session Graph</title>
<style nonce="${n}">
  :root { --accent:#5B9DFF; --edge:#6B7383; --live:#6FD69A; --ghost:#9AA3B2; --sub:#B48CF2; --viol:#F2797B; }
  * { box-sizing: border-box; }
  [hidden] { display:none !important; }
  html, body { margin:0; height:100%; overflow:hidden; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
  .app { display:flex; flex-direction:column; height:100%; }
  header { display:flex; flex-wrap:wrap; align-items:center; gap:12px 18px; padding:10px 16px; border-bottom:1px solid var(--vscode-panel-border, rgba(127,127,127,.25)); }
  header h1 { font-size:14px; margin:0; }
  .stats { font-size:12px; opacity:.75; }
  .controls { margin-left:auto; display:flex; flex-wrap:wrap; gap:10px; align-items:center; font-size:12px; }
  select, button { font: inherit; font-size:12px; }
  select { background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); border:1px solid var(--vscode-dropdown-border, transparent); padding:3px 6px; }
  button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border:0; border-radius:4px; padding:5px 10px; cursor:pointer; }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button:focus-visible, select:focus-visible { outline:2px solid var(--vscode-focusBorder); outline-offset:1px; }
  .main { flex:1; display:flex; min-height:0; }
  .stage { position:relative; flex:1; overflow:hidden; cursor:grab;
    background-color: var(--vscode-editor-background);
    background-image: radial-gradient(circle, rgba(127,127,127,.35) 1.2px, transparent 1.3px);
    background-size: 24px 24px; }
  .stage.panning { cursor:grabbing; }
  .world { position:absolute; left:0; top:0; transform-origin:0 0; }
  svg.edges { position:absolute; left:0; top:0; overflow:visible; pointer-events:none; }
  .edge-line { fill:none; stroke: var(--edge); stroke-width:2; stroke-linecap:round; }
  .edge-line.active { stroke: var(--accent); stroke-dasharray:7 6; animation: dash .8s linear infinite; }
  .edge-line.sel { stroke: var(--vscode-foreground); stroke-width:3; }
  .edge-line.sub { stroke: var(--sub); }
  .edge-hit { fill:none; stroke: transparent; stroke-width:16; pointer-events:stroke; cursor:pointer; }
  .edge-label { font-size:11px; fill: var(--vscode-foreground); opacity:.8; pointer-events:none; paint-order: stroke; stroke: var(--vscode-editor-background); stroke-width:4px; }
  @keyframes dash { to { stroke-dashoffset:-26; } }
  .node { position:absolute; width:200px; min-height:76px; padding:10px 12px; border-radius:14px; cursor:pointer; user-select:none;
    display:flex; flex-direction:column; justify-content:center; gap:3px; text-align:left; font: inherit;
    background: var(--vscode-sideBar-background, #1b1f27); color: var(--vscode-foreground);
    border: 1.5px solid rgba(127,127,127,.35); box-shadow: 0 2px 10px rgba(0,0,0,.18); }
  .node:hover { border-color: rgba(127,127,127,.7); }
  .node.sel { border-color: var(--vscode-focusBorder, var(--accent)); box-shadow: 0 0 0 3px rgba(91,157,255,.25); }
  .node.live { border-color: var(--accent); animation: ring 1.8s infinite; }
  .node.ghost { border-style:dashed; background: transparent; }
  .node.subagent { width:150px; min-height:52px; border-radius:10px; border-color: rgba(180,140,242,.6); }
  @keyframes ring { 0%{box-shadow:0 0 0 0 rgba(91,157,255,.5)} 70%{box-shadow:0 0 0 12px rgba(91,157,255,0)} 100%{box-shadow:0 0 0 0 rgba(91,157,255,0)} }
  .node .t { font-weight:600; font-size:13px; line-height:18px; overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
  .node .s { font-size:11px; opacity:.7; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .node .s.on { color: var(--live); opacity:1; }
  aside { width:340px; flex-shrink:0; border-left:1px solid var(--vscode-panel-border, rgba(127,127,127,.25)); overflow:auto; padding:16px; display:flex; flex-direction:column; gap:12px; }
  aside h2 { font-size:14px; margin:0; overflow-wrap:anywhere; }
  aside .muted { font-size:12px; opacity:.7; overflow-wrap:anywhere; }
  .row { display:flex; gap:8px; flex-wrap:wrap; }
  .msg { padding:9px 11px; border-radius:9px; background: rgba(127,127,127,.1); font-size:12px; line-height:1.55; display:flex; flex-direction:column; gap:3px; }
  .msg.out { background: rgba(91,157,255,.12); }
  .msg .h { font-family: var(--vscode-editor-font-family); font-size:10.5px; opacity:.75; }
  .msg .b { white-space:pre-wrap; overflow-wrap:anywhere; max-height:180px; overflow:auto; }
  .ev { all:unset; display:flex; gap:8px; align-items:baseline; padding:6px 8px; border-radius:6px; font-size:12px; cursor:pointer; }
  .ev:hover, .ev:focus-visible { background: rgba(127,127,127,.14); }
  .ev .k { font-family: var(--vscode-editor-font-family); font-size:10.5px; min-width:58px; opacity:.75; }
  .ev .v { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  aside.wide { width:min(620px, 55%); }
  .files { display:flex; flex-direction:column; gap:2px; }
  .fl { all:unset; display:flex; gap:8px; align-items:baseline; padding:6px 8px; border-radius:6px; font-size:12px; cursor:pointer; }
  .fl:hover, .fl:focus-visible { background: rgba(127,127,127,.14); }
  .fl .nm { font-family: var(--vscode-editor-font-family); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; min-width:0; }
  .fl .ct { font-size:11px; opacity:.65; white-space:nowrap; }
  .dhead { display:flex; flex-direction:column; gap:6px; }
  .back { all:unset; cursor:pointer; font-size:12px; opacity:.8; align-self:flex-start; padding:2px 0; }
  .back:hover, .back:focus-visible { opacity:1; text-decoration:underline; }
  .dstat { font-family: var(--vscode-editor-font-family); font-size:12px; display:flex; gap:10px; align-items:center; }
  .plus { color:#4CC38A; } .minus { color:#F2797B; }
  .bar5 { display:inline-flex; gap:2px; } .bar5 i { width:8px; height:8px; border-radius:1px; background: rgba(127,127,127,.35); display:inline-block; }
  .bar5 i.a { background:#4CC38A; } .bar5 i.d { background:#F2797B; }
  .diffbox { border:1px solid var(--vscode-panel-border, rgba(127,127,127,.25)); border-radius:8px; overflow:auto; max-height:calc(100vh - 260px); font-family: var(--vscode-editor-font-family); font-size:12px; line-height:20px; }
  .hk { padding:2px 10px; background: rgba(91,157,255,.12); color: var(--vscode-foreground); opacity:.85; white-space:pre; }
  .dl { display:grid; grid-template-columns: 44px 44px 18px max-content; min-width:100%; white-space:pre; }
  .dl span { padding:0 6px; }
  .dl .no { text-align:right; opacity:.5; user-select:none; font-variant-numeric: tabular-nums; }
  .dl .sg { user-select:none; text-align:center; padding:0; }
  .dl.add { background: rgba(46,160,67,.18); } .dl.add .sg { color:#4CC38A; }
  .dl.del { background: rgba(248,81,73,.16); } .dl.del .sg { color:#F2797B; }
  .note { font-size:12px; opacity:.7; padding:8px 0; }
  .edge-line.viol { stroke: var(--viol); }
  .edge-line.plan { stroke: var(--edge); stroke-dasharray:3 6; opacity:.55; }
  .edge-line.rule { stroke: var(--accent); stroke-width:2.5; }
  .edge-label.viol { fill: var(--viol); }
  .node .mb { display:inline-block; margin-left:6px; font-size:10px; font-weight:600; padding:1px 6px; border-radius:999px; background: rgba(240,180,60,.22); color: var(--vscode-foreground); vertical-align:1px; }
  .node .rl { font-size:11px; opacity:.75; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .node.nonmember { opacity:.55; }
  .node.connecting { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(91,157,255,.35); }
  body.edit .node.session { cursor: crosshair; }
  .seg { display:inline-flex; border:1px solid var(--vscode-panel-border, rgba(127,127,127,.35)); border-radius:6px; overflow:hidden; }
  .seg button { border-radius:0; background: transparent; color: var(--vscode-foreground); }
  .seg button[aria-pressed=true] { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .chip-on { font-size:11px; padding:2px 8px; border-radius:999px; background: rgba(242,121,123,.2); }
  .pk-role { width:100%; font: inherit; font-size:12px; padding:4px 8px; border-radius:5px; border:1px solid var(--vscode-input-border, rgba(127,127,127,.35)); background: var(--vscode-input-background, rgba(127,127,127,.08)); color: var(--vscode-input-foreground, var(--vscode-foreground)); }
  .pk-main { font-size:12px; display:inline-flex; gap:4px; align-items:center; }
  .warn { font-size:12px; padding:8px 10px; border-radius:8px; background: rgba(242,121,123,.14); line-height:1.5; }
  .node.other { border-style:dotted; opacity:.85; background: transparent; }
  .main { position:relative; }
  .newbar { position:absolute; left:12px; right:12px; top:10px; z-index:5; display:flex; flex-wrap:wrap; gap:8px 12px; align-items:center; padding:8px 12px; border-radius:8px; font-size:12px;
    background: var(--vscode-editorWidget-background, #252830); border:1px solid var(--vscode-focusBorder, #5B9DFF); box-shadow: 0 4px 14px rgba(0,0,0,.25); }
  .newbar span { flex:1; min-width:180px; }
  .picker { position:absolute; inset:0; z-index:10; overflow:auto; background: var(--vscode-editor-background); padding:24px 16px; }
  .pk { max-width:780px; margin:0 auto; display:flex; flex-direction:column; gap:14px; }
  .pk h2 { margin:0; font-size:16px; }
  .pk .lead { font-size:12.5px; opacity:.75; line-height:1.6; }
  .pk-tools { display:flex; flex-wrap:wrap; gap:8px; align-items:center; font-size:12px; }
  .pk-tools .cnt { margin-left:auto; opacity:.75; }
  .pk-list { display:flex; flex-direction:column; gap:8px; }
  .pk-row { display:grid; grid-template-columns: 22px minmax(0,1fr); gap:6px 12px; padding:12px 14px; border-radius:10px; border:1px solid var(--vscode-panel-border, rgba(127,127,127,.25)); background: var(--vscode-sideBar-background, #1b1f27); }
  .pk-row.on { border-color: var(--vscode-focusBorder, #5B9DFF); }
  .pk-row input[type=checkbox] { margin-top:8px; width:16px; height:16px; }
  .pk-body { display:flex; flex-direction:column; gap:5px; min-width:0; }
  .pk-name { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
  .pk-name input { flex:1; min-width:180px; font: inherit; font-size:13px; font-weight:600; padding:5px 8px; border-radius:5px; border:1px solid var(--vscode-input-border, rgba(127,127,127,.35)); background: var(--vscode-input-background, rgba(127,127,127,.08)); color: var(--vscode-input-foreground, var(--vscode-foreground)); }
  .badge { font-size:10.5px; padding:2px 7px; border-radius:999px; background: rgba(91,157,255,.18); color: var(--vscode-foreground); }
  .badge.live { background: rgba(76,195,138,.18); }
  .pk-meta { font-size:11.5px; opacity:.7; }
  .pk-first, .pk-recent { font-size:12px; opacity:.85; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .pk-recent { font-family: var(--vscode-editor-font-family); font-size:11px; opacity:.6; }
  .pk-h { display:grid; grid-template-columns: minmax(0,1fr) minmax(160px, 240px); gap:6px 12px; align-items:center; padding:10px 14px; border-radius:10px; border:1px dashed var(--vscode-panel-border, rgba(127,127,127,.35)); }
  .pk-h select { width:100%; }
  .pk-foot { position:sticky; bottom:0; display:flex; gap:8px; justify-content:flex-end; padding:12px 0 4px; background: var(--vscode-editor-background); }
  .empty { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; text-align:center; line-height:1.9; opacity:.7; pointer-events:none; padding:24px; }
  .hint { position:absolute; left:12px; bottom:10px; font-size:11px; opacity:.55; pointer-events:none; }
  @media (max-width: 720px) { .main { flex-direction:column; } aside { width:auto; max-height:45%; border-left:0; border-top:1px solid var(--vscode-panel-border, rgba(127,127,127,.25)); } }
</style>
</head>
<body>
<div class="app">
  <header>
    <h1 id="title">세션 그래프</h1>
    <span class="stats" id="stats"></span>
    <div class="controls">
      <label>작업 폴더 <select id="folder"></select></label>
      <label><input type="checkbox" id="subs"> 서브에이전트</label>
      <label>범위 <select id="win">
        <option value="3">최근 3시간</option>
        <option value="24">최근 24시간</option>
        <option value="168">최근 7일</option>
        <option value="0">전체</option>
      </select></label>
      <span class="seg" role="group" aria-label="모드"><button type="button" id="m-view" aria-pressed="true">흐름 보기</button><button type="button" id="m-edit" aria-pressed="false">방향 편집</button></span>
      <label id="enf-wrap" hidden><input type="checkbox" id="enforce"> 차단</label>
      <button type="button" id="pick">멤버 고르기</button>
      <button type="button" id="fit">화면 맞춤</button>
      <button type="button" id="relayout">배치 초기화</button>
    </div>
  </header>
  <div class="main">
    <div class="stage" id="stage">
      <div class="world" id="world">
        <svg class="edges" id="edges" width="1" height="1"></svg>
        <div id="nodes"></div>
      </div>
      <div class="empty" id="empty" hidden>아직 기록된 세션이 없습니다.<br>Claude Code에 session-flow 플러그인을 설치하고 세션을 다시 열어주세요.</div>
      <div class="hint">드래그: 노드 이동 · 빈 곳 드래그: 화면 이동 · 휠: 확대/축소 · 더블클릭: 타임라인</div>
    </div>
    <aside id="side"></aside>
    <div class="newbar" id="newbar" hidden><span id="newtext"></span><button type="button" class="primary" id="newpick">고르기</button><button type="button" id="newignore">추가 안 함</button></div>
    <div class="picker" id="picker" hidden></div>
  </div>
</div>

<script nonce="${n}">
(function () {
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const SVGNS = 'http://www.w3.org/2000/svg';
  let graph = { nodes: [], edges: [] };
  let pos = {};
  let sel = null;            // { type:'node'|'edge'|'diff', id }
  let diffState = null;
  let picker = null;          // 확장에서 받은 고르기 데이터
  let pickerOpen = false;
  let pickerDismissed = false;
  let currentFolder = '';
  let H = { exists: false, enforce: false, members: [], edges: [] }; // 하네스 설정
  let mode = 'view';          // 'view' | 'edit'
  let connectFrom = null;     // 방향 편집: 화살표 시작 노드
  const isMember = (id) => H.members.some((m) => m.session === id);
  const memberOf = (id) => H.members.find((m) => m.session === id);
  const hasRule = (f, t) => H.edges.some((e) => e.from === f && e.to === t);      // { key, first, last, file, edits, back, data }
  let view = { x: 0, y: 0, k: 1 };
  let firstFit = true;

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const fmt = (ts) => { const d = new Date(ts); return isNaN(d) ? '' : d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' }); };
  const fmtFull = (ts) => { const d = new Date(ts); return isNaN(d) ? '' : d.toLocaleString([], { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); };
  const size = (n) => n.kind === 'subagent' ? { w: 150, h: 56 } : { w: 200, h: 80 };
  const labelOf = (id) => { const n = graph.nodes.find((x) => x.id === id); return n ? n.label : id; };

  // ── 배치 ──
  function layout(force) {
    const sessions = graph.nodes.filter((n) => n.kind !== 'subagent');
    const missing = sessions.filter((n) => force || !pos[n.id]);
    if (missing.length) {
      const deg = {};
      graph.edges.forEach((e) => { deg[e.from] = (deg[e.from] || 0) + e.count; deg[e.to] = (deg[e.to] || 0) + e.count; });
      const order = (force ? sessions : missing).slice().sort((a, b) => (deg[b.id] || 0) - (deg[a.id] || 0));
      const N = force ? order.length : sessions.length;
      const R = Math.max(240, N * 62);
      const placed = force ? 0 : sessions.length - missing.length;
      order.forEach((n, i) => {
        const a = -Math.PI / 2 + (2 * Math.PI * (placed + i)) / Math.max(1, N);
        pos[n.id] = { x: Math.round(R * Math.cos(a)), y: Math.round(R * 0.72 * Math.sin(a)) };
      });
    }
    // 서브에이전트는 부모 바깥쪽에 붙인다
    const subs = graph.nodes.filter((n) => n.kind === 'subagent');
    const byParent = {};
    subs.forEach((s) => { (byParent[s.parent] = byParent[s.parent] || []).push(s); });
    Object.entries(byParent).forEach(([pid, list]) => {
      const p = pos[pid]; if (!p) return;
      const len = Math.hypot(p.x, p.y) || 1;
      const ux = p.x / len || 0, uy = len === 1 ? 1 : p.y / len;
      list.forEach((s, i) => {
        if (pos[s.id] && !force) return;
        const spread = (i - (list.length - 1) / 2) * 170;
        pos[s.id] = { x: Math.round(p.x + ux * 190 - uy * spread), y: Math.round(p.y + uy * 150 + ux * spread) };
      });
    });
  }

  // ── 그리기 ──
  function render() {
    $('empty').hidden = graph.nodes.length > 0;
    const sessCount = graph.nodes.filter((n) => n.kind === 'session').length;
    const msgCount = graph.edges.filter((e) => !String(e.from).includes('::') && !String(e.to).includes('::')).reduce((a, e) => a + e.count, 0);
    const live = graph.nodes.filter((n) => n.kind === 'session' && n.live).length;
    $('stats').textContent = '세션 ' + sessCount + '개 · 메시지 ' + msgCount + '건' + (live ? ' · 작업 중 ' + live : '');

    const host = $('nodes');
    host.replaceChildren();
    for (const n of graph.nodes) {
      const p = pos[n.id] || { x: 0, y: 0 };
      const { w } = size(n);
      const mem = memberOf(n.id);
      const b = el('button', 'node ' + n.kind + (n.live ? ' live' : '') + (sel && sel.type === 'node' && sel.id === n.id ? ' sel' : '')
        + (connectFrom === n.id ? ' connecting' : '') + (H.exists && n.kind === 'session' && !mem ? ' nonmember' : ''));
      b.type = 'button';
      b.dataset.id = n.id;
      b.style.left = (p.x - w / 2) + 'px';
      b.style.top = (p.y - size(n).h / 2) + 'px';
      b.title = (mem && mem.role ? '역할: ' + mem.role + '\\n' : '') + (n.cwd || '') + (n.handle ? '  @' + n.handle : '') + (n.kind === 'session' ? '\\n더블클릭: Claude Code에서 열기' : '');
      const tt = el('span', 't', n.label);
      if (mem && mem.main) tt.append(el('span', 'mb', '메인'));
      b.append(tt);
      if (mem && mem.role) b.append(el('span', 'rl', mem.role));
      const sub = (n.kind === 'ghost' || n.kind === 'other') ? n.sub : (n.live ? '● 작업 중 · ' : '') + n.eventCount + ' events' + (n.fileCount ? ' · 파일 ' + n.fileCount : '');
      b.append(el('span', 's' + (n.live ? ' on' : ''), sub));
      attachDrag(b, n);
      host.append(b);
    }
    drawEdges();
    renderSide();
  }

  function rectEdgePoint(c, w, h, dx, dy) {
    const tx = dx ? (w / 2) / Math.abs(dx) : Infinity;
    const ty = dy ? (h / 2) / Math.abs(dy) : Infinity;
    const t = Math.min(tx, ty);
    return { x: c.x + dx * t, y: c.y + dy * t };
  }

  function drawEdges() {
    const svg = $('edges');
    svg.replaceChildren();
    const defs = document.createElementNS(SVGNS, 'defs');
    [['ah', 'var(--edge)'], ['ah-a', 'var(--accent)'], ['ah-s', 'var(--vscode-foreground)'], ['ah-p', 'var(--sub)'], ['ah-r', 'var(--viol)']].forEach(([id, col]) => {
      const m = document.createElementNS(SVGNS, 'marker');
      m.setAttribute('id', id); m.setAttribute('viewBox', '0 0 10 10'); m.setAttribute('refX', '8'); m.setAttribute('refY', '5');
      m.setAttribute('markerWidth', '7'); m.setAttribute('markerHeight', '7'); m.setAttribute('orient', 'auto-start-reverse');
      const p = document.createElementNS(SVGNS, 'path'); p.setAttribute('d', 'M0 0 L10 5 L0 10 z'); p.style.fill = col;
      m.append(p); defs.append(m);
    });
    svg.append(defs);
    const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
    const list = edgeList();
    const pairs = new Set(list.map((e) => e.from + '→' + e.to));
    for (const e of list) {
      const a = nodeById.get(e.from), b = nodeById.get(e.to);
      if (!a || !b || !pos[a.id] || !pos[b.id]) continue;
      const pa = pos[a.id], pb = pos[b.id];
      let dx = pb.x - pa.x, dy = pb.y - pa.y;
      const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
      const both = pairs.has(e.to + '→' + e.from);
      const off = both ? 9 : 0;                 // 왕복이면 두 줄로 나란히
      const nx = -dy * off, ny = dx * off;
      const sa = size(a), sb = size(b);
      const p1 = rectEdgePoint({ x: pa.x + nx, y: pa.y + ny }, sa.w + 16, sa.h + 16, dx, dy);
      const p2 = rectEdgePoint({ x: pb.x + nx, y: pb.y + ny }, sb.w + 20, sb.h + 20, -dx, -dy);
      const isSub = String(e.from).includes('::') || String(e.to).includes('::');
      const isSel = sel && sel.type === 'edge' && sel.id === e.id;
      const line = document.createElementNS(SVGNS, 'line');
      line.setAttribute('x1', p1.x); line.setAttribute('y1', p1.y); line.setAttribute('x2', p2.x); line.setAttribute('y2', p2.y);
      line.setAttribute('class', 'edge-line' + (e.active && !e.viol ? ' active' : '') + (isSel ? ' sel' : '') + (isSub ? ' sub' : '') + (e.viol ? ' viol' : '') + (e.plan ? ' plan' : '') + (e.rule ? ' rule' : ''));
      line.setAttribute('marker-end', 'url(#' + (isSel ? 'ah-s' : e.viol ? 'ah-r' : (e.active || e.rule) ? 'ah-a' : isSub ? 'ah-p' : 'ah') + ')');
      const hit = document.createElementNS(SVGNS, 'line');
      hit.setAttribute('x1', p1.x); hit.setAttribute('y1', p1.y); hit.setAttribute('x2', p2.x); hit.setAttribute('y2', p2.y);
      hit.setAttribute('class', 'edge-hit');
      const t = document.createElementNS(SVGNS, 'title');
      t.textContent = labelOf(e.from) + ' → ' + labelOf(e.to) + (e.rule || e.plan ? ' · 정한 방향' : ' · ' + e.count + '건') + (e.viol ? ' · 하네스 규칙 밖' : ''); hit.append(t);
      hit.addEventListener('click', (ev) => { ev.stopPropagation(); select(e.rule || e.plan ? { type: 'rule', id: e.id, from: e.from, to: e.to } : { type: 'edge', id: e.id }); });
      const lab = document.createElementNS(SVGNS, 'text');
      const mx = (p1.x + p2.x) / 2 + (both ? nx * 2.2 : -dy * 12), my = (p1.y + p2.y) / 2 + (both ? ny * 2.2 : dx * 12);
      lab.setAttribute('x', mx); lab.setAttribute('y', my + 4); lab.setAttribute('text-anchor', 'middle'); lab.setAttribute('class', 'edge-label' + (e.viol ? ' viol' : ''));
      lab.textContent = e.rule || e.plan ? '' : String(e.count) + (e.blocked ? ' (차단 ' + e.blocked + ')' : '');
      svg.append(line, lab, hit);
    }
  }

  // ── 상세 패널 ──
  function renderSide() {
    const side = $('side');
    side.replaceChildren();
    side.classList.toggle('wide', !!(sel && sel.type === 'diff'));
    if (sel && sel.type === 'diff') return renderDiff(side);
    if (sel && sel.type === 'rule') return renderRuleSide(side);
    if (mode === 'edit' && (!sel || connectFrom)) return renderEditHelp(side);
    if (!sel) {
      side.append(el('h2', null, $('title').textContent || '세션 사이의 흐름'));
      side.append(el('div', 'muted', '노드를 누르면 세션 상세, 화살표를 누르면 두 세션이 주고받은 메시지가 여기에 나옵니다. 숫자는 메시지 수, 흐르는 점선은 방금(90초 이내) 오간 메시지입니다.'));
      const recent = graph.edges.slice().sort((a, b) => b.last - a.last).slice(0, 8);
      if (recent.length) {
        side.append(el('div', 'muted', '최근 연결'));
        recent.forEach((e) => {
          const r = el('button', 'ev');
          r.type = 'button';
          r.append(el('span', 'k', fmt(e.last)), el('span', 'v', labelOf(e.from) + ' → ' + labelOf(e.to) + ' (' + e.count + ')'));
          r.addEventListener('click', () => select({ type: 'edge', id: e.id }));
          side.append(r);
        });
      }
      return;
    }
    if (sel.type === 'edge') {
      const e = graph.edges.find((x) => x.id === sel.id);
      if (!e) { sel = null; return renderSide(); }
      const back = graph.edges.find((x) => x.from === e.to && x.to === e.from);
      side.append(el('h2', null, labelOf(e.from) + ' → ' + labelOf(e.to)));
      side.append(el('div', 'muted', e.count + '건' + (back ? ' · 반대 방향 ' + back.count + '건' : '') + ' · 마지막 ' + fmtFull(e.last)));
      if (H.exists && isMember(e.from) && isMember(e.to) && !hasRule(e.from, e.to)) {
        const w = el('div', 'warn', '하네스에서 정한 방향이 아닙니다.' + (e.blocked ? ' 이 중 ' + e.blocked + '건은 차단됐습니다.' : ''));
        side.append(w);
        const allow = el('button', '', '이 방향 허용하기'); allow.type = 'button';
        allow.addEventListener('click', () => addRule(e.from, e.to));
        side.append(allow);
      }
      const msgs = e.messages.map((m) => ({ ...m, from: e.from, to: e.to }))
        .concat(back ? back.messages.map((m) => ({ ...m, from: back.from, to: back.to })) : [])
        .sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
      msgs.forEach((m) => {
        const box = el('div', 'msg' + (m.from === e.from ? ' out' : ''));
        box.append(el('span', 'h', fmt(m.ts) + ' · ' + labelOf(m.from) + ' → ' + labelOf(m.to) + (m.via ? ' (' + m.via + ')' : '') + (m.blocked ? ' · 차단됨' : '')), el('span', 'b', m.text || ''));
        side.append(box);
      });
      const row = el('div', 'row');
      [[e.from, 'primary'], [e.to, '']].forEach(([id, cls]) => {
        const n = graph.nodes.find((x) => x.id === id);
        if (!n || n.kind === 'ghost') return;
        const b = el('button', cls, labelOf(id) + ' 타임라인');
        b.type = 'button';
        b.addEventListener('click', () => vscode.postMessage({ type: 'openTimeline', id: n.kind === 'subagent' ? n.parent : id }));
        row.append(b);
      });
      side.append(row);
      return;
    }
    const n = graph.nodes.find((x) => x.id === sel.id);
    if (!n) { sel = null; return renderSide(); }
    side.append(el('h2', null, n.label));
    if (n.kind === 'other') {
      side.append(el('div', 'muted', '그래프에 넣지 않은 세션과 주고받은 메시지를 한데 모은 노드입니다. 화살표를 누르면 어느 세션과 오간 메시지인지 함께 보입니다.'));
      (n.members || []).forEach((m) => side.append(el('div', 'ev', m)));
      const b = el('button', 'primary', '세션 고르기'); b.type = 'button';
      b.addEventListener('click', () => openPicker());
      side.append(b);
      return;
    }
    if (n.kind === 'ghost') {
      side.append(el('div', 'muted', '메시지가 @' + n.handle + ' 앞으로 갔지만, 어떤 세션인지 아직 알아내지 못했습니다. 그 세션에 플러그인이 적용된 상태로 메시지를 한 번 받으면 자동으로 연결되고, 지금 바로 직접 연결할 수도 있습니다.'));
      const b = el('button', 'primary', '세션에 연결하기'); b.type = 'button';
      b.addEventListener('click', () => vscode.postMessage({ type: 'link', handle: n.handle }));
      side.append(b);
      return;
    }
    side.append(el('div', 'muted', [n.cwd, n.handle ? '@' + n.handle : '', n.live ? '작업 중' : '대기', n.eventCount + ' events', n.fileCount ? '수정 파일 ' + n.fileCount + '개' : ''].filter(Boolean).join(' · ')));
    const mem = memberOf(n.id);
    if (mem && mem.role) side.append(el('div', null, '역할: ' + mem.role));
    const row = el('div', 'row');
    const sid = n.kind === 'subagent' ? n.parent : n.id;
    const oc = el('button', 'primary', 'Claude Code에서 열기'); oc.type = 'button';
    oc.addEventListener('click', () => vscode.postMessage({ type: 'openSession', id: sid }));
    const tl = el('button', '', '타임라인'); tl.type = 'button';
    tl.addEventListener('click', () => vscode.postMessage({ type: 'openTimeline', id: sid }));
    row.append(oc, tl);
    if (n.kind === 'session') {
      if (mem && !mem.main) {
        const mm = el('button', '', '메인으로 지정'); mm.type = 'button';
        mm.addEventListener('click', () => { H.members.forEach((x) => { x.main = x.session === n.id; }); vscode.postMessage({ type: 'setMain', id: n.id }); render(); });
        row.append(mm);
      }
      const rn = el('button', '', '이름 바꾸기'); rn.type = 'button';
      rn.addEventListener('click', () => vscode.postMessage({ type: 'rename', id: n.id, current: n.label }));
      row.append(rn);
    }
    side.append(row);
    if (H.exists && n.kind === 'session' && !mem) side.append(el('div', 'muted', '이 세션은 하네스 멤버가 아닙니다. "멤버 고르기"에서 추가할 수 있습니다.'));
    const conns = graph.edges.filter((e) => e.from === n.id || e.to === n.id);
    if (conns.length) {
      side.append(el('div', 'muted', '연결'));
      conns.forEach((e) => {
        const r = el('button', 'ev'); r.type = 'button';
        r.append(el('span', 'k', e.from === n.id ? '보냄 ' + e.count : '받음 ' + e.count), el('span', 'v', e.from === n.id ? '→ ' + labelOf(e.to) : '← ' + labelOf(e.from)));
        r.addEventListener('click', () => select({ type: 'edge', id: e.id }));
        side.append(r);
      });
    }
    if (n.changedFiles && n.changedFiles.length) {
      side.append(el('div', 'muted', '변경된 파일 ' + n.changedFiles.length + '개 · 누르면 이 세션에서 바뀐 전/후 비교'));
      const box = el('div', 'files');
      n.changedFiles.forEach((f) => {
        const r = el('button', 'fl'); r.type = 'button';
        r.title = f.file;
        r.append(el('span', 'nm', f.file.split(/[\\/]/).pop()), el('span', 'ct', '수정 ' + f.edits + '회 · ' + fmt(f.ts)));
        r.addEventListener('click', () => showDiff({ first: f.first, last: f.last, file: f.file, edits: f.edits }));
        box.append(r);
      });
      side.append(box);
    }
    if (n.recent && n.recent.length) {
      side.append(el('div', 'muted', '최근 이벤트'));
      n.recent.forEach((e) => {
        const r = el('button', 'ev'); r.type = 'button';
        const k = e.kind === 'tool' || e.kind === 'tool_error' ? e.tool : ({ prompt: 'Prompt', delegate: '→ 위임', message: '✉ 보냄', message_in: '✉ 받음', subagent_start: '시작', subagent_stop: '← 결과' }[e.kind] || e.kind);
        const v = e.file ? e.file.split(/[\\\\/]/).pop() : (e.target ? e.target + ': ' : '') + (e.summary || '');
        r.append(el('span', 'k', fmt(e.ts) + ' ' + k), el('span', 'v', (e.hasDiff ? '± ' : '') + v));
        r.title = e.summary || '';
        r.addEventListener('click', () => (e.hasDiff ? showDiff({ first: e.idx, last: e.idx, file: e.file, edits: 1 }) : vscode.postMessage({ type: 'open', idx: e.idx })));
        side.append(r);
      });
    }
  }

  // ── 전/후 비교 (git 스타일) ──
  function showDiff(o) {
    const key = o.first + '-' + o.last;
    diffState = { ...o, key, back: sel, data: undefined };
    sel = { type: 'diff', id: key };
    vscode.postMessage({ type: 'diff', key, first: o.first, last: o.last });
    render();
  }

  function renderDiff(side) {
    const d = diffState;
    const head = el('div', 'dhead');
    const back = el('button', 'back', '← 돌아가기'); back.type = 'button';
    back.addEventListener('click', () => { sel = d.back || null; diffState = null; render(); });
    head.append(back);
    head.append(el('h2', null, (d.file || '').split(/[\\/]/).pop()));
    head.append(el('div', 'muted', d.file || ''));
    const data = d.data;
    if (data) {
      const st = el('div', 'dstat');
      const total = data.add + data.del;
      const bars = el('span', 'bar5');
      const na = total ? Math.round((data.add / total) * 5) : 0;
      for (let i = 0; i < 5; i++) { const b = document.createElement('i'); b.className = i < na ? 'a' : (i < (total ? 5 : 0) ? 'd' : ''); bars.append(b); }
      st.append(el('span', 'plus', '+' + data.add), el('span', 'minus', '−' + data.del), bars);
      const when = data.from === data.to ? fmt(data.to) : fmt(data.from) + ' → ' + fmt(data.to);
      st.append(el('span', 'muted', (d.edits > 1 ? '수정 ' + d.edits + '회 누적 · ' : '') + when + (data.isNew ? ' · 새 파일' : '')));
      head.append(st);
    }
    const row = el('div', 'row');
    const ed = el('button', 'primary', '에디터에서 나란히 보기'); ed.type = 'button';
    ed.addEventListener('click', () => vscode.postMessage({ type: 'openDiff', first: d.first, last: d.last }));
    const of = el('button', '', '파일 열기'); of.type = 'button';
    of.addEventListener('click', () => vscode.postMessage({ type: 'openFile', file: d.file }));
    row.append(ed, of);
    head.append(row);
    side.append(head);

    if (data === undefined) { side.append(el('div', 'note', '불러오는 중…')); return; }
    if (data === null) { side.append(el('div', 'note', '이 수정의 스냅샷이 없어 비교할 수 없습니다. (1MB가 넘는 파일은 스냅샷을 남기지 않습니다)')); return; }
    if (!data.hunks.length) { side.append(el('div', 'note', '내용 변경이 없습니다.')); return; }
    const box = el('div', 'diffbox');
    data.hunks.forEach((h) => {
      box.append(el('div', 'hk', '@@ -' + h.oldStart + ',' + h.oldLines + ' +' + h.newStart + ',' + h.newLines + ' @@'));
      h.lines.forEach((l) => {
        const r = el('div', 'dl' + (l.t === '+' ? ' add' : l.t === '-' ? ' del' : ''));
        r.append(el('span', 'no', l.o != null ? String(l.o) : ''), el('span', 'no', l.n != null ? String(l.n) : ''), el('span', 'sg', l.t === ' ' ? '' : (l.t === '-' ? '−' : '+')), el('span', 'tx', l.text));
        box.append(r);
      });
    });
    side.append(box);
    if (data.truncated) side.append(el('div', 'note', '변경이 많아 일부만 표시했습니다. 전체는 "에디터에서 나란히 보기"로 확인하세요.'));
  }

  function select(s) { sel = s; render(); }

  // ── 하네스: 흐름 보기 / 방향 편집 ──
  function edgeList() {
    if (mode === 'edit') return H.edges.map((r) => ({ id: 'rule:' + r.from + '→' + r.to, from: r.from, to: r.to, count: 0, rule: true }));
    const out = graph.edges.map((e) => ({ ...e, viol: H.exists && isMember(e.from) && isMember(e.to) && !hasRule(e.from, e.to) }));
    const have = new Set(out.map((e) => e.from + '→' + e.to));
    // 정했지만 아직 메시지가 오가지 않은 방향은 흐린 점선
    H.edges.forEach((r) => { if (!have.has(r.from + '→' + r.to)) out.push({ id: 'plan:' + r.from + '→' + r.to, from: r.from, to: r.to, count: 0, plan: true }); });
    return out;
  }

  function setMode(m) {
    mode = m; connectFrom = null;
    document.body.classList.toggle('edit', m === 'edit');
    $('m-view').setAttribute('aria-pressed', String(m === 'view'));
    $('m-edit').setAttribute('aria-pressed', String(m === 'edit'));
    if (m === 'edit' && !H.exists) { openPicker(); return; }
    sel = null; render();
  }

  function addRule(from, to) {
    if (!hasRule(from, to)) H.edges.push({ from, to });
    vscode.postMessage({ type: 'addRule', from, to });
    render();
  }
  function removeRule(from, to) {
    H.edges = H.edges.filter((e) => !(e.from === from && e.to === to));
    vscode.postMessage({ type: 'removeRule', from, to });
    sel = null; render();
  }

  // 방향 편집에서 노드를 누르면: 첫 클릭 = 시작, 두 번째 클릭 = 도착
  function editClick(n) {
    if (n.kind !== 'session' || !isMember(n.id)) { select({ type: 'node', id: n.id }); return; }
    if (!connectFrom) { connectFrom = n.id; sel = { type: 'node', id: n.id }; render(); return; }
    if (connectFrom === n.id) { connectFrom = null; render(); return; }
    const from = connectFrom; connectFrom = null;
    addRule(from, n.id);
    select({ type: 'rule', id: 'rule:' + from + '→' + n.id, from, to: n.id });
  }

  function renderRuleSide(side) {
    side.append(el('h2', null, labelOf(sel.from) + ' → ' + labelOf(sel.to)));
    side.append(el('div', 'muted', '"' + labelOf(sel.from) + '"이(가) "' + labelOf(sel.to) + '"에게 메시지를 보낼 수 있는 방향입니다.'));
    const row = el('div', 'row');
    const rm = el('button', '', '이 방향 지우기'); rm.type = 'button';
    rm.addEventListener('click', () => removeRule(sel.from, sel.to));
    row.append(rm);
    if (!hasRule(sel.to, sel.from)) {
      const rev = el('button', '', '반대 방향도 추가'); rev.type = 'button';
      rev.addEventListener('click', () => addRule(sel.to, sel.from));
      row.append(rev);
    }
    side.append(row);
  }

  function renderEditHelp(side) {
    side.append(el('h2', null, '방향 편집'));
    side.append(el('div', 'muted', connectFrom
      ? '"' + labelOf(connectFrom) + '"에서 보낼 대상 노드를 누르세요. 같은 노드를 다시 누르거나 Esc로 취소합니다.'
      : '보내는 세션을 누른 다음 받는 세션을 누르면 화살표가 생깁니다. 화살표를 누르면 지울 수 있습니다. 바꾼 내용은 바로 저장되고, 각 세션에는 다음 질문부터 역할과 연락 대상이 안내됩니다.'));
    const main = H.members.find((m) => m.main);
    side.append(el('div', 'muted', '메인: ' + (main ? (main.name || labelOf(main.session)) : '없음 (노드를 누르고 "메인으로 지정")') + ' · 방향 ' + H.edges.length + '개'));
    side.append(el('div', 'muted', '차단: ' + (H.enforce ? '켜짐 — 정한 방향 밖으로 보내는 메시지를 막습니다.' : '꺼짐 — 안내만 하고 막지 않습니다. 상단 "차단"으로 켤 수 있습니다.')));
    side.append(el('div', 'muted', '설정 파일: ' + (H.path || '.claude/session-flow.json') + ' (git으로 공유 가능)'));
  }

  // ── 세션 고르기 ──
  function updatePickerChrome() {
    const nc = picker ? picker.newCount : 0;
    $('newbar').hidden = !nc || pickerOpen;
    $('newtext').textContent = '새 세션 ' + nc + '개가 생겼습니다. 그래프에 넣을지 골라주세요.';
    if (picker && picker.needsSetup && !pickerDismissed && !pickerOpen) openPicker(true);
  }

  function openPicker(first) {
    if (!picker) return;
    pickerOpen = true;
    $('newbar').hidden = true;
    const box = $('picker');
    box.replaceChildren();
    box.hidden = false;
    const wrap = el('div', 'pk');
    const fname = (currentFolder || '').split(/[\\/]/).pop();
    wrap.append(el('h2', null, '하네스 멤버 고르기 · ' + fname));
    wrap.append(el('div', 'lead', '이 폴더에서 함께 일할 세션을 체크하고 이름과 역할을 적은 뒤, 총괄할 세션 하나를 "메인"으로 정하세요. 저장하면 프로젝트의 .claude/session-flow.json 에 기록되고, 각 세션에는 다음 질문부터 자기 역할과 연락 대상이 안내됩니다. 메시지 방향은 그다음 "방향 편집"에서 그립니다.'));

    const tools = el('div', 'pk-tools');
    const all = el('button', '', '전체 선택'); all.type = 'button';
    const none = el('button', '', '전체 해제'); none.type = 'button';
    const cnt = el('span', 'cnt');
    tools.append(all, none, cnt);
    wrap.append(tools);

    const list = el('div', 'pk-list');
    const rows = [];
    const recentCut = Date.now() - 6 * 3600 * 1000;
    picker.candidates.forEach((c, i) => {
      const row = el('div', 'pk-row');
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.id = 'pk-c-' + i;
      cb.checked = picker.needsSetup ? (c.live || c.last > recentCut) : c.selected;
      const body = el('div', 'pk-body');
      const nm = el('div', 'pk-name');
      const inp = document.createElement('input');
      inp.type = 'text'; inp.id = 'pk-n-' + i; inp.value = c.name; inp.placeholder = c.autoName || '이름';
      inp.setAttribute('aria-label', '세션 이름');
      nm.append(inp);
      const mainLab = document.createElement('label'); mainLab.className = 'pk-main';
      const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'pk-main'; radio.id = 'pk-m-' + i; radio.checked = !!c.main;
      mainLab.append(radio, document.createTextNode('메인'));
      nm.append(mainLab);
      if (c.isNew) nm.append(el('span', 'badge', '새 세션'));
      if (c.live) nm.append(el('span', 'badge live', '작업 중'));
      const lab = document.createElement('label');
      lab.htmlFor = cb.id; lab.className = 'pk-meta';
      lab.textContent = '마지막 활동 ' + fmtFull(c.last) + ' · ' + c.eventCount + ' events' + (c.fileCount ? ' · 수정 파일 ' + c.fileCount + '개' : '') + ' · ' + c.id.slice(0, 8);
      const role = document.createElement('input');
      role.type = 'text'; role.id = 'pk-r-' + i; role.className = 'pk-role'; role.value = c.role || '';
      role.placeholder = '역할 (예: GNN 학습 담당, 결과는 메인에 보고)'; role.setAttribute('aria-label', '역할');
      radio.addEventListener('change', () => { if (radio.checked) { cb.checked = true; count(); } });
      body.append(nm, role, lab);
      if (c.firstPrompt) body.append(el('div', 'pk-first', '첫 질문: ' + c.firstPrompt));
      if (c.recent && c.recent.length) body.append(el('div', 'pk-recent', '최근: ' + c.recent.join('  ·  ')));
      row.append(cb, body);
      const sync = () => { row.classList.toggle('on', cb.checked); count(); };
      cb.addEventListener('change', sync);
      rows.push({ c, cb, inp, row, role, radio });
      list.append(row);
    });
    wrap.append(list);
    function count() { const n = rows.filter((r) => r.cb.checked).length; cnt.textContent = n + '개 선택'; rows.forEach((r) => r.row.classList.toggle('on', r.cb.checked)); }
    all.addEventListener('click', () => { rows.forEach((r) => { r.cb.checked = true; }); count(); });
    none.addEventListener('click', () => { rows.forEach((r) => { r.cb.checked = false; }); count(); });
    count();

    const hsel = [];
    if (picker.handles && picker.handles.length) {
      wrap.append(el('h2', null, '어느 세션인지 모르는 상대'));
      wrap.append(el('div', 'lead', '메시지를 주고받았지만 어떤 세션인지 자동으로 알아내지 못한 주소입니다. 아는 세션이면 연결해주세요.'));
      picker.handles.forEach((h, i) => {
        const r = el('div', 'pk-h');
        const info = el('div', 'pk-body');
        info.append(el('div', 'pk-name', h.label + (h.count ? ' · 메시지 ' + h.count + '건' : '')));
        if (h.sample) info.append(el('div', 'pk-first', h.sample));
        const sel2 = document.createElement('select');
        sel2.id = 'pk-h-' + i; sel2.setAttribute('aria-label', h.label + ' 연결할 세션');
        const o0 = document.createElement('option'); o0.value = ''; o0.textContent = '연결 안 함'; sel2.append(o0);
        picker.candidates.forEach((c) => { const o = document.createElement('option'); o.value = c.id; o.textContent = c.name || c.autoName || c.id.slice(0, 8); if (h.linked === c.id) o.selected = true; sel2.append(o); });
        r.append(info, sel2);
        hsel.push({ h, sel2 });
        wrap.append(r);
      });
    }

    const foot = el('div', 'pk-foot');
    const cancel = el('button', '', picker.needsSetup ? '나중에' : '취소'); cancel.type = 'button';
    cancel.addEventListener('click', () => { pickerDismissed = true; closePicker(); });
    const ok = el('button', 'primary', '그래프에 적용'); ok.type = 'button';
    ok.addEventListener('click', () => {
      const names = {}; rows.forEach((r) => { names[r.c.id] = r.inp.value; });
      const roles = {}; rows.forEach((r) => { roles[r.c.id] = r.role.value.trim(); });
      const mainRow = rows.find((r) => r.radio.checked && r.cb.checked);
      const aliases = {}; hsel.forEach(({ h, sel2 }) => { aliases[h.handle] = sel2.value; });
      const selected = rows.filter((r) => r.cb.checked).map((r) => r.c.id);
      vscode.postMessage({ type: 'savePicks', folder: currentFolder, selected, seen: picker.candidates.map((c) => c.id), names, aliases, roles, main: mainRow ? mainRow.c.id : null });
      // 확장이 새 설정을 보내기 전에도 화면이 맞게 보이도록 바로 반영
      H = { ...H, exists: true, members: selected.map((id) => ({ session: id, name: names[id] || '', role: roles[id] || '', main: !!(mainRow && mainRow.c.id === id) })), edges: H.edges.filter((e) => selected.includes(e.from) && selected.includes(e.to)) };
      $('enf-wrap').hidden = false;
      picker.needsSetup = false; picker.newCount = 0; // 확장이 새 데이터를 보내기 전에 다시 열리지 않도록
      sel = null; firstFit = true; closePicker();
    });
    foot.append(cancel, ok);
    wrap.append(foot);
    box.append(wrap);
    if (!first && rows[0]) rows[0].inp.focus();
  }

  function closePicker() {
    pickerOpen = false;
    $('picker').hidden = true;
    updatePickerChrome();
  }

  // ── 상호작용: 노드 드래그, 화면 이동/확대 ──
  function applyView() { $('world').style.transform = 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.k + ')'; }

  function attachDrag(b, n) {
    b.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      ev.stopPropagation();
      const start = { x: ev.clientX, y: ev.clientY }, p0 = { ...(pos[n.id] || { x: 0, y: 0 }) };
      let moved = false;
      b.setPointerCapture(ev.pointerId);
      const move = (e) => {
        const dx = (e.clientX - start.x) / view.k, dy = (e.clientY - start.y) / view.k;
        if (!moved && Math.hypot(dx, dy) < 3) return;
        moved = true;
        pos[n.id] = { x: Math.round(p0.x + dx), y: Math.round(p0.y + dy) };
        const s = size(n);
        b.style.left = (pos[n.id].x - s.w / 2) + 'px';
        b.style.top = (pos[n.id].y - s.h / 2) + 'px';
        drawEdges();
      };
      const up = () => {
        b.removeEventListener('pointermove', move); b.removeEventListener('pointerup', up);
        if (moved) vscode.postMessage({ type: 'positions', positions: pos });
        else if (mode === 'edit') editClick(n);
        else select({ type: 'node', id: n.id });
      };
      b.addEventListener('pointermove', move); b.addEventListener('pointerup', up);
    });
    b.addEventListener('dblclick', () => { if (n.kind === 'session' || n.kind === 'subagent') vscode.postMessage({ type: 'openSession', id: n.kind === 'subagent' ? n.parent : n.id }); });
    b.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); select({ type: 'node', id: n.id }); } });
  }

  const stage = $('stage');
  stage.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    const start = { x: ev.clientX, y: ev.clientY, vx: view.x, vy: view.y };
    let moved = false;
    stage.classList.add('panning');
    stage.setPointerCapture(ev.pointerId);
    const move = (e) => { moved = moved || Math.hypot(e.clientX - start.x, e.clientY - start.y) > 3; view.x = start.vx + e.clientX - start.x; view.y = start.vy + e.clientY - start.y; applyView(); };
    const up = () => { stage.classList.remove('panning'); stage.removeEventListener('pointermove', move); stage.removeEventListener('pointerup', up); if (!moved && sel) select(null); };
    stage.addEventListener('pointermove', move); stage.addEventListener('pointerup', up);
  });
  stage.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const r = stage.getBoundingClientRect();
    const mx = ev.clientX - r.left, my = ev.clientY - r.top;
    const k = Math.min(2.5, Math.max(0.25, view.k * Math.exp(-ev.deltaY * 0.0015)));
    view.x = mx - (mx - view.x) * (k / view.k); view.y = my - (my - view.y) * (k / view.k); view.k = k;
    applyView();
  }, { passive: false });

  function fit() {
    const pts = graph.nodes.map((n) => pos[n.id]).filter(Boolean);
    const r = stage.getBoundingClientRect();
    if (!pts.length) { view = { x: r.width / 2, y: r.height / 2, k: 1 }; return applyView(); }
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const minX = Math.min(...xs) - 140, maxX = Math.max(...xs) + 140, minY = Math.min(...ys) - 80, maxY = Math.max(...ys) + 80;
    const k = Math.min(1.2, Math.max(0.3, Math.min(r.width / (maxX - minX), r.height / (maxY - minY))));
    view = { k, x: r.width / 2 - ((minX + maxX) / 2) * k, y: r.height / 2 - ((minY + maxY) / 2) * k };
    applyView();
  }

  $('fit').addEventListener('click', fit);
  $('pick').addEventListener('click', () => openPicker());
  $('m-view').addEventListener('click', () => setMode('view'));
  $('m-edit').addEventListener('click', () => setMode('edit'));
  $('enforce').addEventListener('change', (e) => { H.enforce = e.target.checked; vscode.postMessage({ type: 'setEnforce', on: e.target.checked }); renderSide(); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && connectFrom) { connectFrom = null; render(); } });
  $('newpick').addEventListener('click', () => openPicker());
  $('newignore').addEventListener('click', () => { $('newbar').hidden = true; vscode.postMessage({ type: 'ignoreNew', folder: currentFolder }); });
  $('relayout').addEventListener('click', () => { pos = {}; layout(true); render(); fit(); vscode.postMessage({ type: 'positions', positions: pos }); });
  $('folder').addEventListener('change', (e) => { sel = null; firstFit = true; vscode.postMessage({ type: 'options', options: { folder: e.target.value } }); });
  $('subs').addEventListener('change', (e) => vscode.postMessage({ type: 'options', options: { showSubagents: e.target.checked } }));
  $('win').addEventListener('change', (e) => vscode.postMessage({ type: 'options', options: { windowHours: Number(e.target.value) } }));
  window.addEventListener('resize', () => { if (firstFit) fit(); });

  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (m.type === 'graph') {
      graph = m.graph;
      if (m.options.folder !== currentFolder) { pickerDismissed = false; currentFolder = m.options.folder; }
      picker = m.picker || null;
      H = m.harness || { exists: false, enforce: false, members: [], edges: [] };
      $('enf-wrap').hidden = !H.exists;
      $('enforce').checked = !!H.enforce;
      if (!H.exists && mode === 'edit') setMode('view');
      updatePickerChrome();
      pos = Object.assign({}, m.positions || {}, pos);
      $('subs').checked = !!m.options.showSubagents;
      const fsel = $('folder');
      fsel.replaceChildren(...(m.folders || []).map((f) => {
        const o = document.createElement('option'); o.value = f.folder;
        o.textContent = (f.live ? '● ' : '') + f.name + ' (' + f.count + ')';
        o.title = f.folder; if (f.folder === m.options.folder) o.selected = true; return o;
      }));
      const cur = (m.folders || []).find((f) => f.folder === m.options.folder);
      $('title').textContent = cur ? cur.name + ' 플로우' : '세션 그래프';
      $('title').title = cur ? cur.folder : '';
      $('win').value = String(m.options.windowHours);
      if (sel && sel.type !== 'diff' && sel.type !== 'rule' && !(sel.type === 'node' ? graph.nodes.some((n) => n.id === sel.id) : graph.edges.some((e) => e.id === sel.id))) sel = null;
      const before = Object.keys(pos).length;
      layout(false);
      render();
      if (firstFit || Object.keys(pos).length !== before) { fit(); firstFit = false; }
    } else if (m.type === 'openPicker') {
      openPicker();
    } else if (m.type === 'diffResult') {
      if (diffState && diffState.key === m.key) { diffState.data = m.diff; renderSide(); }
    } else if (m.type === 'focus') {
      select({ type: 'node', id: m.id });
    }
  });

  applyView();
  vscode.postMessage({ type: 'ready' });
})();
</script>
</body>
</html>`;
}

module.exports = { graphHtml };
