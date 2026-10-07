'use strict';
// 타임라인 Webview HTML. 데이터는 postMessage 로 받고, DOM API(textContent)로만 렌더링한다.

function nonce() {
  let s = '';
  const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
}

function timelineHtml(webview) {
  const n = nonce();
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${n}'; script-src 'nonce-${n}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Session Flow</title>
<style nonce="${n}">
  :root { --edit:#F0A35E; --bash:#5B9DFF; --msg:#B48CF2; --err:#F26D6D; }
  body { margin:0; padding:16px 20px; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
  header { display:flex; flex-wrap:wrap; gap:12px; align-items:center; justify-content:space-between; margin-bottom:16px; }
  h1 { font-size:15px; margin:0; display:flex; align-items:center; gap:8px; }
  .live { font-size:11px; padding:2px 8px; border-radius:999px; background: rgba(80,200,120,.15); color:#6FD69A; }
  .live::before { content:'●'; margin-right:4px; animation: blink 1.2s infinite; }
  @keyframes blink { 50% { opacity:.3 } }
  .stats { font-family: var(--vscode-editor-font-family); font-size:12px; opacity:.8; display:flex; gap:16px; }
  select { background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); border:1px solid var(--vscode-dropdown-border); padding:4px 6px; }
  .meta { font-family: var(--vscode-editor-font-family); font-size:11px; opacity:.7; margin-top:2px; }
  .legend { display:flex; gap:14px; font-size:11px; opacity:.85; margin: 4px 0 12px; flex-wrap:wrap; }
  .legend span::before { content:''; display:inline-block; width:9px; height:9px; border-radius:2px; margin-right:5px; vertical-align:-1px; background: var(--c); }
  .lg-edit { --c:var(--edit) } .lg-bash { --c:var(--bash) } .lg-msg { --c:var(--msg) } .lg-read { --c:rgba(127,127,127,.6) } .lg-err { --c:var(--err) }
  .actions { display:flex; gap:6px; }
  .scroll { overflow-x:auto; }
  .lanes { min-width:760px; display:flex; flex-direction:column; gap:8px; }
  .lane { display:flex; align-items:center; gap:12px; }
  .lane-name { width:150px; flex-shrink:0; }
  .lane-name b { font-size:12px; display:block; }
  .lane-name small { font-family: var(--vscode-editor-font-family); font-size:10px; opacity:.6; }
  .lane.sub .lane-name { padding-left:14px; }
  .track { position:relative; flex:1; height:52px; border-radius:8px; background: var(--vscode-sideBar-background, rgba(127,127,127,.06)); border:1px solid var(--vscode-panel-border, rgba(127,127,127,.2)); }
  .bar { position:absolute; top:25px; height:2px; background: rgba(127,127,127,.35); }
  .chip { position:absolute; top:7px; height:36px; min-width:36px; max-width:180px; padding:0 8px; border-radius:7px; cursor:pointer; display:flex; flex-direction:column; justify-content:center; align-items:flex-start; overflow:hidden; font: inherit; font-size:10px; border:1.5px solid var(--c); background: var(--bg); color: var(--fg); transform: translateX(-4px); }
  .chip b { font-family: var(--vscode-editor-font-family); font-size:10px; }
  .chip span { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%; opacity:.85; }
  .chip:hover, .chip:focus-visible { z-index:5; outline:2px solid var(--vscode-focusBorder); outline-offset:1px; }
  .chip.sel { outline:2px solid var(--vscode-foreground); outline-offset:2px; z-index:6; }
  .chip.newest { animation: pulse 1.6s 3; }
  @keyframes pulse { 0% { box-shadow:0 0 0 0 rgba(91,157,255,.6) } 100% { box-shadow:0 0 0 10px rgba(91,157,255,0) } }
  .detail { margin-top:18px; border:1px solid var(--vscode-panel-border, rgba(127,127,127,.2)); border-radius:8px; overflow:hidden; }
  .detail-head { display:flex; flex-wrap:wrap; justify-content:space-between; gap:8px; padding:8px 12px; border-bottom:1px solid var(--vscode-panel-border, rgba(127,127,127,.2)); font-size:12px; }
  .detail-head button { font: inherit; font-size:11px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border:0; border-radius:4px; padding:4px 10px; cursor:pointer; }
  .detail-head button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  pre { margin:0; padding:12px; font-family: var(--vscode-editor-font-family); font-size:12px; white-space:pre-wrap; word-break:break-word; max-height:320px; overflow:auto; }
  .empty { opacity:.7; padding:40px 0; text-align:center; line-height:1.8; }
</style>
</head>
<body>
<header>
  <div>
    <h1><span id="title">Session Flow</span><span id="live" class="live" hidden>LIVE</span></h1>
    <div class="meta" id="meta"></div>
  </div>
  <div class="stats" id="stats"></div>
  <label>세션 <select id="picker"></select></label>
</header>
<div class="legend">
  <span class="lg-edit">Edit / Write</span>
  <span class="lg-bash">Bash</span>
  <span class="lg-msg">위임 / 메시지</span>
  <span class="lg-read">Read / Search</span>
  <span class="lg-err">실패</span>
</div>
<div class="scroll"><div class="lanes" id="lanes"></div></div>
<div class="detail" id="detail" hidden>
  <div class="detail-head"><b id="d-title"></b><div class="actions"><button id="d-file" class="secondary" hidden>파일 열기</button><button id="d-open">열기</button></div></div>
  <pre id="d-body"></pre>
</div>
<div class="empty" id="empty" hidden>아직 기록된 세션이 없습니다.<br>Claude Code에 session-flow 플러그인을 설치하고 세션을 시작하세요.</div>

<script nonce="${n}">
(function () {
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  let current = null;
  let selected = null;
  let lastMaxIdx = -1;

  const style = {
    edit:  { c: 'var(--edit)', bg: 'var(--edit)', fg: '#111' },
    bash:  { c: 'var(--bash)', bg: 'var(--bash)', fg: '#111' },
    msg:   { c: 'var(--msg)',  bg: 'var(--msg)',  fg: '#111' },
    err:   { c: 'var(--err)',  bg: 'transparent', fg: 'var(--vscode-foreground)' },
    read:  { c: 'rgba(127,127,127,.6)', bg: 'transparent', fg: 'var(--vscode-foreground)' },
  };
  function classify(e) {
    if (e.kind === 'tool_error') return 'err';
    if (e.kind === 'delegate' || e.kind === 'message' || e.kind === 'subagent_stop' || e.kind === 'subagent_start' || e.kind === 'prompt') return 'msg';
    if (e.hasDiff) return 'edit';
    if (e.tool === 'Bash') return 'bash';
    return 'read';
  }
  function label(e) {
    switch (e.kind) {
      case 'prompt': return ['Prompt', e.summary || ''];
      case 'delegate': return ['→ ' + (e.target || 'agent'), e.summary || ''];
      case 'message': return ['✉ ' + (e.target || ''), e.summary || ''];
      case 'subagent_start': return ['Start', e.summary || ''];
      case 'subagent_stop': return ['← 결과', ''];
      default: return [e.tool || e.kind, e.file ? e.file.split(/[\\\\/]/).pop() : (e.summary || '')];
    }
  }
  function fmt(ts) { const d = new Date(ts); return isNaN(d) ? '' : d.toLocaleTimeString([], { hour12: false }); }

  function render() {
    const s = current;
    $('empty').hidden = !!s;
    $('lanes').replaceChildren();
    if (!s) { $('detail').hidden = true; return; }
    $('title').textContent = s.title;
    $('live').hidden = !s.live;
    $('meta').textContent = s.cwd + ' · ' + fmt(s.start) + ' – ' + fmt(s.end);
    $('stats').replaceChildren(
      ...[[s.lanes.length, 'agents'], [s.eventCount, 'events'], [s.fileCount, 'files changed']].map(([v, k]) => {
        const d = document.createElement('div'); const b = document.createElement('b');
        b.textContent = v; d.append(b, ' ' + k); return d;
      })
    );
    let maxIdx = -1;
    s.lanes.forEach((ln) => ln.events.forEach((e) => { maxIdx = Math.max(maxIdx, e.idx); }));

    for (const ln of s.lanes) {
      const lane = document.createElement('div');
      lane.className = 'lane' + (ln.isMain ? '' : ' sub');
      const nm = document.createElement('div'); nm.className = 'lane-name';
      const b = document.createElement('b'); b.textContent = ln.isMain ? 'Main' : '↳ ' + ln.type;
      const sm = document.createElement('small'); sm.textContent = ln.isMain ? 'session' : 'subagent';
      nm.append(b, sm);
      const track = document.createElement('div'); track.className = 'track';
      const bar = document.createElement('div'); bar.className = 'bar';
      bar.style.left = (ln.from * 0.94 + 1) + '%';
      bar.style.width = Math.max(1, (ln.to - ln.from) * 0.94) + '%';
      track.append(bar);
      for (const e of ln.events) {
        const st = style[classify(e)];
        const [head, sub] = label(e);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'chip' + (selected === e.idx ? ' sel' : '') + (e.idx === maxIdx && e.idx > lastMaxIdx && lastMaxIdx >= 0 ? ' newest' : '');
        btn.style.left = (e.pos * 0.94 + 1) + '%';
        btn.style.setProperty('--c', st.c); btn.style.setProperty('--bg', st.bg); btn.style.setProperty('--fg', st.fg);
        btn.title = head + ' ' + sub + ' · ' + fmt(e.ts);
        const hb = document.createElement('b'); hb.textContent = head;
        const sp = document.createElement('span'); sp.textContent = sub;
        btn.append(hb, sp);
        btn.addEventListener('click', () => select(e));
        btn.addEventListener('dblclick', () => vscode.postMessage({ type: 'open', idx: e.idx }));
        track.append(btn);
      }
      lane.append(nm, track);
      $('lanes').append(lane);
    }
    lastMaxIdx = maxIdx;
    if (selected != null) {
      const e = findEvent(selected);
      if (e) showDetail(e); else $('detail').hidden = true;
    }
  }

  function findEvent(idx) {
    for (const ln of current.lanes) for (const e of ln.events) if (e.idx === idx) return e;
    return null;
  }

  function showDetail(e) {
    const [head, sub] = label(e);
    $('detail').hidden = false;
    $('d-title').textContent = head + '  ' + (e.file || sub) + '  ·  ' + fmt(e.ts);
    $('d-body').textContent = e.detail || (e.hasDiff ? '"Diff 보기"를 누르면 에디터에서 전/후 비교가 열립니다.' : '(내용 없음)');
    $('d-open').textContent = e.hasDiff ? 'Diff 보기' : '문서로 열기';
    $('d-open').onclick = () => vscode.postMessage({ type: 'open', idx: e.idx });
    $('d-file').hidden = !e.file;
    $('d-file').onclick = () => vscode.postMessage({ type: 'openFile', file: e.file });
  }

  function select(e) {
    selected = e.idx;
    render();
    if (e.hasDiff) vscode.postMessage({ type: 'open', idx: e.idx });
  }

  $('picker').addEventListener('change', (ev) => { selected = null; lastMaxIdx = -1; vscode.postMessage({ type: 'select', id: ev.target.value }); });

  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (m.type !== 'session') return;
    if (!current || !m.session || current.id !== m.session.id) { selected = null; lastMaxIdx = -1; }
    current = m.session;
    const p = $('picker');
    p.replaceChildren(...m.sessions.map((x) => {
      const o = document.createElement('option'); o.value = x.id;
      o.textContent = (x.live ? '● ' : '') + x.title; if (current && x.id === current.id) o.selected = true; return o;
    }));
    render();
  });

  vscode.postMessage({ type: 'ready' });
})();
</script>
</body>
</html>`;
}

module.exports = { timelineHtml };
