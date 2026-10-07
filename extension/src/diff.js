'use strict';
// 줄 단위 diff → git 스타일 hunk. 의존성 없이, 공통 앞/뒤를 잘라낸 뒤 가운데만 LCS 로 비교한다.

const MAX_CELLS = 4_000_000; // 가운데 영역이 이보다 크면 통째로 바뀐 것으로 표시

function splitLines(s) {
  if (!s) return [];
  const lines = s.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

// 편집 스크립트: [{ t: ' ' | '-' | '+', o, n, text }]
function script(a, b) {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const A = a.slice(pre, a.length - suf);
  const B = b.slice(pre, b.length - suf);
  const out = [];
  for (let i = 0; i < pre; i++) out.push({ t: ' ', o: i + 1, n: i + 1, text: a[i] });

  if (A.length * B.length > MAX_CELLS) {
    A.forEach((x, i) => out.push({ t: '-', o: pre + i + 1, text: x }));
    B.forEach((x, i) => out.push({ t: '+', n: pre + i + 1, text: x }));
  } else {
    // LCS 길이 표 (뒤에서부터)
    const m = A.length, n = B.length;
    const w = n + 1;
    const L = new Uint32Array((m + 1) * w);
    for (let i = m - 1; i >= 0; i--) {
      for (let j = n - 1; j >= 0; j--) {
        L[i * w + j] = A[i] === B[j] ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
      }
    }
    let i = 0, j = 0;
    while (i < m || j < n) {
      if (i < m && j < n && A[i] === B[j]) { out.push({ t: ' ', o: pre + i + 1, n: pre + j + 1, text: A[i] }); i++; j++; }
      else if (i < m && (j === n || L[(i + 1) * w + j] >= L[i * w + j + 1])) { out.push({ t: '-', o: pre + i + 1, text: A[i] }); i++; }
      else { out.push({ t: '+', n: pre + j + 1, text: B[j] }); j++; }
    }
  }
  const oOff = a.length - suf, nOff = b.length - suf;
  for (let k = 0; k < suf; k++) out.push({ t: ' ', o: oOff + k + 1, n: nOff + k + 1, text: a[oOff + k] });
  return out;
}

// 변경 주변 context 줄만 남겨 hunk 로 묶는다
function diffLines(before, after, context = 3) {
  const a = splitLines(before), b = splitLines(after);
  const ops = script(a, b);
  const add = ops.filter((x) => x.t === '+').length;
  const del = ops.filter((x) => x.t === '-').length;
  const keep = new Array(ops.length).fill(false);
  ops.forEach((x, i) => {
    if (x.t === ' ') return;
    for (let k = Math.max(0, i - context); k <= Math.min(ops.length - 1, i + context); k++) keep[k] = true;
  });
  const hunks = [];
  let cur = null;
  ops.forEach((x, i) => {
    if (!keep[i]) { cur = null; return; }
    if (!cur) {
      // hunk 시작 줄 번호: 이 지점 직전까지 지나온 원본/새 줄 수 + 1
      let o = 0, n = 0;
      for (let k = 0; k < i; k++) { if (ops[k].t !== '+') o++; if (ops[k].t !== '-') n++; }
      cur = { oldStart: o + 1, newStart: n + 1, oldLines: 0, newLines: 0, lines: [] };
      hunks.push(cur);
    }
    cur.lines.push(x);
    if (x.t !== '+') cur.oldLines++;
    if (x.t !== '-') cur.newLines++;
  });
  return { hunks, add, del, isNew: a.length === 0 && b.length > 0, deleted: b.length === 0 && a.length > 0 };
}

module.exports = { diffLines, splitLines };
