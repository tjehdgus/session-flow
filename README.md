# Session Flow

Claude Code 세션이 어떻게 움직였는지(메인 ↔ 서브에이전트 위임, 툴 호출, 파일 수정)를 기록하고, VS Code / Antigravity 안에서 타임라인과 전/후 diff로 보는 도구입니다. 서버 없이 로컬 파일만 씁니다.

```
Claude Code ──hook──▶ ~/.session-flow/events.jsonl + snapshots/
                                   │
VS Code 확장 ──파일 감시───────────┘──▶ 사이드바 트리 · 타임라인 · diff
```

## 구성

| 경로 | 내용 |
| --- | --- |
| `.claude-plugin/marketplace.json` | 이 레포 자체가 플러그인 마켓플레이스 |
| `plugin/` | Claude Code 플러그인. hook으로 이벤트 기록 |
| `extension/` | VS Code 확장 (Antigravity 등 VS Code 기반 IDE 호환) |
| `.github/workflows/release.yml` | `v*` 태그 푸시 시 `.vsix` 빌드 → GitHub Release 업로드 |

## 설치 (새 PC에서)

**요구사항**: Node.js가 PATH에 있어야 합니다 (hook 스크립트 실행용).

1. Claude Code 플러그인
   ```
   /plugin marketplace add tjehdgus/session-flow
   /plugin install session-flow@session-flow
   ```
   private 레포면 해당 PC에서 GitHub 인증(`gh auth login` 등)이 되어 있어야 합니다.

2. 에디터 확장: [Releases](https://github.com/tjehdgus/session-flow/releases)에서 `session-flow.vsix`를 받아
   ```
   code --install-extension session-flow.vsix
   ```
   Antigravity 등 다른 VS Code 계열 IDE는 Extensions 패널 → `...` → **Install from VSIX**.

## 기록되는 것

| 이벤트 | 내용 |
| --- | --- |
| `prompt` | 사용자 프롬프트 |
| `tool` / `tool_error` | 모든 툴 호출 (Bash 출력, 검색 대상 등) |
| Edit / Write / MultiEdit / NotebookEdit | 수정 직전·직후 파일 스냅샷 → 전/후 diff |
| `delegate` | 서브에이전트에 보낸 프롬프트 (Agent/Task 툴) |
| `subagent_start` / `subagent_stop` | 서브에이전트 시작, 최종 반환 메시지 |
| `message` | 에이전트 간 SendMessage |

서브에이전트 안에서 일어난 툴 호출은 hook 입력의 `agent_id`로 구분되어 별도 레인에 표시됩니다.

## 설정

- 기록 위치: 기본 `~/.session-flow`. 바꾸려면 Claude Code 쪽은 `SESSION_FLOW_DIR` 환경변수, 확장 쪽은 `sessionFlow.dataDir` 설정.
- 1MB 넘는 파일은 스냅샷을 남기지 않습니다.
- 기록 실패는 Claude Code를 막지 않고 `~/.session-flow/errors.log`에만 남습니다.

## 주의

- 스냅샷에는 수정된 파일의 **전체 내용**이 저장됩니다. 비밀값이 들어있는 파일을 다루는 세션이라면 기록 폴더를 동기화하거나 공유하지 마세요.
- 기록은 각 PC에 로컬로 쌓입니다. 여러 기기 기록을 합쳐 보려면 기록 폴더 동기화가 별도로 필요합니다.

## 개발

```bash
node test/smoke.js                 # hook 기록 → 세션 빌드 스모크 테스트
cd extension && npx @vscode/vsce package --no-dependencies
```
VS Code에서 `extension/` 폴더를 열고 F5로 Extension Development Host 실행.

## 릴리스

GitHub → **Releases → Draft a new release** → 태그 `vX.Y.Z` 새로 입력 → **Publish release**.
발행하면 Actions가 `.vsix`를 빌드해 그 Release에 첨부합니다. (플러그인 업데이트를 배포할 땐 `plugin/.claude-plugin/plugin.json`의 `version`도 올리세요.)
