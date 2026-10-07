'use strict';
// 하네스 화면 (한 화면): 왼쪽 = 이 폴더의 다른 세션, 가운데 = 멤버 캔버스, 오른쪽 = 상세.
// 데이터는 postMessage 로 받고, 텍스트는 textContent 로만 넣는다.

function nonce() {
  let s = '';
  const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
}

function panelHtml() {
  const n = nonce();
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${n}'; script-src 'nonce-${n}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Session Flow</title>
<style nonce="${n}">
  :root { --accent:#5B9DFF; --edge:#6B7383; --live:#6FD69A; --viol:#F2797B; --warn:#E8B04B; --line: var(--vscode-panel-border, rgba(127,127,127,.25)); --soft: rgba(127,127,127,.1); }
  * { box-sizing: border-box; }
  [hidden] { display:none !important; }
  html, body { margin:0; height:100%; overflow:hidden; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
  button { font: inherit; font-size:12px; border:0; border-radius:5px; padding:6px 11px; cursor:pointer; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button.link { background:none; padding:2px 0; text-decoration:underline; opacity:.85; }
  button:focus-visible, input:focus-visible, textarea:focus-visible { outline:2px solid var(--vscode-focusBorder); outline-offset:1px; }
  input[type=text], textarea { font: inherit; font-size:12.5px; width:100%; padding:6px 8px; border-radius:5px; border:1px solid var(--vscode-input-border, rgba(127,127,127,.35)); background: var(--vscode-input-background, var(--soft)); color: var(--vscode-input-foreground, var(--vscode-foreground)); }
  textarea { resize: vertical; min-height:64px; }
  .app { display:flex; flex-direction:column; height:100%; }
  header { display:flex; flex-wrap:wrap; align-items:center; gap:10px 16px; padding:10px 16px; border-bottom:1px solid var(--line); }
  header h1 { font-size:14px; margin:0; }
  .stats { font-size:12px; opacity:.72; }
  .controls { margin-left:auto; display:flex; flex-wrap:wrap; gap:8px; align-items:center; font-size:12px; }
  .seg { display:inline-flex; border:1px solid var(--line); border-radius:6px; overflow:hidden; }
  .seg button { border-radius:0; background:transparent; color: var(--vscode-foreground); }
  .seg button[aria-pressed=true] { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .main { flex:1; display:flex; min-height:0; }
  .tray { width:250px; flex-shrink:0; border-right:1px solid var(--line); overflow:auto; padding:14px; display:flex; flex-direction:column; gap:8px; }
  .tray h2, aside h2 { font-size:13px; margin:0; overflow-wrap:anywhere; }
  .muted { font-size:12px; opacity:.72; line-height:1.55; overflow-wrap:anywhere; }
  .titem { all:unset; display:flex; flex-direction:column; gap:3px; padding:9px 11px; border-radius:9px; border:1px dashed var(--line); cursor:grab; }
  .titem:hover, .titem:focus-visible { border-color: var(--accent); }
  .titem .row1 { display:flex; align-items:center; justify-content:space-between; gap:6px; }
  .titem b { font-size:12.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .titem .m { font-size:11px; opacity:.6; }
  .titem .q { font-size:11.5px; opacity:.8; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .chip { font-size:10px; font-weight:600; padding:1px 7px; border-radius:999px; white-space:nowrap; }
  .chip.need { background: rgba(242,121,123,.22); }
  .chip.main { background: rgba(232,176,75,.28); }
  .chip.ext { background: rgba(232,176,75,.18); }
  .chip.live { background: rgba(111,214,154,.2); }
  .stage { position:relative; flex:1; min-width:0; overflow:hidden; cursor:grab;
    background-image: radial-gradient(circle, rgba(127,127,127,.32) 1.2px, transparent 1.3px); background-size: 24px 24px; }
  .stage.panning { cursor:grabbing; }
  .stage.drop { outline:2px dashed var(--accent); outline-offset:-6px; }
  .world { position:absolute; left:0; top:0; transform-origin:0 0; }
  svg.edges { position:absolute; left:0; top:0; overflow:visible; pointer-events:none; }
  .el { fill:none; stroke: var(--edge); stroke-width:2; stroke-linecap:round; }
  .el.plan { stroke-dasharray:3 6; opacity:.6; }
  .el.active { stroke: var(--accent); stroke-dasharray:7 6; animation: dash .8s linear infinite; }
  .el.viol { stroke: var(--viol); stroke-dasharray:5 5; }
  .el.rule { stroke: var(--accent); stroke-width:2.5; }
  .el.sel { stroke: var(--vscode-foreground); stroke-width:3; }
  .hit { fill:none; stroke:transparent; stroke-width:16; pointer-events:stroke; cursor:pointer; }
  .lbl { font-size:11px; fill: var(--vscode-foreground); opacity:.85; pointer-events:none; paint-order: stroke; stroke: var(--vscode-editor-background); stroke-width:4px; }
  .lbl.viol { fill: var(--viol); opacity:1; }
  @keyframes dash { to { stroke-dashoffset:-26; } }
  .node { position:absolute; width:184px; min-height:78px; padding:9px 12px; border-radius:13px; cursor:pointer; user-select:none; text-align:left;
    display:flex; flex-direction:column; gap:2px; background: var(--vscode-sideBar-background, #1b1f27); color: var(--vscode-foreground); border:1.5px solid rgba(127,127,127,.35); box-shadow:0 2px 10px rgba(0,0,0,.18); }
  .node:hover { border-color: rgba(127,127,127,.75); }
  .node.live { border-color: var(--accent); animation: ring 1.8s infinite; }
  .node.sel { box-shadow: 0 0 0 3px rgba(91,157,255,.35); }
  .node.connecting { border-color: var(--accent); box-shadow: 0 0 0 4px rgba(91,157,255,.4); }
  .node.unresolved { border-style:dashed; opacity:.8; }
  @keyframes ring { 0%{box-shadow:0 0 0 0 rgba(91,157,255,.5)} 70%{box-shadow:0 0 0 12px rgba(91,157,255,0)} 100%{box-shadow:0 0 0 0 rgba(91,157,255,0)} }
  .node .t { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
  .node .t b { font-size:13.5px; }
  .node .r { font-size:11.5px; opacity:.75; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .node .s { font-size:11px; opacity:.6; }
  .node .s.on { color: var(--live); opacity:1; }
  body.design .node { cursor: crosshair; }
  .empty { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; text-align:center; padding:24px; pointer-events:none; }
  .empty > * { pointer-events:auto; }
  .empty p { margin:0; max-width:420px; line-height:1.7; opacity:.8; }
  .legend { position:absolute; left:12px; bottom:10px; display:flex; flex-wrap:wrap; gap:4px 14px; font-size:11px; opacity:.62; pointer-events:none; }
  aside { width:340px; flex-shrink:0; border-left:1px solid var(--line); overflow:auto; padding:16px; display:flex; flex-direction:column; gap:11px; }
  aside.wide { width:min(620px, 55%); }
  .row { display:flex; gap:8px; flex-wrap:wrap; }
  .hr { height:1px; background: var(--line); }
  .msg { padding:8px 10px; border-radius:8px; background: var(--soft); font-size:12px; line-height:1.5; display:flex; flex-direction:column; gap:2px; }
  .msg.out { background: rgba(91,157,255,.12); }
  .msg .h { font-family: var(--vscode-editor-font-family); font-size:10.5px; opacity:.75; }
  .msg .b { white-space:pre-wrap; overflow-wrap:anywhere; max-height:160px; overflow:auto; }
  .li { all:unset; display:flex; gap:8px; align-items:baseline; justify-content:space-between; padding:6px 8px; border-radius:6px; font-size:12px; cursor:pointer; }
  .li:hover, .li:focus-visible { background: rgba(127,127,127,.14); }
  .li .k { font-family: var(--vscode-editor-font-family); font-size:10.5px; opacity:.7; white-space:nowrap; }
  .li .v { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; min-width:0; }
  .plus { color:#4CC38A; } .minus { color:#F2797B; }
  .warn { font-size:12px; padding:8px 10px; border-radius:8px; background: rgba(242,121,123,.14); line-height:1.5; }
  .diffbox { border:1px solid var(--line); border-radius:8px; overflow:auto; max-height:calc(100vh - 260px); font-family: var(--vscode-editor-font-family); font-size:12px; line-height:20px; }
  .hk { padding:2px 10px; background: rgba(91,157,255,.12); white-space:pre; opacity:.85; }
  .dl { display:grid; grid-template-columns: 44px 44px 18px max-content; min-width:100%; white-space:pre; }
  .dl span { padding:0 6px; }
  .dl .no { text-align:right; opacity:.5; user-select:none; font-variant-numeric: tabular-nums; }
  .dl .sg { text-align:center; padding:0; user-select:none; }
  .dl.add { background: rgba(46,160,67,.18); } .dl.add .sg { color:#4CC38A; }
  .dl.del { background: rgba(248,81,73,.16); } .dl.del .sg { color:#F2797B; }
  .note { font-size:12px; opacity:.7; }
  @media (prefers-reduced-motion: reduce) { .el.active, .node.live { animation:none; } }
  @media (max-width: 860px) { .main { flex-direction:column; } .tray { width:auto; max-height:22%; border-right:0; border-bottom:1px solid var(--line); } aside, aside.wide { width:auto; max-height:40%; border-left:0; border-top:1px solid var(--line); } .stage { min-height:300px; } }
</style>
</head>
<body>
<div class="app">
  <header>
    <h1 id="title">하네스</h1>
    <span class="stats" id="stats"></span>
    <div class="controls">
      <span class="seg" role="group" aria-label="모드"><button type="button" id="m-design" aria-pressed="false">설계</button><button type="button" id="m-flow" aria-pressed="true">실행 흐름</button></span>
      <button type="button" id="fix-names" hidden></button>
      <button type="button" id="connect-main" hidden>메인 ↔ 전원 연결</button>
      <label id="enf-wrap" hidden><input type="checkbox" id="enforce"> 차단</label>
      <button type="button" id="fit">화면 맞춤</button>
    </div>
  </header>
  <div class="main">
    <div class="tray" id="tray"></div>
    <div class="stage" id="stage">
      <div class="world" id="world"><svg class="edges" id="edges" width="1" height="1"></svg><div id="nodes"></div></div>
      <div class="empty" id="empty" hidden>
        <p>아직 하네스가 없습니다. 왼쪽 세션을 이 캔버스로 끌어오거나, 이미 역할을 알고 있는 메인 세션에게 하네스 파일 작성을 맡기세요.</p>
        <button type="button" class="primary" id="ask-write">세션에게 하네스 작성 맡기기</button>
      </div>
      <div class="legend" id="legend"></div>
    </div>
    <aside id="side"></aside>
  </div>
</div>

<script nonce="${n}">
(function () {
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const SVGNS = 'http://www.w3.org/2000/svg';
  const W = 184, NH = 78;
  let S = { members: [], edges: [], traffic: [], tray: [], layout: {}, enforce: false, exists: false, name: '' };
  let mode = 'flow';
  let sel = null;            // {type:'member', name} | {type:'tray', sid} | {type:'edge', from, to} | {type:'diff', ...}
  let connectFrom = null;
  let pos = {};
  let view = { x: 0, y: 0, k: 1 };
  let firstFit = true;
  let diffState = null;
  let instructOpen = false;

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const btn = (text, cls, fn) => { const b = el('button', cls || '', text); b.type = 'button'; b.addEventListener('click', fn); return b; };
  const key = (s) => String(s || '').trim().toLowerCase();
  const fmt = (ts) => { const d = new Date(ts); return isNaN(d) ? '' : d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' }); };
  const ago = (t) => { if (!t) return ''; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? '방금' : m < 60 ? m + '분 전' : m < 1440 ? Math.round(m / 60) + '시간 전' : Math.round(m / 1440) + '일 전'; };
  const member = (name) => S.members.find((m) => key(m.name) === key(name));
  const hasRule = (f, t) => S.edges.some((e) => key(e.from) === key(f) && key(e.to) === key(t));
  const send = (m) => vscode.postMessage(m);

  // ── 배치 ──
  function layout() {
    const missing = S.members.filter((m) => !pos[m.name]);
    if (!missing.length) return;
    const main = S.members.find((m) => m.main);
    const others = S.members.filter((m) => m !== main);
    const R = Math.max(230, others.length * 55);
    if (main && !pos[main.name]) pos[main.name] = { x: 0, y: 0 };
    others.forEach((m, i) => {
      if (pos[m.name]) return;
      const a = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, others.length);
      pos[m.name] = { x: Math.round(R * Math.cos(a) * 1.25), y: Math.round(R * 0.85 * Math.sin(a)) + (main ? 40 : 0) };
    });
  }

  // ── 그리기 ──
  function render() {
    document.body.classList.toggle('design', mode === 'design');
    $('m-design').setAttribute('aria-pressed', String(mode === 'design'));
    $('m-flow').setAttribute('aria-pressed', String(mode === 'flow'));
    $('connect-main').hidden = !(mode === 'design' && S.members.some((m) => m.main) && S.members.length > 1);
    $('enf-wrap').hidden = !S.exists;
    const unnamed = S.members.filter((m) => m.sid && !m.named).length;
    $('fix-names').hidden = !unnamed;
    $('fix-names').textContent = '이름 맞추기 (' + unnamed + ')';
    $('fix-names').title = '하네스 이름과 세션 /rename 이름이 다른 멤버들의 입력창에 /rename 을 채웁니다';
    $('enforce').checked = !!S.enforce;
    $('title').textContent = (S.name || '') + ' 하네스';
    const live = S.members.filter((m) => m.live).length;
    const msgs = S.traffic.reduce((a, t) => a + t.count, 0);
    $('stats').textContent = '멤버 ' + S.members.length + (live ? ' · 작업 중 ' + live : '') + ' · 멤버 간 메시지 ' + msgs;
    $('empty').hidden = S.members.length > 0;
    $('legend').replaceChildren(...(mode === 'flow'
      ? ['━ 정한 방향 + 실제 메시지 수', '┅ 방금 오감', '┈ 정했지만 아직 안 오감', '┅ 빨강: 정한 방향 밖', '더블클릭: Claude Code 열기']
      : ['보내는 세션 → 받는 세션 순서로 누르면 방향이 생깁니다', '화살표를 누르면 지울 수 있습니다']).map((t) => el('span', null, t)));
    renderTray();
    renderNodes();
    drawEdges();
    renderSide();
  }

  function renderTray() {
    const t = $('tray');
    t.replaceChildren(el('h2', null, '이 폴더의 다른 세션'), el('div', 'muted', '캔버스로 끌어오거나 눌러서 멤버로 추가합니다. 이름이 없는 세션은 추가할 때 이름(/rename)을 붙입니다.'));
    if (!S.tray.length) t.append(el('div', 'muted', '다른 세션이 없습니다.'));
    S.tray.forEach((s) => {
      const b = el('button', 'titem');
      b.type = 'button'; b.draggable = true; b.dataset.sid = s.sid;
      const r1 = el('span', 'row1');
      r1.append(el('b', null, s.label));
      if (!s.name) r1.append(el('span', 'chip need', '이름 필요'));
      else if (s.live) r1.append(el('span', 'chip live', '작업 중'));
      b.append(r1, el('span', 'm', '마지막 ' + ago(s.last) + ' · ' + s.eventCount + ' events'));
      if (s.firstPrompt) b.append(el('span', 'q', s.firstPrompt));
      b.addEventListener('click', () => select({ type: 'tray', sid: s.sid }));
      b.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', s.sid); e.dataTransfer.effectAllowed = 'copy'; });
      t.append(b);
    });
  }

  function renderNodes() {
    const host = $('nodes');
    host.replaceChildren();
    for (const m of S.members) {
      const p = pos[m.name] || { x: 0, y: 0 };
      const b = el('button', 'node' + (m.live ? ' live' : '') + (!m.sid ? ' unresolved' : '') + (sel && sel.type === 'member' && key(sel.name) === key(m.name) ? ' sel' : '') + (connectFrom && key(connectFrom) === key(m.name) ? ' connecting' : ''));
      b.type = 'button'; b.dataset.name = m.name;
      b.style.left = (p.x - W / 2) + 'px'; b.style.top = (p.y - NH / 2) + 'px';
      b.title = (m.role ? '역할: ' + m.role + '\\n' : '') + (m.sid ? '더블클릭: Claude Code에서 열기' : '연결된 세션을 찾지 못했습니다');
      const t = el('span', 't'); t.append(el('b', null, m.name));
      if (m.main) t.append(el('span', 'chip main', '메인'));
      const ext = m.external.out + m.external.in;
      if (ext) t.append(el('span', 'chip ext', '외부 ' + ext));
      if (m.sid && !m.named) t.append(el('span', 'chip need', '이름 필요'));
      b.append(t);
      if (m.role) b.append(el('span', 'r', m.role));
      b.append(el('span', 's' + (m.live ? ' on' : ''), !m.sid ? '세션을 찾지 못함' : m.live ? '● 작업 중' : '대기 · ' + ago(m.last)));
      attachNode(b, m);
      host.append(b);
    }
  }

  function rectPoint(c, w, h, dx, dy) {
    const tx = dx ? (w / 2) / Math.abs(dx) : Infinity, ty = dy ? (h / 2) / Math.abs(dy) : Infinity;
    const t = Math.min(tx, ty);
    return { x: c.x + dx * t, y: c.y + dy * t };
  }

  // 보여줄 화살표 목록
  function edgeList() {
    if (mode === 'design') return S.edges.map((e) => ({ from: e.from, to: e.to, rule: true }));
    const out = [];
    const seen = new Set();
    S.edges.forEach((e) => {
      const t = S.traffic.find((x) => key(x.from) === key(e.from) && key(x.to) === key(e.to));
      seen.add(key(e.from) + '→' + key(e.to));
      out.push(t ? { ...t, planned: true } : { from: e.from, to: e.to, plan: true, count: 0 });
    });
    S.traffic.forEach((t) => { if (!seen.has(key(t.from) + '→' + key(t.to))) out.push({ ...t, viol: !t.ok }); });
    return out;
  }

  function drawEdges() {
    const svg = $('edges');
    svg.replaceChildren();
    const defs = document.createElementNS(SVGNS, 'defs');
    [['ah', 'var(--edge)'], ['ah-a', 'var(--accent)'], ['ah-r', 'var(--viol)'], ['ah-s', 'var(--vscode-foreground)']].forEach(([id, col]) => {
      const m = document.createElementNS(SVGNS, 'marker');
      m.setAttribute('id', id); m.setAttribute('viewBox', '0 0 10 10'); m.setAttribute('refX', '8'); m.setAttribute('refY', '5');
      m.setAttribute('markerWidth', '7'); m.setAttribute('markerHeight', '7'); m.setAttribute('orient', 'auto-start-reverse');
      const p = document.createElementNS(SVGNS, 'path'); p.setAttribute('d', 'M0 0 L10 5 L0 10 z'); p.style.fill = col;
      m.append(p); defs.append(m);
    });
    svg.append(defs);
    const list = edgeList();
    const pairs = new Set(list.map((e) => key(e.from) + '→' + key(e.to)));
    for (const e of list) {
      const pa = pos[member(e.from) ? member(e.from).name : ''], pb = pos[member(e.to) ? member(e.to).name : ''];
      if (!pa || !pb) continue;
      let dx = pb.x - pa.x, dy = pb.y - pa.y;
      const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
      const both = pairs.has(key(e.to) + '→' + key(e.from));
      const off = both ? 9 : 0, nx = -dy * off, ny = dx * off;
      const p1 = rectPoint({ x: pa.x + nx, y: pa.y + ny }, W + 16, NH + 16, dx, dy);
      const p2 = rectPoint({ x: pb.x + nx, y: pb.y + ny }, W + 22, NH + 22, -dx, -dy);
      const isSel = sel && sel.type === 'edge' && key(sel.from) === key(e.from) && key(sel.to) === key(e.to);
      const cls = 'el' + (e.rule ? ' rule' : '') + (e.plan ? ' plan' : '') + (e.viol ? ' viol' : '') + (e.active && !e.viol ? ' active' : '') + (isSel ? ' sel' : '');
      const mk = isSel ? 'ah-s' : e.viol ? 'ah-r' : (e.rule || e.active) ? 'ah-a' : 'ah';
      const line = document.createElementNS(SVGNS, 'line');
      const hit = document.createElementNS(SVGNS, 'line');
      [line, hit].forEach((l) => { l.setAttribute('x1', p1.x); l.setAttribute('y1', p1.y); l.setAttribute('x2', p2.x); l.setAttribute('y2', p2.y); });
      line.setAttribute('class', cls); line.setAttribute('marker-end', 'url(#' + mk + ')');
      hit.setAttribute('class', 'hit');
      const tt = document.createElementNS(SVGNS, 'title');
      tt.textContent = e.from + ' → ' + e.to + (e.rule || e.plan ? ' · 정한 방향' : ' · ' + e.count + '건') + (e.viol ? ' · 정한 방향 밖' : '');
      hit.append(tt);
      hit.addEventListener('click', (ev) => { ev.stopPropagation(); select({ type: 'edge', from: e.from, to: e.to }); });
      const lab = document.createElementNS(SVGNS, 'text');
      lab.setAttribute('x', (p1.x + p2.x) / 2 + (both ? nx * 2.2 : -dy * 12));
      lab.setAttribute('y', (p1.y + p2.y) / 2 + (both ? ny * 2.2 : dx * 12) + 4);
      lab.setAttribute('text-anchor', 'middle');
      lab.setAttribute('class', 'lbl' + (e.viol ? ' viol' : ''));
      lab.textContent = e.rule ? '' : e.plan ? '아직 없음' : String(e.count) + (e.blocked ? ' · 차단 ' + e.blocked : '');
      svg.append(line, lab, hit);
    }
  }

  // ── 오른쪽 상세 ──
  function renderSide() {
    const side = $('side');
    side.replaceChildren();
    side.classList.toggle('wide', !!(sel && sel.type === 'diff'));
    if (sel && sel.type === 'diff') return renderDiff(side);
    if (sel && sel.type === 'member' && member(sel.name)) return renderMember(side, member(sel.name));
    if (sel && sel.type === 'tray') { const s = S.tray.find((x) => x.sid === sel.sid); if (s) return renderTraySide(side, s); }
    if (sel && sel.type === 'edge') return renderEdge(side);
    if (mode === 'design') return renderDesignHelp(side);
    side.append(el('h2', null, '실행 흐름'));
    side.append(el('div', 'muted', '노드를 누르면 그 세션의 역할, 주고받은 메시지, 바뀐 파일이 여기에 나옵니다. 화살표를 누르면 두 세션 사이의 메시지가 나옵니다.'));
    const recent = S.traffic.slice().sort((a, b) => b.last - a.last).slice(0, 8);
    if (recent.length) side.append(el('div', 'muted', '최근 오간 메시지'));
    recent.forEach((t) => { const r = el('button', 'li'); r.type = 'button'; r.append(el('span', 'k', fmt(t.last)), el('span', 'v', t.from + ' → ' + t.to + ' (' + t.count + ')')); r.addEventListener('click', () => select({ type: 'edge', from: t.from, to: t.to })); side.append(r); });
  }

  function renderDesignHelp(side) {
    side.append(el('h2', null, '설계'));
    side.append(el('div', 'muted', connectFrom
      ? '"' + connectFrom + '"에서 보낼 대상을 누르세요. 같은 노드를 다시 누르거나 Esc로 취소합니다.'
      : '보내는 세션을 누른 다음 받는 세션을 누르면 방향이 생깁니다. 받은 메시지에 대한 답장은 반대 화살표가 없어도 허용됩니다. 방향을 하나도 정하지 않으면 제한이 없습니다.'));
    const main = S.members.find((m) => m.main);
    side.append(el('div', 'muted', '메인: ' + (main ? main.name : '없음 (노드를 누르고 "메인으로 지정")') + ' · 방향 ' + S.edges.length + '개 · 차단 ' + (S.enforce ? '켜짐' : '꺼짐')));
    side.append(el('div', 'muted', '바꾼 내용은 .claude/session-flow.json 에 바로 저장되고, 각 세션에는 다음 질문부터 새 역할과 연락 대상이 안내됩니다.'));
    side.append(btn('세션에게 하네스 작성 맡기기', '', () => send({ type: 'askWrite' })));
  }

  function renderMember(side, m) {
    const head = el('div', 'row'); head.append(el('h2', null, m.name));
    if (m.main) head.append(el('span', 'chip main', '메인'));
    head.append(el('span', 'chip ' + (m.live ? 'live' : ''), m.live ? '● 작업 중' : m.sid ? '대기 · ' + ago(m.last) : '세션 없음'));
    side.append(head);
    if (!m.sid) side.append(el('div', 'warn', '"' + m.name + '" 이름을 가진 세션을 이 폴더에서 찾지 못했습니다. 그 세션에서 /rename ' + m.name + ' 을 실행하면 연결됩니다.'));
    else if (!m.named) side.append(el('div', 'warn', '이 세션의 이름(/rename)이 아직 "' + m.name + '"가 아니라서 다른 세션이 이 이름으로 보낼 수 없습니다.'));
    if (m.sid && !m.named) side.append(btn('이 세션에서 /rename ' + m.name + ' 입력하기', '', () => send({ type: 'instruct', sid: m.sid, text: '/rename ' + m.name })));
    // 역할
    side.append(el('div', 'muted', '역할'));
    const role = document.createElement('textarea'); role.id = 'role-input'; role.value = m.role || ''; role.placeholder = '예: GNN 학습·평가. 결과는 메인에 보고'; role.setAttribute('aria-label', '역할');
    role.addEventListener('change', () => { m.role = role.value.trim(); send({ type: 'updateMember', name: m.name, role: m.role }); renderNodes(); });
    side.append(role);
    const outs = S.edges.filter((e) => key(e.from) === key(m.name)).map((e) => e.to);
    const ins = S.edges.filter((e) => key(e.to) === key(m.name)).map((e) => e.from);
    side.append(el('div', 'muted', '주소: ' + m.name + ' (/rename 이름) · ' + (S.edges.length ? '보낼 수 있음: ' + (outs.join(', ') || '없음') + ' · 받는 곳: ' + (ins.join(', ') || '없음') : '방향 미정')));
    const row = el('div', 'row');
    if (m.sid) {
      row.append(btn('Claude Code 열기', 'primary', () => send({ type: 'openSession', sid: m.sid })));
      row.append(btn('지시 보내기', '', () => { instructOpen = !instructOpen; renderSide(); }));
    }
    if (!m.main) row.append(btn('메인으로 지정', '', () => { S.members.forEach((x) => { x.main = x === m; }); send({ type: 'setMain', name: m.name }); render(); }));
    row.append(btn('이름 바꾸기', '', () => send({ type: 'renameMember', name: m.name, sid: m.sid })));
    row.append(btn('멤버에서 빼기', '', () => { send({ type: 'removeMember', name: m.name }); S.members = S.members.filter((x) => x !== m); S.edges = S.edges.filter((e) => key(e.from) !== key(m.name) && key(e.to) !== key(m.name)); sel = null; render(); }));
    side.append(row);
    if (instructOpen && m.sid) {
      const ta = document.createElement('textarea'); ta.id = 'instruct-input'; ta.placeholder = m.name + '에게 보낼 지시. 그 세션 입력창에 채워지고, 보내기는 직접 누릅니다.'; ta.setAttribute('aria-label', '지시 내용');
      side.append(ta, btn('입력창에 채우기', 'primary', () => { if (ta.value.trim()) send({ type: 'instruct', sid: m.sid, text: ta.value.trim() }); instructOpen = false; renderSide(); }));
    }
    side.append(el('div', 'hr'));
    // 주고받은 메시지
    const msgs = S.traffic.filter((t) => key(t.from) === key(m.name) || key(t.to) === key(m.name))
      .flatMap((t) => t.messages.map((x) => ({ ...x, from: t.from, to: t.to }))).sort((a, b) => String(b.ts).localeCompare(String(a.ts))).slice(0, 8);
    side.append(el('div', 'muted', '주고받은 메시지' + (msgs.length ? '' : ' 없음')));
    msgs.forEach((x) => side.append(msgBox(x, key(x.from) === key(m.name))));
    const ext = m.external.out + m.external.in;
    if (ext) {
      const b = btn('멤버 밖과 ' + ext + '건 (보냄 ' + m.external.out + ' · 받음 ' + m.external.in + ')', 'link', () => { m._showExt = !m._showExt; renderSide(); });
      side.append(b);
      if (m._showExt) m.external.messages.slice().reverse().slice(0, 10).forEach((x) => side.append(msgBox({ ...x, from: x.dir === 'out' ? m.name : (x.via || '외부'), to: x.dir === 'out' ? (x.via || '외부') : m.name }, x.dir === 'out')));
    }
    // 변경 파일
    if (m.changedFiles.length) {
      side.append(el('div', 'hr'), el('div', 'muted', '변경 파일 · 누르면 전/후 비교'));
      m.changedFiles.forEach((f) => {
        const r = el('button', 'li'); r.type = 'button'; r.title = f.file;
        r.append(el('span', 'v', f.file.split(/[\\\\/]/).pop()), el('span', 'k', '수정 ' + f.edits + '회 · ' + fmt(f.ts)));
        r.addEventListener('click', () => showDiff({ first: f.first, last: f.last, file: f.file, edits: f.edits }));
        side.append(r);
      });
    }
    if (m.recent.length) {
      side.append(el('div', 'hr'), el('div', 'muted', '최근 활동'));
      m.recent.slice(0, 10).forEach((e) => {
        const r = el('button', 'li'); r.type = 'button'; r.title = e.summary || '';
        const k = e.kind === 'tool' || e.kind === 'tool_error' ? e.tool : ({ prompt: '질문', message: '보냄', message_in: '받음', delegate: '위임', subagent_stop: '결과' }[e.kind] || e.kind);
        r.append(el('span', 'k', fmt(e.ts) + ' ' + k), el('span', 'v', (e.hasDiff ? '± ' : '') + (e.file ? e.file.split(/[\\\\/]/).pop() : (e.target ? e.target + ': ' : '') + (e.summary || ''))));
        r.addEventListener('click', () => (e.hasDiff ? showDiff({ first: e.idx, last: e.idx, file: e.file, edits: 1 }) : send({ type: 'open', idx: e.idx })));
        side.append(r);
      });
      side.append(btn('타임라인 열기', 'link', () => send({ type: 'openTimeline', sid: m.sid })));
    }
  }

  function msgBox(x, out) {
    const b = el('div', 'msg' + (out ? ' out' : ''));
    b.append(el('span', 'h', fmt(x.ts) + ' · ' + x.from + ' → ' + x.to + (x.blocked ? ' · 차단됨' : '')), el('span', 'b', x.text || ''));
    return b;
  }

  function renderTraySide(side, s) {
    side.append(el('h2', null, s.label));
    side.append(el('div', 'muted', '마지막 활동 ' + ago(s.last) + ' · ' + s.eventCount + ' events · ' + s.sid.slice(0, 8)));
    if (s.firstPrompt) side.append(el('div', 'muted', '첫 질문: ' + s.firstPrompt));
    if (s.name) {
      side.append(el('div', 'muted', '이름(/rename): ' + s.name));
      side.append(btn('"' + s.name + '"을(를) 멤버로 추가', 'primary', () => addMember(s.sid, s.name)));
    } else {
      side.append(el('div', 'warn', '이 세션은 이름(/rename)이 없습니다. 재시작하면 바뀌는 자동 이름만 있어서, 멤버로 넣으려면 이름을 붙여야 합니다.'));
      const inp = document.createElement('input'); inp.type = 'text'; inp.id = 'new-name'; inp.placeholder = '붙일 이름 (예: GNN)'; inp.setAttribute('aria-label', '붙일 이름');
      side.append(inp, btn('이름 붙이고 추가', 'primary', () => { const v = inp.value.trim(); if (v) addMember(s.sid, v, true); }));
      side.append(el('div', 'muted', '추가하면 그 세션이 열리고 입력창에 /rename 이 채워집니다. 엔터만 누르면 됩니다.'));
    }
    side.append(btn('Claude Code 열기', '', () => send({ type: 'openSession', sid: s.sid })));
  }

  function addMember(sid, name, needsRename, at) {
    if (member(name)) { select({ type: 'member', name }); return; }
    send({ type: 'addMember', sid, name, rename: !!needsRename, at: at || null });
    if (at) pos[name] = at;
    S.members.push({ name, role: '', main: !S.members.length, sid, named: !needsRename, live: false, last: 0, eventCount: 0, fileCount: 0, recent: [], changedFiles: [], external: { out: 0, in: 0, messages: [] } });
    S.tray = S.tray.filter((x) => x.sid !== sid);
    S.exists = true;
    select({ type: 'member', name });
  }

  function renderEdge(side) {
    const { from, to } = sel;
    side.append(el('h2', null, from + ' → ' + to));
    const planned = hasRule(from, to);
    const t = S.traffic.find((x) => key(x.from) === key(from) && key(x.to) === key(to));
    const back = S.traffic.find((x) => key(x.from) === key(to) && key(x.to) === key(from));
    side.append(el('div', 'muted', (planned ? '정한 방향' : '정하지 않은 방향') + ' · 메시지 ' + (t ? t.count : 0) + '건' + (back ? ' · 반대 ' + back.count + '건' : '')));
    if (t && !t.ok) {
      side.append(el('div', 'warn', '하네스에서 정한 방향(또는 그 답장)이 아닙니다.' + (t.blocked ? ' 이 중 ' + t.blocked + '건은 차단됐습니다.' : '')));
      side.append(btn('이 방향 허용하기', '', () => addRule(from, to)));
    }
    const row = el('div', 'row');
    if (planned) row.append(btn('이 방향 지우기', '', () => removeRule(from, to)));
    if (!hasRule(to, from)) row.append(btn('반대 방향도 추가', '', () => addRule(to, from)));
    side.append(row);
    const msgs = [t, back].filter(Boolean).flatMap((x) => x.messages.map((mm) => ({ ...mm, from: x.from, to: x.to }))).sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
    msgs.forEach((x) => side.append(msgBox(x, key(x.from) === key(from))));
  }

  // ── 전/후 비교 ──
  function showDiff(o) {
    const k = o.first + '-' + o.last;
    diffState = { ...o, key: k, back: sel, data: undefined };
    sel = { type: 'diff' };
    send({ type: 'diff', key: k, first: o.first, last: o.last });
    renderSide();
  }
  function renderDiff(side) {
    const d = diffState;
    side.append(btn('← 돌아가기', 'link', () => { sel = d.back; diffState = null; render(); }));
    side.append(el('h2', null, (d.file || '').split(/[\\\\/]/).pop()), el('div', 'muted', d.file || ''));
    const data = d.data;
    if (data) {
      const st = el('div', 'row'); st.append(el('span', 'plus', '+' + data.add), el('span', 'minus', '−' + data.del), el('span', 'muted', (d.edits > 1 ? '수정 ' + d.edits + '회 누적 · ' : '') + (data.from === data.to ? fmt(data.to) : fmt(data.from) + ' → ' + fmt(data.to)) + (data.isNew ? ' · 새 파일' : '')));
      side.append(st);
    }
    const row = el('div', 'row');
    row.append(btn('에디터에서 나란히 보기', 'primary', () => send({ type: 'openDiff', first: d.first, last: d.last })), btn('파일 열기', '', () => send({ type: 'openFile', file: d.file })));
    side.append(row);
    if (data === undefined) { side.append(el('div', 'note', '불러오는 중…')); return; }
    if (data === null) { side.append(el('div', 'note', '이 수정의 스냅샷이 없어 비교할 수 없습니다.')); return; }
    if (!data.hunks.length) { side.append(el('div', 'note', '내용 변경이 없습니다.')); return; }
    const box = el('div', 'diffbox');
    data.hunks.forEach((h) => {
      box.append(el('div', 'hk', '@@ -' + h.oldStart + ',' + h.oldLines + ' +' + h.newStart + ',' + h.newLines + ' @@'));
      h.lines.forEach((l) => { const r = el('div', 'dl' + (l.t === '+' ? ' add' : l.t === '-' ? ' del' : '')); r.append(el('span', 'no', l.o != null ? String(l.o) : ''), el('span', 'no', l.n != null ? String(l.n) : ''), el('span', 'sg', l.t === ' ' ? '' : (l.t === '-' ? '−' : '+')), el('span', 'tx', l.text)); box.append(r); });
    });
    side.append(box);
    if (data.truncated) side.append(el('div', 'note', '변경이 많아 일부만 표시했습니다.'));
  }

  // ── 편집 동작 ──
  function addRule(from, to) { if (!hasRule(from, to)) S.edges.push({ from, to }); send({ type: 'addRule', from, to }); recalcOk(); render(); }
  function removeRule(from, to) { S.edges = S.edges.filter((e) => !(key(e.from) === key(from) && key(e.to) === key(to))); send({ type: 'removeRule', from, to }); recalcOk(); sel = null; render(); }
  function recalcOk() { S.traffic.forEach((t) => { t.ok = !S.edges.length || hasRule(t.from, t.to) || hasRule(t.to, t.from); }); }
  function select(s) { sel = s; instructOpen = false; render(); }

  function designClick(m) {
    if (!connectFrom) { connectFrom = m.name; sel = { type: 'member', name: m.name }; render(); return; }
    if (key(connectFrom) === key(m.name)) { connectFrom = null; render(); return; }
    const from = connectFrom; connectFrom = null;
    addRule(from, m.name);
    select({ type: 'edge', from, to: m.name });
  }

  // ── 노드 드래그 / 화면 이동 / 끌어다 놓기 ──
  const applyView = () => { $('world').style.transform = 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.k + ')'; };
  function attachNode(b, m) {
    b.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      ev.stopPropagation();
      const start = { x: ev.clientX, y: ev.clientY }, p0 = { ...(pos[m.name] || { x: 0, y: 0 }) };
      let moved = false;
      try { b.setPointerCapture(ev.pointerId); } catch { /* jsdom */ }
      const move = (e) => {
        const dx = (e.clientX - start.x) / view.k, dy = (e.clientY - start.y) / view.k;
        if (!moved && Math.hypot(dx, dy) < 3) return;
        moved = true;
        pos[m.name] = { x: Math.round(p0.x + dx), y: Math.round(p0.y + dy) };
        b.style.left = (pos[m.name].x - W / 2) + 'px'; b.style.top = (pos[m.name].y - NH / 2) + 'px';
        drawEdges();
      };
      const up = () => {
        b.removeEventListener('pointermove', move); b.removeEventListener('pointerup', up);
        if (moved) send({ type: 'layout', positions: pos });
        else if (mode === 'design') designClick(m);
        else select({ type: 'member', name: m.name });
      };
      b.addEventListener('pointermove', move); b.addEventListener('pointerup', up);
    });
    b.addEventListener('dblclick', () => { if (m.sid) send({ type: 'openSession', sid: m.sid }); });
    b.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); mode === 'design' ? designClick(m) : select({ type: 'member', name: m.name }); } });
  }

  const stage = $('stage');
  const toWorld = (cx, cy) => { const r = stage.getBoundingClientRect(); return { x: Math.round((cx - r.left - view.x) / view.k), y: Math.round((cy - r.top - view.y) / view.k) }; };
  stage.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 || ev.target.closest('.empty')) return;
    const start = { x: ev.clientX, y: ev.clientY, vx: view.x, vy: view.y };
    let moved = false;
    stage.classList.add('panning');
    try { stage.setPointerCapture(ev.pointerId); } catch { /* jsdom */ }
    const move = (e) => { moved = moved || Math.hypot(e.clientX - start.x, e.clientY - start.y) > 3; view.x = start.vx + e.clientX - start.x; view.y = start.vy + e.clientY - start.y; applyView(); };
    const up = () => { stage.classList.remove('panning'); stage.removeEventListener('pointermove', move); stage.removeEventListener('pointerup', up); if (!moved && (sel || connectFrom)) { connectFrom = null; select(null); } };
    stage.addEventListener('pointermove', move); stage.addEventListener('pointerup', up);
  });
  stage.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const r = stage.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top;
    const k = Math.min(2.5, Math.max(0.25, view.k * Math.exp(-ev.deltaY * 0.0015)));
    view.x = mx - (mx - view.x) * (k / view.k); view.y = my - (my - view.y) * (k / view.k); view.k = k; applyView();
  }, { passive: false });
  stage.addEventListener('dragover', (e) => { e.preventDefault(); stage.classList.add('drop'); });
  stage.addEventListener('dragleave', () => stage.classList.remove('drop'));
  stage.addEventListener('drop', (e) => {
    e.preventDefault(); stage.classList.remove('drop');
    const sid = e.dataTransfer.getData('text/plain');
    const s = S.tray.find((x) => x.sid === sid);
    if (!s) return;
    if (s.name) addMember(s.sid, s.name, false, toWorld(e.clientX, e.clientY));
    else select({ type: 'tray', sid }); // 이름부터 붙이기
  });

  function fit() {
    const pts = S.members.map((m) => pos[m.name]).filter(Boolean);
    const r = stage.getBoundingClientRect();
    if (!pts.length) { view = { x: r.width / 2, y: r.height / 2, k: 1 }; return applyView(); }
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const minX = Math.min(...xs) - 130, maxX = Math.max(...xs) + 130, minY = Math.min(...ys) - 80, maxY = Math.max(...ys) + 80;
    const k = Math.min(1.2, Math.max(0.3, Math.min(r.width / (maxX - minX || 1), r.height / (maxY - minY || 1))));
    view = { k, x: r.width / 2 - ((minX + maxX) / 2) * k, y: r.height / 2 - ((minY + maxY) / 2) * k };
    applyView();
  }

  $('fit').addEventListener('click', fit);
  $('m-design').addEventListener('click', () => { mode = 'design'; connectFrom = null; sel = null; render(); });
  $('m-flow').addEventListener('click', () => { mode = 'flow'; connectFrom = null; sel = null; render(); });
  $('enforce').addEventListener('change', (e) => { S.enforce = e.target.checked; send({ type: 'setEnforce', on: S.enforce }); render(); });
  $('connect-main').addEventListener('click', () => {
    const main = S.members.find((m) => m.main); if (!main) return;
    S.members.filter((m) => m !== main).forEach((m) => { if (!hasRule(main.name, m.name)) S.edges.push({ from: main.name, to: m.name }); if (!hasRule(m.name, main.name)) S.edges.push({ from: m.name, to: main.name }); });
    send({ type: 'connectMain' }); recalcOk(); render();
  });
  $('ask-write').addEventListener('click', () => send({ type: 'askWrite' }));
  $('fix-names').addEventListener('click', () => send({ type: 'fixNames' }));
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && connectFrom) { connectFrom = null; render(); } });
  window.addEventListener('resize', () => { if (firstFit) fit(); });

  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (m.type === 'state') {
      const before = S.members.map((x) => x.name).join('|');
      S = m.state;
      pos = Object.assign({}, S.layout || {}, pos);
      Object.keys(pos).forEach((k) => { if (!member(k)) delete pos[k]; });
      if (sel && sel.type === 'member' && !member(sel.name)) sel = null;
      if (sel && sel.type === 'tray' && !S.tray.some((x) => x.sid === sel.sid)) sel = null;
      layout();
      render();
      if (firstFit || S.members.map((x) => x.name).join('|') !== before) { fit(); firstFit = false; }
    } else if (m.type === 'diffResult') {
      if (diffState && diffState.key === m.key) { diffState.data = m.diff; renderSide(); }
    }
  });

  applyView();
  send({ type: 'ready' });
})();
</script>
</body>
</html>`;
}

module.exports = { panelHtml };
