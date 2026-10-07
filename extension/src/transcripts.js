'use strict';
// Claude Code transcript(JSONL)에서 세션 제목과 "다른 세션에서 받은 메시지"를 뽑는다.
// transcript 포맷은 공식 API가 아니므로 실패해도 조용히 넘어가고, 바뀐 파일만(최대 10초에 한 번) 다시 읽는다.

const fs = require('fs');
const { parseIncoming } = require('./store');

const MAX_BYTES = 64 * 1024 * 1024;
const cache = new Map(); // path -> { mtimeMs, size, info, at }

// 메시지 비교용 정규화 (공백·기호 제거, 앞 n글자)
function norm(s, n = 24) {
  return String(s || '').replace(/[^\p{L}\p{N}]/gu, '').slice(0, n);
}

function strings(v, out) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out));
  return out;
}

function parse(text) {
  const info = { title: undefined, customTitle: undefined, summary: undefined, received: [] };
  let titleRank = 0; // custom-title(직접 지은 이름) > 그 외 *title* 레코드
  for (const line of text.split('\n')) {
    if (!line) continue;
    const tm = /"type"\s*:\s*"([A-Za-z_-]*title[A-Za-z_-]*)"/i.exec(line);
    const isTitle = !!tm;
    const isSummary = line.includes('"type":"summary"');
    const isMsg = line.includes('cross-session-message') || line.includes('Message from @');
    if (!isTitle && !isSummary && !isMsg) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (isTitle && typeof o.type === 'string' && /title/i.test(o.type)) {
      const key = Object.keys(o).find((k) => /title/i.test(k) && typeof o[k] === 'string' && o[k].trim());
      const rank = /custom|user|manual|rename/i.test(o.type) ? 2 : 1;
      if (key && rank >= titleRank) { info.title = o[key].trim(); titleRank = rank; }
      if (o.type === 'custom-title' && o.customTitle) info.customTitle = String(o.customTitle).trim(); // /rename 이름 = 메시지 주소
    }
    if (isSummary && o.type === 'summary' && o.summary) info.summary = o.summary;
    // 받은 메시지는 사용자 턴으로 들어온다 (assistant 가 인용한 건 제외)
    if (isMsg && o.type !== 'assistant') {
      for (const str of strings(o.message || o, [])) {
        const inc = parseIncoming(str);
        if (inc && inc.body) info.received.push({ fromHandle: inc.from, key: norm(inc.body, 600), text: inc.body.slice(0, 400) });
      }
    }
  }
  return info;
}

function scanTranscript(p) {
  if (!p) return undefined;
  let st;
  try { st = fs.statSync(p); } catch { return undefined; }
  const c = cache.get(p);
  if (c && c.mtimeMs === st.mtimeMs && c.size === st.size) return c.info;
  // 작업 중인 세션의 transcript 는 계속 바뀌므로 10초에 한 번만 다시 읽는다
  if (c && Date.now() - c.at < 10 * 1000) return c.info;
  if (st.size > MAX_BYTES) return c ? c.info : undefined;
  let info;
  try { info = parse(fs.readFileSync(p, 'utf8')); } catch { return undefined; }
  cache.set(p, { mtimeMs: st.mtimeMs, size: st.size, info, at: Date.now() });
  return info;
}

module.exports = { scanTranscript, parse, norm };
