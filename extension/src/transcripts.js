'use strict';
// Claude Code transcript(JSONL)에서 세션 제목과 "다른 세션에서 받은 메시지"를 뽑는다.
// transcript 포맷은 공식 API가 아니므로 실패해도 조용히 넘어가고, 바뀐 부분만 이어서 읽는다.

const fs = require('fs');
const { parseIncoming } = require('./store');

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

function newInfo() { return { title: undefined, customTitle: undefined, summary: undefined, received: [], _rank: 0 }; }

// 한 줄 처리. custom-title(직접 지은 이름) > 그 외 *title* 레코드, 같은 등급이면 나중 것이 이긴다
function parseLine(info, line) {
  if (!line) return;
  const tm = /"type"\s*:\s*"([A-Za-z_-]*title[A-Za-z_-]*)"/i.exec(line);
  const isTitle = !!tm;
  const isSummary = line.includes('"type":"summary"');
  const isMsg = line.includes('cross-session-message') || line.includes('Message from @');
  if (!isTitle && !isSummary && !isMsg) return;
  let o;
  try { o = JSON.parse(line); } catch { return; }
  if (isTitle && typeof o.type === 'string' && /title/i.test(o.type)) {
    const key = Object.keys(o).find((k) => /title/i.test(k) && typeof o[k] === 'string' && o[k].trim());
    const rank = /custom|user|manual|rename/i.test(o.type) ? 2 : 1;
    if (key && rank >= info._rank) { info.title = o[key].trim(); info._rank = rank; }
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

function parse(text) {
  const info = newInfo();
  for (const line of text.split('\n')) parseLine(info, line);
  return info;
}

// transcript 는 뒤에 덧붙기만 하므로 지난번 읽은 위치부터 이어서 읽는다 (크기 제한 없음).
// 파일이 줄어들면(새로 쓰임) 처음부터 다시 읽는다.
const CHUNK = 4 * 1024 * 1024;
function scanTranscript(p) {
  if (!p) return undefined;
  let st;
  try { st = fs.statSync(p); } catch { return undefined; }
  let c = cache.get(p);
  if (c && c.size === st.size && c.mtimeMs === st.mtimeMs) return c.info;
  if (!c || st.size < c.size) c = { size: 0, offset: 0, rest: Buffer.alloc(0), info: newInfo() };
  let fd;
  try {
    fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(CHUNK);
    while (c.offset < st.size) {
      const n = fs.readSync(fd, buf, 0, Math.min(CHUNK, st.size - c.offset), c.offset);
      if (n <= 0) break;
      c.offset += n;
      let data = Buffer.concat([c.rest, buf.subarray(0, n)]);
      let start = 0, nl;
      while ((nl = data.indexOf(10, start)) !== -1) { parseLine(c.info, data.toString('utf8', start, nl)); start = nl + 1; }
      c.rest = Buffer.from(data.subarray(start));
      if (c.rest.length > 16 * 1024 * 1024) c.rest = Buffer.alloc(0); // 비정상적으로 긴 줄은 버린다
    }
  } catch { return c.info; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ } }
  // 마지막 줄이 개행 없이 끝났어도 제목 레코드면 반영
  if (c.rest.length) { const tail = newInfo(); parseLine(tail, c.rest.toString('utf8')); if (tail.customTitle) c.info.customTitle = tail.customTitle; }
  c.size = st.size; c.mtimeMs = st.mtimeMs;
  cache.set(p, c);
  return c.info;
}

module.exports = { scanTranscript, parse, norm };
