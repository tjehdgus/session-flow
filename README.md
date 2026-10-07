# Session Flow

한 작업 폴더에서 여러 Claude Code 세션이 서로 어떻게 메시지를 주고받는지 **그래프**로 보고, 각 세션이 한 일(툴 호출, 서브에이전트 위임, 파일 수정 전/후 diff)을 VS Code / Antigravity 안에서 확인하는 도구입니다. 서버 없이 로컬 파일만 씁니다.

```
Claude Code ──hook──▶ ~/.session-flow/events.jsonl + snapshots/
                                   │
VS Code 확장 ──파일 감시───────────┘──▶ 폴더별 세션 그래프 · 타임라인 · diff
```

## 하네스

한 작업 폴더의 세션들을 **팀**으로 묶는 기능입니다. 그래프에서 설계하면 프로젝트의 `.claude/session-flow.json`에 저장되고, 각 세션이 그 구성대로 움직이도록 안내합니다.

1. **멤버 고르기**: 함께 일할 세션을 체크하고 이름, 역할, 메인(총괄) 세션을 정합니다.
2. **방향 편집**: 보내는 세션 → 받는 세션 순서로 노드를 누르면 메시지 방향 화살표가 생깁니다. 화살표를 누르면 지울 수 있습니다.
3. **세션 안내**: 각 멤버 세션은 시작할 때, 그리고 설정이 바뀐 뒤 첫 질문에서 "당신은 GNN, 역할은 …, 메인은 메인 핸들러, 보낼 수 있는 대상은 …"을 hook으로 전달받습니다.
4. **차단(선택)**: 상단 **차단**을 켜면 정한 방향 밖으로 보내는 메시지를 hook이 막고, 이유와 허용된 대상을 Claude에게 알려줍니다. 어느 세션인지 아직 모르는 주소는 막지 않습니다.
5. **흐름 보기**: 실제 오간 메시지가 그려지고, 정한 방향 밖 메시지는 빨간색, 정했지만 아직 오가지 않은 방향은 흐린 점선으로 보입니다.
6. **세션 열기**: 노드를 더블클릭하면 그 세션의 Claude Code가 열립니다(이미 열려 있으면 그 탭으로 이동).

설정 파일은 git으로 커밋해서 다른 PC와 공유할 수 있습니다. 세션 ID는 PC마다 다르므로, 다른 PC에서는 멤버를 다시 골라야 합니다.

```json
{
  "version": 1,
  "name": "kftc",
  "enforce": false,
  "members": [{ "session": "<세션 ID>", "name": "메인 핸들러", "role": "작업 분배와 검토", "main": true }],
  "edges": [{ "from": "<보내는 세션>", "to": "<받는 세션>" }],
  "layout": {}
}
```

## 화면

- **사이드바**: 작업 폴더(플로우) → 세션 → 에이전트 → 이벤트. 폴더를 누르면 그 폴더의 세션 그래프가 열립니다.
- **세션 그래프**: 점 격자 캔버스에 세션이 노드로 놓이고, 세션끼리 주고받은 메시지가 방향별 화살표(왕복이면 두 줄)로 이어집니다. 숫자는 메시지 수, 흐르는 점선은 방금 오간 메시지. 화살표를 누르면 주고받은 내용, 노드를 누르면 그 세션의 최근 작업이 오른쪽에 나옵니다. 노드는 드래그로 옮길 수 있고 위치는 저장됩니다.
- **타임라인**: 한 세션 안에서 메인과 서브에이전트가 한 일을 시간축으로.
- **전/후 비교**: 세션 노드의 **변경된 파일**을 누르면 그 세션에서 바뀐 내용을 GitHub처럼 줄 번호와 빨강/초록으로 보여줍니다(여러 번 고친 파일은 처음 수정 전 ~ 마지막 수정 후 누적). 최근 이벤트의 수정 하나만 따로 볼 수도 있고, **에디터에서 나란히 보기**로 IDE의 diff 화면을 열 수 있습니다.

### 세션 고르기

그래프를 처음 열면 **세션 고르기** 화면이 나옵니다. 그 폴더의 세션이 마지막 활동, 첫 질문, 최근 작업과 함께 나열되니 그래프에 넣을 세션을 체크하고 이름(메인 핸들러, GNN 등)을 붙이세요. 고르지 않은 세션과 오간 메시지는 **기타** 노드 하나로 묶입니다. 어느 세션인지 모르는 수신자 주소도 이 화면에서 세션에 연결할 수 있습니다.

이후 그 폴더에 새 세션이 생기면 자동으로 넣지 않고 알림만 띄웁니다(**세션 고르기** / **추가 안 함**). 선택은 폴더별로 `~/.session-flow/names.json`에 저장되고, 그래프 상단의 **세션 고르기**로 언제든 바꿀 수 있습니다.

### 세션 이름과 연결

- 이름은 세션 제목(`/rename` 등으로 붙인 것)을 transcript에서 읽고, 없으면 첫 프롬프트를 씁니다. 노드의 **이름 바꾸기**로 직접 정할 수 있습니다.
- 메시지 수신자는 `kftc-3f` 같은 핸들로 기록되는데, 받은 쪽 세션에 같은 내용이 도착하면 자동으로 어떤 세션인지 연결됩니다. 연결이 안 된 핸들은 점선 노드로 보이고, **세션에 연결하기**로 직접 지정할 수 있습니다.
- 직접 지정한 내용은 `~/.session-flow/names.json`에 저장됩니다.

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
| `message` | 다른 세션으로 보낸 메시지 (SendMessage) |
| `message_in` | 다른 세션에서 받은 메시지 (`<cross-session-message>`) |

서브에이전트 안에서 일어난 툴 호출은 hook 입력의 `agent_id`로 구분되어 별도 레인에 표시됩니다.

## 업데이트

```bash
claude plugin marketplace update session-flow
claude plugin update session-flow@session-flow
```
확장은 새 `.vsix`를 받아 다시 **Install from VSIX** 하면 됩니다. 그 뒤 창을 새로고침하세요.

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
node test/graph.js                 # 여러 세션 메시지 → 그래프 (jsdom 있으면 화면 렌더까지)
node test/harness.js               # 하네스 hook: 역할 안내, 차단 판정
node test/extension.js             # 확장 로직을 가짜 VS Code API로 실행
cd extension && npx @vscode/vsce package --no-dependencies
```
VS Code에서 `extension/` 폴더를 열고 F5로 Extension Development Host 실행.

## 릴리스

GitHub → **Releases → Draft a new release** → 태그 `vX.Y.Z` 새로 입력 → **Publish release**.
발행하면 Actions가 `.vsix`를 빌드해 그 Release에 첨부합니다. (플러그인 업데이트를 배포할 땐 `plugin/.claude-plugin/plugin.json`의 `version`도 올리세요.)
