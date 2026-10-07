#!/usr/bin/env node
// Session Flow hook recorder.
// Claude Code hook 입력(stdin JSON)을 받아 ~/.session-flow/events.jsonl 에 한 줄씩 기록한다.
// 파일 수정 툴은 PreToolUse 시점에 "전" 스냅샷, PostToolUse 시점에 "후" 스냅샷을 저장한다.
// 어떤 경우에도 Claude Code 동작을 막지 않도록 항상 exit 0, stdout 출력 없음.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const AGENT_TOOLS = new Set(['Agent', 'Task']);
const H = require('./harness');
const MAX_TEXT = 4000;
const MAX_SNAPSHOT_BYTES = 1024 * 1024;

const baseDir = process.env.SESSION_FLOW_DIR || path.join(os.homedir(), '.session-flow');
const eventsFile = path.join(baseDir, 'events.jsonl');
const snapDir = path.join(baseDir, 'snapshots');
const handlesFile = path.join(baseDir, 'handles.json');     // 확장이 알아낸 주소 → 세션 매핑
const stateFile = path.join(baseDir, 'harness-state.json'); // 세션별로 마지막에 알려준 하네스 설정
const addrFile = path.join(baseDir, 'addr.json');            // 소켓 주소 → 세션 ID (각 세션이 직접 기록)
const titleCache = path.join(baseDir, 'titles.json');        // 세션 ID → /rename 이름 (transcript 이어 읽기)

function truncate(s, n = MAX_TEXT) {
  if (s == null) return undefined;
  s = String(s);
  return s.length > n ? s.slice(0, n) + `\n… (${s.length - n} chars truncated)` : s;
}

function safeId(id) {
  return String(id || '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120);
}

function responseText(r) {
  if (r == null) return undefined;
  if (typeof r === 'string') return r;
  if (Array.isArray(r)) return r.map(responseText).filter(Boolean).join('\n');
  if (typeof r === 'object') {
    if (typeof r.text === 'string') return r.text;
    if (Array.isArray(r.content)) return responseText(r.content);
    if ('stdout' in r || 'stderr' in r) {
      return [r.stdout, r.stderr].filter((x) => x).join('\n');
    }
  }
  try { return JSON.stringify(r); } catch { return undefined; }
}

function targetFile(input) {
  if (!input) return undefined;
  return input.file_path || input.notebook_path || input.path || undefined;
}

function summarize(tool, input) {
  if (!input) return '';
  switch (tool) {
    case 'Bash': return input.command || '';
    case 'Read': case 'Edit': case 'Write': case 'MultiEdit': return targetFile(input) || '';
    case 'NotebookEdit': return input.notebook_path || '';
    case 'Grep': return `${input.pattern || ''}${input.path ? ' in ' + input.path : ''}`;
    case 'Glob': return input.pattern || '';
    case 'WebFetch': return input.url || '';
    case 'WebSearch': return input.query || '';
    case 'Agent': case 'Task': return `${input.subagent_type || 'agent'}: ${input.description || ''}`;
    case 'SendMessage': return `→ ${input.to || input.recipient || '?'}`;
    default: {
      const f = targetFile(input);
      if (f) return f;
      try { return JSON.stringify(input).slice(0, 160); } catch { return ''; }
    }
  }
}

function snapshot(file, toolUseId, phase) {
  if (!file || !toolUseId) return false;
  const dest = path.join(snapDir, `${safeId(toolUseId)}.${phase}`);
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > MAX_SNAPSHOT_BYTES) return false;
    fs.copyFileSync(file, dest);
    return true;
  } catch {
    // 파일이 아직 없음(새 파일) → 빈 스냅샷
    if (phase === 'before') {
      try { fs.writeFileSync(dest, ''); return true; } catch { return false; }
    }
    return false;
  }
}

function base(h) {
  return {
    v: 1,
    ts: new Date().toISOString(),
    session_id: h.session_id,
    cwd: h.cwd,
    agent_id: h.agent_id || undefined,
    agent_type: h.agent_type || undefined,
  };
}

function handle(h) {
  const ev = h.hook_event_name;
  const tool = h.tool_name;
  const input = h.tool_input || {};
  const out = [];

  // transcript_path 는 세션 제목·받은 메시지를 읽는 데 쓰인다 (이벤트마다 넣지 않고 일부에만)
  const tp = h.transcript_path || undefined;

  switch (ev) {
    case 'SessionStart':
      out.push({ ...base(h), kind: 'session_start', summary: h.source || '', transcript_path: tp });
      break;
    case 'SessionEnd':
      out.push({ ...base(h), kind: 'session_end', summary: h.reason || '' });
      break;
    case 'UserPromptSubmit': {
      const p = String(h.prompt || '');
      // 다른 세션에서 온 메시지가 프롬프트로 들어온 경우
      //   <cross-session-message from="...">본문</cross-session-message>  /  Message from @handle: 본문
      const m = /<cross-session-message\b[^>]*?\bfrom\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)(?:<\/cross-session-message>|$)/.exec(p)
        || /Message from @([A-Za-z0-9_.:/-]+)[^:\n]{0,80}?:\s*([\s\S]*)/.exec(p);
      if (m) {
        const body = m[2].trim();
        out.push({ ...base(h), kind: 'message_in', target: m[1], summary: truncate(body, 120), detail: truncate(body), transcript_path: tp });
      } else {
        out.push({ ...base(h), kind: 'prompt', summary: truncate(p, 120), detail: truncate(p), transcript_path: tp });
      }
      break;
    }
    case 'Stop':
      out.push({ ...base(h), kind: 'stop', transcript_path: tp });
      break;
    case 'SubagentStart':
      out.push({ ...base(h), kind: 'subagent_start', summary: h.agent_type || '' });
      break;
    case 'SubagentStop':
      out.push({
        ...base(h), kind: 'subagent_stop', summary: h.agent_type || '',
        detail: truncate(h.last_assistant_message),
      });
      break;
    case 'PreToolUse':
      if (EDIT_TOOLS.has(tool)) {
        snapshot(targetFile(input), h.tool_use_id, 'before');
      } else if (AGENT_TOOLS.has(tool)) {
        out.push({
          ...base(h), kind: 'delegate', tool, tool_use_id: h.tool_use_id,
          target: input.subagent_type || 'agent',
          summary: input.description || summarize(tool, input),
          detail: truncate(input.prompt),
        });
      } else if (tool === 'SendMessage') {
        out.push({
          ...base(h), kind: 'message', tool, tool_use_id: h.tool_use_id,
          target: input.to || input.recipient,
          summary: truncate(input.summary || input.message || input.content, 120),
          detail: truncate(input.message || input.content || JSON.stringify(input)),
        });
      }
      break;
    case 'PostToolUse':
    case 'PostToolUseFailure': {
      const file = targetFile(input);
      const isEdit = EDIT_TOOLS.has(tool);
      const rec = {
        ...base(h),
        kind: ev === 'PostToolUse' ? 'tool' : 'tool_error',
        tool,
        tool_use_id: h.tool_use_id,
        file: file || undefined,
        summary: truncate(summarize(tool, input), 200),
      };
      if (isEdit) {
        rec.has_after = snapshot(file, h.tool_use_id, 'after');
        rec.has_before = fs.existsSync(path.join(snapDir, `${safeId(h.tool_use_id)}.before`));
        if (tool === 'Edit') rec.detail = truncate(`- ${input.old_string ?? ''}\n+ ${input.new_string ?? ''}`);
      } else if (tool !== 'Read') {
        rec.detail = truncate(responseText(h.tool_response ?? h.error));
      }
      if (ev === 'PostToolUseFailure') rec.detail = truncate(responseText(h.error ?? h.tool_response));
      out.push(rec);
      break;
    }
    default:
      break;
  }

  // 이 세션 자신의 메시지 주소(소켓). 받는 쪽 기록의 uds:… 주소를 정확히 이 세션으로 연결하는 데 쓴다.
  const selfAddr = process.env.CLAUDE_CODE_MESSAGING_SOCKET;
  if (selfAddr && !h.agent_id) {
    for (const o of out) if (['session_start', 'prompt', 'message_in', 'message', 'stop'].includes(o.kind)) o.self_addr = selfAddr;
    const k = /^uds:/.test(selfAddr) ? selfAddr : 'uds:' + selfAddr;
    const addrs = H.readJson(addrFile, {});
    if (addrs[k] !== h.session_id) { addrs[k] = h.session_id; try { fs.writeFileSync(addrFile, JSON.stringify(addrs)); } catch { /* ignore */ } }
  }

  // ── 하네스: 역할 안내 / 차단 ──
  let response = null;
  const wantsHarness = ev === 'SessionStart' || ev === 'UserPromptSubmit' || (ev === 'PreToolUse' && tool === 'SendMessage');
  const found = wantsHarness ? H.findConfig(h.cwd) : null;
  if (found) {
    const sid = h.session_id;
    const myName = H.sessionName(sid, h.transcript_path, titleCache);
    const me = H.whoAmI(found.cfg, sid, myName);
    if ((ev === 'SessionStart' || ev === 'UserPromptSubmit') && !h.agent_id && me) {
      const ctx = H.contextFor(found, me, myName);
      const state = H.readJson(stateFile, {});
      const hash = H.configHash(found, me, myName);
      // 시작할 때는 항상, 그 뒤로는 설정이나 이름이 바뀌었을 때만 다시 알려준다
      if (ctx && (ev === 'SessionStart' || state[sid] !== hash)) {
        response = { hookSpecificOutput: { hookEventName: ev, additionalContext: ctx } };
        state[sid] = hash;
        try { fs.writeFileSync(stateFile, JSON.stringify(state)); } catch { /* ignore */ }
        out.push({ ...base(h), kind: 'harness_brief', summary: '하네스 역할 안내', detail: ctx });
      }
    }
    if (ev === 'PreToolUse' && tool === 'SendMessage') {
      const names = Object.fromEntries(Object.entries(H.readJson(titleCache, {})).map(([k, v]) => [k, v.title]));
      const res = H.checkSend(found, me, input.to || input.recipient, { addrs: H.readJson(addrFile, {}), names });
      if (!res.ok) {
        response = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: res.reason } };
        const rec = out.find((o) => o.kind === 'message');
        if (rec) { rec.blocked = true; rec.block_reason = res.reason; }
      }
    }
  }

  if (out.length) fs.appendFileSync(eventsFile, out.map((o) => JSON.stringify(o)).join('\n') + '\n');
  return response;
}

function main() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { raw += c; });
  process.stdin.on('end', () => {
    try {
      fs.mkdirSync(snapDir, { recursive: true });
      const response = handle(JSON.parse(raw));
      if (response) process.stdout.write(JSON.stringify(response));
    } catch (e) {
      try {
        fs.mkdirSync(baseDir, { recursive: true });
        fs.appendFileSync(path.join(baseDir, 'errors.log'), `${new Date().toISOString()} ${e && e.stack || e}\n`);
      } catch { /* ignore */ }
    }
    process.exit(0);
  });
}

if (require.main === module) main();
module.exports = { handle, summarize, responseText };
