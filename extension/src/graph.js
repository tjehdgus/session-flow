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
  :root { --accent:#5B9DFF; --edge:#6B7383; --live:#6FD69A; --ghost:#9AA3B2; --sub:#B48CF2; }
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
  </div>
</div>

<script nonce="${n}">
(function () {
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const SVGNS = 'http://www.w3.org/2000/svg';
  let graph = { nodes: [], edges: [] };
  let pos = {};
  let sel = null;            // { type:'node'|'edge', id }
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
      const b = el('button', 'node ' + n.kind + (n.live ? ' live' : '') + (sel && sel.type === 'node' && sel.id === n.id ? ' sel' : ''));
      b.type = 'button';
      b.dataset.id = n.id;
      b.style.left = (p.x - w / 2) + 'px';
      b.style.top = (p.y - size(n).h / 2) + 'px';
      b.title = (n.cwd || '') + (n.handle ? '  @' + n.handle : '');
      b.append(el('span', 't', n.label));
      const sub = n.kind === 'ghost' ? n.sub : (n.live ? '● 작업 중 · ' : '') + n.eventCount + ' events' + (n.fileCount ? ' · 파일 ' + n.fileCount : '');
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
    [['ah', 'var(--edge)'], ['ah-a', 'var(--accent)'], ['ah-s', 'var(--vscode-foreground)'], ['ah-p', 'var(--sub)']].forEach(([id, col]) => {
      const m = document.createElementNS(SVGNS, 'marker');
      m.setAttribute('id', id); m.setAttribute('viewBox', '0 0 10 10'); m.setAttribute('refX', '8'); m.setAttribute('refY', '5');
      m.setAttribute('markerWidth', '7'); m.setAttribute('markerHeight', '7'); m.setAttribute('orient', 'auto-start-reverse');
      const p = document.createElementNS(SVGNS, 'path'); p.setAttribute('d', 'M0 0 L10 5 L0 10 z'); p.style.fill = col;
      m.append(p); defs.append(m);
    });
    svg.append(defs);
    const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
    const pairs = new Set(graph.edges.map((e) => e.from + '→' + e.to));
    for (const e of graph.edges) {
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
      line.setAttribute('class', 'edge-line' + (e.active ? ' active' : '') + (isSel ? ' sel' : '') + (isSub ? ' sub' : ''));
      line.setAttribute('marker-end', 'url(#' + (isSel ? 'ah-s' : e.active ? 'ah-a' : isSub ? 'ah-p' : 'ah') + ')');
      const hit = document.createElementNS(SVGNS, 'line');
      hit.setAttribute('x1', p1.x); hit.setAttribute('y1', p1.y); hit.setAttribute('x2', p2.x); hit.setAttribute('y2', p2.y);
      hit.setAttribute('class', 'edge-hit');
      const t = document.createElementNS(SVGNS, 'title'); t.textContent = labelOf(e.from) + ' → ' + labelOf(e.to) + ' · ' + e.count + '건'; hit.append(t);
      hit.addEventListener('click', (ev) => { ev.stopPropagation(); select({ type: 'edge', id: e.id }); });
      const lab = document.createElementNS(SVGNS, 'text');
      const mx = (p1.x + p2.x) / 2 + (both ? nx * 2.2 : -dy * 12), my = (p1.y + p2.y) / 2 + (both ? ny * 2.2 : dx * 12);
      lab.setAttribute('x', mx); lab.setAttribute('y', my + 4); lab.setAttribute('text-anchor', 'middle'); lab.setAttribute('class', 'edge-label');
      lab.textContent = String(e.count);
      svg.append(line, lab, hit);
    }
  }

  // ── 상세 패널 ──
  function renderSide() {
    const side = $('side');
    side.replaceChildren();
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
      const msgs = e.messages.map((m) => ({ ...m, from: e.from, to: e.to }))
        .concat(back ? back.messages.map((m) => ({ ...m, from: back.from, to: back.to })) : [])
        .sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
      msgs.forEach((m) => {
        const box = el('div', 'msg' + (m.from === e.from ? ' out' : ''));
        box.append(el('span', 'h', fmt(m.ts) + ' · ' + labelOf(m.from) + ' → ' + labelOf(m.to)), el('span', 'b', m.text || ''));
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
    if (n.kind === 'ghost') {
      side.append(el('div', 'muted', '메시지가 @' + n.handle + ' 앞으로 갔지만, 어떤 세션인지 아직 알아내지 못했습니다. 그 세션에 플러그인이 적용된 상태로 메시지를 한 번 받으면 자동으로 연결되고, 지금 바로 직접 연결할 수도 있습니다.'));
      const b = el('button', 'primary', '세션에 연결하기'); b.type = 'button';
      b.addEventListener('click', () => vscode.postMessage({ type: 'link', handle: n.handle }));
      side.append(b);
      return;
    }
    side.append(el('div', 'muted', [n.cwd, n.handle ? '@' + n.handle : '', n.live ? '작업 중' : '대기', n.eventCount + ' events', n.fileCount ? '수정 파일 ' + n.fileCount + '개' : ''].filter(Boolean).join(' · ')));
    const row = el('div', 'row');
    const tl = el('button', 'primary', '타임라인 열기'); tl.type = 'button';
    tl.addEventListener('click', () => vscode.postMessage({ type: 'openTimeline', id: n.kind === 'subagent' ? n.parent : n.id }));
    row.append(tl);
    if (n.kind === 'session') {
      const rn = el('button', '', '이름 바꾸기'); rn.type = 'button';
      rn.addEventListener('click', () => vscode.postMessage({ type: 'rename', id: n.id, current: n.label }));
      row.append(rn);
    }
    side.append(row);
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
    if (n.recent && n.recent.length) {
      side.append(el('div', 'muted', '최근 이벤트'));
      n.recent.forEach((e) => {
        const r = el('button', 'ev'); r.type = 'button';
        const k = e.kind === 'tool' || e.kind === 'tool_error' ? e.tool : ({ prompt: 'Prompt', delegate: '→ 위임', message: '✉ 보냄', message_in: '✉ 받음', subagent_start: '시작', subagent_stop: '← 결과' }[e.kind] || e.kind);
        const v = e.file ? e.file.split(/[\\\\/]/).pop() : (e.target ? e.target + ': ' : '') + (e.summary || '');
        r.append(el('span', 'k', fmt(e.ts) + ' ' + k), el('span', 'v', (e.hasDiff ? '± ' : '') + v));
        r.title = e.summary || '';
        r.addEventListener('click', () => vscode.postMessage({ type: 'open', idx: e.idx }));
        side.append(r);
      });
    }
  }

  function select(s) { sel = s; render(); }

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
        else select({ type: 'node', id: n.id });
      };
      b.addEventListener('pointermove', move); b.addEventListener('pointerup', up);
    });
    b.addEventListener('dblclick', () => { if (n.kind !== 'ghost') vscode.postMessage({ type: 'openTimeline', id: n.kind === 'subagent' ? n.parent : n.id }); });
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
  $('relayout').addEventListener('click', () => { pos = {}; layout(true); render(); fit(); vscode.postMessage({ type: 'positions', positions: pos }); });
  $('folder').addEventListener('change', (e) => { sel = null; firstFit = true; vscode.postMessage({ type: 'options', options: { folder: e.target.value } }); });
  $('subs').addEventListener('change', (e) => vscode.postMessage({ type: 'options', options: { showSubagents: e.target.checked } }));
  $('win').addEventListener('change', (e) => vscode.postMessage({ type: 'options', options: { windowHours: Number(e.target.value) } }));
  window.addEventListener('resize', () => { if (firstFit) fit(); });

  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (m.type === 'graph') {
      graph = m.graph;
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
      if (sel && !(sel.type === 'node' ? graph.nodes.some((n) => n.id === sel.id) : graph.edges.some((e) => e.id === sel.id))) sel = null;
      const before = Object.keys(pos).length;
      layout(false);
      render();
      if (firstFit || Object.keys(pos).length !== before) { fit(); firstFit = false; }
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
