'use strict';
// 세션 활동 기록: "턴" 단위 세로 목록 (최신이 위).
// 턴 = 사람의 질문 또는 다른 세션에서 받은 메시지 하나와, 그동안 한 일.
// 데이터는 postMessage 로 받고, 텍스트는 textContent 로만 넣는다.

function nonce() {
  let s = '';
  const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
}

function timelineHtml() {
  const n = nonce();
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${n}'; script-src 'nonce-${n}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Session Flow 기록</title>
<style nonce="${n}">
  :root { --accent:#5B9DFF; --edit:#E8A15A; --msg:#B48CF2; --err:#F2797B; --line: var(--vscode-panel-border, rgba(127,127,127,.25)); --soft: rgba(127,127,127,.09); }
  * { box-sizing:border-box; }
  [hidden] { display:none !important; }
  body { margin:0; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
  header { position:sticky; top:0; z-index:2; display:flex; flex-direction:column; gap:8px; padding:12px 18px; background: var(--vscode-editor-background); border-bottom:1px solid var(--line); }
  .top { display:flex; flex-wrap:wrap; align-items:center; gap:8px 14px; }
  h1 { font-size:15px; margin:0; }
  .meta { font-size:12px; opacity:.72; }
  .live { font-size:11px; padding:1px 8px; border-radius:999px; background: rgba(111,214,154,.18); }
  select { margin-left:auto; font: inherit; font-size:12px; background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); border:1px solid var(--vscode-dropdown-border, transparent); padding:3px 6px; max-width:260px; }
  .filters { display:flex; flex-wrap:wrap; gap:6px; }
  .filters button { font: inherit; font-size:12px; border:1px solid var(--line); border-radius:999px; padding:3px 11px; background:transparent; color: var(--vscode-foreground); cursor:pointer; }
  .filters button[aria-pressed=true] { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: transparent; }
  button:focus-visible, select:focus-visible { outline:2px solid var(--vscode-focusBorder); outline-offset:1px; }
  main { padding:12px 18px 40px; display:flex; flex-direction:column; gap:10px; max-width:980px; }
  .turn { border:1px solid var(--line); border-radius:10px; overflow:hidden; }
  .turn.in { border-left:3px solid var(--msg); }
  .th { all:unset; display:grid; grid-template-columns: 52px minmax(0,1fr) auto; gap:4px 12px; align-items:start; width:100%; padding:10px 14px; cursor:pointer; box-sizing:border-box; }
  .th:hover, .th:focus-visible { background: var(--soft); }
  .tm { font-family: var(--vscode-editor-font-family); font-size:11px; opacity:.65; padding-top:2px; }
  .tq { display:flex; flex-direction:column; gap:4px; min-width:0; }
  .tq .who { font-size:11px; opacity:.75; }
  .tq .txt { font-size:13px; line-height:1.5; overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; white-space:pre-wrap; overflow-wrap:anywhere; }
  .turn.open .tq .txt { -webkit-line-clamp: unset; display:block; }
  .chips { display:flex; flex-wrap:wrap; gap:5px; justify-content:flex-end; max-width:320px; }
  .chip { font-size:10.5px; padding:2px 8px; border-radius:999px; background: var(--soft); white-space:nowrap; }
  .chip.edit { background: rgba(232,161,90,.2); } .chip.msg { background: rgba(180,140,242,.2); } .chip.err { background: rgba(242,121,123,.22); }
  .tb { border-top:1px solid var(--line); padding:6px 0; }
  .it { all:unset; display:grid; grid-template-columns: 52px 76px minmax(0,1fr); gap:10px; align-items:baseline; width:100%; box-sizing:border-box; padding:4px 14px; font-size:12px; cursor:pointer; }
  .it:hover, .it:focus-visible { background: var(--soft); }
  .it .k { font-family: var(--vscode-editor-font-family); font-size:11px; font-weight:600; }
  .it .v { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .it.sub { padding-left:28px; opacity:.85; }
  .it.edit .k { color: var(--edit); } .it.msg .k { color: var(--msg); } .it.err .k { color: var(--err); }
  .det { margin:2px 14px 8px 152px; padding:8px 10px; border-radius:8px; background: var(--soft); font-family: var(--vscode-editor-font-family); font-size:11.5px; white-space:pre-wrap; overflow-wrap:anywhere; max-height:260px; overflow:auto; }
  .more { font-size:12px; opacity:.7; padding:4px 14px 8px; }
  .empty { opacity:.7; padding:40px 0; text-align:center; line-height:1.8; }
</style>
</head>
<body>
<header>
  <div class="top"><h1 id="title">기록</h1><span class="live" id="live" hidden>● 작업 중</span><span class="meta" id="meta"></span><select id="picker" aria-label="세션"></select></div>
  <div class="filters" role="group" aria-label="필터">
    <button type="button" data-f="all" aria-pressed="true">전체</button>
    <button type="button" data-f="edit" aria-pressed="false">파일 수정</button>
    <button type="button" data-f="msg" aria-pressed="false">메시지</button>
    <button type="button" data-f="bash" aria-pressed="false">명령</button>
    <button type="button" data-f="err" aria-pressed="false">실패</button>
  </div>
</header>
<main id="list"></main>

<script nonce="${n}">
(function () {
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const fmt = (ts) => { const d = new Date(ts); return isNaN(d) ? '' : d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' }); };
  const day = (ts) => { const d = new Date(ts); return isNaN(d) ? '' : d.toLocaleDateString([], { month: 'numeric', day: 'numeric' }); };
  let data = null, filter = 'all';
  const opened = new Set(); const shown = new Set();
  const base = (p) => String(p || '').split(/[\\\\/]/).pop();

  const kindOf = (it) => it.hasDiff ? 'edit' : (it.kind === 'message' || it.kind === 'message_in' || it.kind === 'delegate' || it.kind === 'subagent_stop') ? 'msg' : it.kind === 'tool_error' ? 'err' : it.tool === 'Bash' ? 'bash' : 'other';
  const label = (it) => {
    switch (it.kind) {
      case 'message': return ['보냄', '→ ' + (it.target || '') + ': ' + it.summary + (it.blocked ? ' (차단됨)' : '')];
      case 'delegate': return ['위임', '→ ' + (it.target || '') + ': ' + it.summary];
      case 'subagent_start': return ['시작', it.summary];
      case 'subagent_stop': return ['결과', it.agent ? it.agent + ' 완료' : '완료'];
      case 'tool_error': return [it.tool + ' ✕', it.summary];
      default: return [it.tool || it.kind, it.file ? (it.hasDiff ? '± ' : '') + base(it.file) : it.summary];
    }
  };
  const keep = (t) => filter === 'all' || t.items.some((it) => kindOf(it) === filter);

  function render() {
    const list = $('list');
    list.replaceChildren();
    if (!data) { list.append(el('div', 'empty', '기록된 세션이 없습니다.')); return; }
    const turns = data.turns.filter(keep);
    if (!turns.length) { list.append(el('div', 'empty', filter === 'all' ? '아직 기록이 없습니다.' : '이 조건에 맞는 턴이 없습니다.')); return; }
    turns.forEach((t, i) => {
      const id = t.trigger.idx != null ? 'i' + t.trigger.idx : 't' + t.ts;
      const isOpen = opened.has(id) || (i < 2 && !opened.has('closed:' + id));
      const card = el('section', 'turn' + (t.trigger.kind === 'message_in' ? ' in' : '') + (isOpen ? ' open' : ''));
      const head = el('button', 'th'); head.type = 'button'; head.setAttribute('aria-expanded', String(isOpen));
      head.append(el('span', 'tm', fmt(t.ts) + '\\n' + day(t.ts)));
      const q = el('span', 'tq');
      q.append(el('span', 'who', t.trigger.kind === 'message_in' ? '✉ 받은 메시지 · ' + (t.trigger.from || '') : t.trigger.kind === 'prompt' ? '질문' : '세션 시작'));
      q.append(el('span', 'txt', t.trigger.text || '(내용 없음)'));
      head.append(q);
      const st = t.stats; const chips = el('span', 'chips');
      if (st.bash) chips.append(el('span', 'chip', 'Bash ' + st.bash));
      if (st.files.length) chips.append(el('span', 'chip edit', '파일 ' + st.files.length + '개 수정'));
      if (st.out) chips.append(el('span', 'chip msg', '보냄 ' + st.out + (st.blocked ? ' (차단 ' + st.blocked + ')' : '')));
      if (st.delegates) chips.append(el('span', 'chip msg', '위임 ' + st.delegates));
      if (st.errors) chips.append(el('span', 'chip err', '실패 ' + st.errors));
      const other = st.tools - st.bash - st.edits - st.errors;
      if (other > 0) chips.append(el('span', 'chip', '기타 ' + other));
      if (!t.items.length) chips.append(el('span', 'chip', '응답만'));
      head.append(chips);
      head.addEventListener('click', () => { if (isOpen) { opened.delete(id); opened.add('closed:' + id); } else { opened.add(id); opened.delete('closed:' + id); } render(); });
      card.append(head);
      if (isOpen && t.items.length) {
        const body = el('div', 'tb');
        const items = filter === 'all' ? t.items : t.items.filter((it) => kindOf(it) === filter);
        const max = shown.has(id) ? items.length : 40;
        items.slice(0, max).forEach((it) => {
          const k = kindOf(it); const [a, b] = label(it);
          const row = el('button', 'it ' + k + (it.sub ? ' sub' : '')); row.type = 'button';
          row.title = it.hasDiff ? '전/후 비교 열기' : '자세히 보기';
          row.append(el('span', 'tm', fmt(it.ts)), el('span', 'k', (it.sub && it.agent ? it.agent + ' · ' : '') + a), el('span', 'v', b));
          const dkey = 'd' + it.idx;
          row.addEventListener('click', () => {
            if (it.hasDiff) { vscode.postMessage({ type: 'open', idx: it.idx }); return; }
            if (opened.has(dkey)) opened.delete(dkey); else opened.add(dkey);
            render();
          });
          body.append(row);
          if (opened.has(dkey) && (it.detail || it.summary)) body.append(el('div', 'det', it.detail || it.summary));
        });
        if (items.length > max) {
          const m = el('button', 'it'); m.type = 'button';
          m.append(el('span'), el('span'), el('span', 'v', '… ' + (items.length - max) + '개 더 보기'));
          m.addEventListener('click', () => { shown.add(id); render(); });
          body.append(m);
        }
        card.append(body);
      }
      list.append(card);
    });
  }

  document.querySelectorAll('.filters button').forEach((b) => b.addEventListener('click', () => {
    filter = b.dataset.f;
    document.querySelectorAll('.filters button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    render();
  }));
  $('picker').addEventListener('change', (e) => { opened.clear(); shown.clear(); vscode.postMessage({ type: 'select', id: e.target.value }); });

  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (m.type !== 'session') return;
    if (data && m.session && data.id !== m.session.id) { opened.clear(); shown.clear(); }
    data = m.session;
    $('title').textContent = data ? data.title : '기록';
    $('live').hidden = !(data && data.live);
    $('meta').textContent = data ? [data.role ? '역할: ' + data.role : null, data.turns.length + '턴 · ' + data.eventCount + ' events' + (data.fileCount ? ' · 수정 파일 ' + data.fileCount + '개' : '')].filter(Boolean).join(' · ') : '';
    const p = $('picker');
    p.replaceChildren(...(m.sessions || []).map((x) => { const o = document.createElement('option'); o.value = x.id; o.textContent = (x.live ? '● ' : '') + x.title; if (data && x.id === data.id) o.selected = true; return o; }));
    render();
  });

  vscode.postMessage({ type: 'ready' });
})();
</script>
</body>
</html>`;
}

module.exports = { timelineHtml };
