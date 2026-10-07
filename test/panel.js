// v2 하네스 화면(panel.js)을 jsdom 으로 렌더링해 상호작용을 확인한다. jsdom 이 없으면 스크립트 문법만 확인.
'use strict';
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const { panelHtml } = require(path.join(root, 'extension/src/panel'));

let JSDOM;
try { ({ JSDOM } = require(process.env.JSDOM_PATH || 'jsdom')); } catch { /* optional */ }
const html = panelHtml();
if (!JSDOM) {
  new Function(html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1]);
  console.log('(jsdom 없음: 스크립트 문법만 확인)');
  process.exit(0);
}

const posted = [];
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, beforeParse(w) { w.acquireVsCodeApi = () => ({ postMessage: (m) => posted.push(m) }); } });
const w = dom.window, D = w.document;
const last = (t) => posted.filter((m) => m.type === t).pop();
const now = Date.now();
const member = (name, extra = {}) => ({ name, role: '', main: false, sid: name + '-id', named: true, live: false, last: now - 600000, eventCount: 10, fileCount: 0, recent: [], changedFiles: [], external: { out: 0, in: 0, messages: [] }, ...extra });
const msg = (from, to, text) => ({ ts: new Date(now).toISOString(), text, idx: 1 });
const push = (state) => w.dispatchEvent(new w.MessageEvent('message', { data: { type: 'state', state } }));
const click = (e) => { e.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true, button: 0 })); e.dispatchEvent(new w.MouseEvent('pointerup', { bubbles: true, button: 0 })); };
const node = (name) => [...D.querySelectorAll('.node')].find((n) => n.dataset.name === name);
const button = (text) => [...D.querySelectorAll('#side button')].find((b) => b.textContent === text);

assert.ok(posted.some((m) => m.type === 'ready'));

// 1) 하네스 없음: 빈 안내 + 왼쪽 목록
push({ folder: '/k', name: 'kftc', exists: false, enforce: false, members: [], edges: [], traffic: [], layout: {},
  tray: [{ sid: 'm-id', name: '메인 핸들러', label: '메인 핸들러', last: now, eventCount: 9, live: true, firstPrompt: '역할 나눠서' }, { sid: 'x-id', name: '', label: '세션 98cfaf', last: now, eventCount: 3, live: false, firstPrompt: '로더 확인' }] });
assert.strictEqual(D.getElementById('empty').hidden, false);
assert.strictEqual(D.querySelectorAll('.titem').length, 2);
assert.ok(D.querySelector('.titem .chip.need'), '이름 필요 표시');
D.getElementById('ask-write').click();
assert.ok(last('askWrite'), '세션에게 작성 맡기기');
// 끌어다 놓기 (이름 있는 세션) → 멤버 추가
const drop = new w.Event('drop', { bubbles: true }); drop.dataTransfer = { getData: () => 'm-id' }; drop.clientX = 100; drop.clientY = 100;
D.getElementById('stage').dispatchEvent(drop);
assert.strictEqual(last('addMember').name, '메인 핸들러');
assert.ok(last('addMember').at, '놓은 위치 저장');
// 이름 없는 세션: 눌러서 이름 붙이고 추가
D.querySelectorAll('.titem')[0].click();
assert.ok(D.getElementById('side').textContent.includes('이름(/rename)이 없습니다'));
D.getElementById('new-name').value = 'TTA 전문가';
button('이름 붙이고 추가').click();
assert.deepStrictEqual({ ...last('addMember') }, { type: 'addMember', sid: 'x-id', name: 'TTA 전문가', rename: true, at: null });

// 2) 하네스 있음: 실행 흐름
const S0 = {
  folder: '/k', name: 'kftc', exists: true, enforce: false, layout: {},
  members: [member('메인 핸들러', { main: true, live: true, role: '총괄' }), member('GNN', { role: 'GNN 학습', external: { out: 1, in: 1, messages: [{ ts: new Date(now).toISOString(), text: '외부로', dir: 'out', via: '세션 98cfaf' }] }, changedFiles: [{ file: '/k/a.py', edits: 2, first: 3, last: 7, ts: new Date(now).toISOString() }] }), member('RAG 및 LLM'), member('TTA 전문가', { named: false })],
  edges: [{ from: '메인 핸들러', to: 'GNN' }, { from: '메인 핸들러', to: 'TTA 전문가' }],
  traffic: [
    { from: '메인 핸들러', to: 'GNN', count: 4, last: now, active: true, blocked: 0, ok: true, messages: [msg('메인 핸들러', 'GNN', '학습 시작')] },
    { from: 'GNN', to: '메인 핸들러', count: 3, last: now, active: false, blocked: 0, ok: true, messages: [msg('GNN', '메인 핸들러', '보고')] },
    { from: 'GNN', to: 'RAG 및 LLM', count: 1, last: now, active: false, blocked: 1, ok: false, messages: [msg('GNN', 'RAG 및 LLM', '직접')] },
  ],
  tray: [],
};
push(S0);
// 첫 상태는 기준점: 러너 없음, 상세 패널은 닫힘(노드를 눌러야 열림)
D.getElementById('m-flow').click();
assert.strictEqual(D.getElementById('side').hidden, true, '선택 없으면 상세 숨김');
assert.strictEqual(D.querySelectorAll('#fx-runs > g').length, 0);
assert.strictEqual(D.querySelectorAll('#fx-chars > g').length, 4, '멤버마다 캐릭터');
// 새 메시지·수정·위임이 들어오면 재생 + 하단 피드
const S = JSON.parse(JSON.stringify(S0));
S.traffic[0].messages.push({ ts: new Date(now).toISOString(), text: '새 지시', idx: 50 });
S.traffic[0].count++;
S.traffic[2].messages.push({ ts: new Date(now).toISOString(), text: '몰래', idx: 51, blocked: true });
S.members[1].recent = [{ idx: 52, kind: 'tool', tool: 'Edit', file: '/k/b.py', hasDiff: true, ts: new Date(now).toISOString() }, { idx: 53, kind: 'delegate', target: 'Explore', ts: new Date(now).toISOString() }];
push(S);
const feed = [...D.querySelectorAll('#feed button')].map((b) => b.textContent);
assert.strictEqual(feed.length, 4);
assert.ok(feed.some((t) => t.includes('보냄') && t.includes('메인 핸들러 → GNN: 새 지시')));
assert.ok(feed.some((t) => t.includes('차단') && t.includes('몰래')));
assert.ok(feed.some((t) => t.includes('수정') && t.includes('b.py')));
assert.ok(feed.some((t) => t.includes('위임') && t.includes('Explore')));
D.querySelector('#feed button.msg').click();
assert.ok(D.querySelectorAll('#fx-runs > g').length >= 1, '다시 재생하면 러너 생김');
assert.ok([...D.querySelectorAll('#fx-runs text')].some((t) => t.textContent === '새 지시'), '말풍선에 메시지');
push(S); // 같은 상태 다시 와도 중복 재생 없음
assert.strictEqual(D.querySelectorAll('#feed button').length, 4);
// 움직임 끄기 → 캐릭터 사라짐, 다시 켜기
D.querySelector('[data-fx=off]').click();
assert.strictEqual(D.querySelectorAll('#fx-chars > g').length, 0);
D.querySelector('[data-fx=char]').click();
assert.strictEqual(D.querySelectorAll('#fx-chars > g').length, 4);
assert.strictEqual(D.getElementById('empty').hidden, true);
assert.strictEqual(D.querySelectorAll('.node').length, 4);
assert.ok(node('메인 핸들러').querySelector('.chip.main'));
assert.ok(node('GNN').querySelector('.chip.ext').textContent === '외부 2');
assert.ok(node('TTA 전문가').querySelector('.chip.need'), '이름 아직 안 맞음');
assert.strictEqual(D.getElementById('fix-names').hidden, false);
assert.strictEqual(D.getElementById('fix-names').textContent, '이름 맞추기 (1)');
D.getElementById('fix-names').click();
assert.ok(last('fixNames'));
assert.strictEqual(D.querySelectorAll('line.el.active').length, 1, '방금 오감');
assert.strictEqual(D.querySelectorAll('line.el.viol').length, 1, 'GNN→RAG 규칙 밖');
assert.strictEqual(D.querySelectorAll('line.el.plan').length, 1, '메인→TTA 아직 안 오감');
assert.ok([...D.querySelectorAll('text.lbl')].some((t) => t.textContent === '1 · 차단 1'));
assert.strictEqual(D.getElementById('enf-wrap').hidden, false);

// 노드 상세
click(node('GNN'));
const side = () => D.getElementById('side').textContent;
assert.strictEqual(D.getElementById('side').hidden, false, '노드 클릭하면 상세 열림');
assert.ok(side().includes('주소: GNN (/rename 이름)') && side().includes('보낼 수 있음: 없음') && side().includes('받는 곳: 메인 핸들러'));
const role = D.getElementById('role-input');
role.value = 'GNN 학습·평가'; role.dispatchEvent(new w.Event('change'));
assert.deepStrictEqual({ ...last('updateMember') }, { type: 'updateMember', name: 'GNN', role: 'GNN 학습·평가' });
button('지시 보내기').click();
D.getElementById('instruct-input').value = '지표 공유해줘';
button('입력창에 채우기').click();
assert.deepStrictEqual({ ...last('instruct') }, { type: 'instruct', sid: 'GNN-id', text: '지표 공유해줘' });
button('Claude Code 열기').click();
assert.strictEqual(last('openSession').sid, 'GNN-id');
[...D.querySelectorAll('#side button')].find((b) => b.textContent.startsWith('멤버 밖과 2건')).click();
assert.ok(side().includes('외부로'));
// 변경 파일 → diff
[...D.querySelectorAll('#side .li')].find((b) => b.textContent.includes('a.py')).click();
assert.ok(last('diff').first === 3 && last('diff').last === 7);
w.dispatchEvent(new w.MessageEvent('message', { data: { type: 'diffResult', key: last('diff').key, diff: { add: 1, del: 1, from: 'x', to: 'x', hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: [{ t: '-', o: 1, text: 'a' }, { t: '+', n: 1, text: 'b' }] }] } } }));
assert.strictEqual(D.querySelectorAll('#side .dl.add').length, 1);
[...D.querySelectorAll('#side button')].find((b) => b.textContent === '← 돌아가기').click();
assert.ok(D.getElementById('role-input'), '돌아가면 멤버 상세');
D.querySelector('#side .close').click();
assert.strictEqual(D.getElementById('side').hidden, true, '닫기');
// 이름 아직 안 맞는 멤버: /rename 채우기 버튼
click(node('TTA 전문가'));
button('이 세션에서 /rename TTA 전문가 입력하기').click();
assert.strictEqual(last('instruct').text, '/rename TTA 전문가');
// 더블클릭 → 세션 열기
node('RAG 및 LLM').dispatchEvent(new w.MouseEvent('dblclick', { bubbles: true }));
assert.strictEqual(last('openSession').sid, 'RAG 및 LLM-id');
// 규칙 밖 화살표 → 허용
const vh = [...D.querySelectorAll('line.hit')].find((l) => l.textContent.startsWith('GNN → RAG 및 LLM'));
vh.dispatchEvent(new w.Event('click', { bubbles: true }));
assert.ok(side().includes('정한 방향(또는 그 답장)이 아닙니다') && side().includes('1건은 차단됐습니다'));
button('이 방향 허용하기').click();
assert.deepStrictEqual({ ...last('addRule') }, { type: 'addRule', from: 'GNN', to: 'RAG 및 LLM' });
assert.strictEqual(D.querySelectorAll('line.el.viol').length, 0, '허용하면 빨강 사라짐');

// 3) 설계 모드
D.getElementById('m-design').click();
assert.ok(D.body.classList.contains('design'));
assert.strictEqual(D.querySelectorAll('line.el.rule').length, 3);
click(node('RAG 및 LLM')); click(node('TTA 전문가'));
assert.deepStrictEqual({ ...last('addRule') }, { type: 'addRule', from: 'RAG 및 LLM', to: 'TTA 전문가' });
button('이 방향 지우기').click();
assert.deepStrictEqual({ ...last('removeRule') }, { type: 'removeRule', from: 'RAG 및 LLM', to: 'TTA 전문가' });
D.getElementById('connect-main').click();
assert.ok(last('connectMain'));
assert.strictEqual(D.querySelectorAll('line.el.rule').length, 7, '메인 ↔ 3명 + GNN→RAG');
D.getElementById('enforce').click();
assert.strictEqual(last('setEnforce').on, true);
// 메인 바꾸기 / 빼기
D.getElementById('m-flow').click();
click(node('RAG 및 LLM'));
button('메인으로 지정').click();
assert.strictEqual(last('setMain').name, 'RAG 및 LLM');
assert.ok(node('RAG 및 LLM').querySelector('.chip.main') && !node('메인 핸들러').querySelector('.chip.main'));
click(node('TTA 전문가'));
button('멤버에서 빼기').click();
assert.strictEqual(last('removeMember').name, 'TTA 전문가');
assert.ok(!node('TTA 전문가'));

// 4) 텍스트는 마크업으로 해석되지 않음
push({ ...S, members: [member('<img src=x onerror=alert(1)>')], edges: [], traffic: [] });
assert.strictEqual(D.querySelectorAll('#nodes img').length, 0);

console.log('OK — v2 panel: runners/feed/fx toggle, click-only side, empty/tray/drop/rename-add, flow edges (active/plan/viol/blocked), inspector, instruct, diff, design rules, main/remove, XSS-safe');
