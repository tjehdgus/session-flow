# Session Flow

한 작업 폴더에서 여러 Claude Code 세션이 나눠 일할 때, 그 세션들을 **하네스**(멤버 · 역할 · 메인 · 메시지 방향)로 묶어 설계하고, 실제로 어떻게 움직이는지 보고, 바로 개입하는 도구입니다. VS Code / Antigravity 확장 + Claude Code 플러그인으로 이루어져 있고, 서버 없이 로컬 파일만 씁니다.

- **열린 작업 폴더(와 하위 폴더)의 세션만** 다룹니다. 다른 폴더의 세션은 가져오지 않습니다.
- **멤버 = 세션의 `/rename` 이름.** 이 이름이 곧 SendMessage 수신 주소라서, 재시작해도 같은 세션으로 알아봅니다.

```
Claude Code ──hook──▶ ~/.session-flow/   (활동 기록, 파일 전/후 스냅샷, 세션 주소)
     ▲                       │
     │ 역할 안내·차단         ▼
<작업 폴더>/.claude/session-flow.json ◀──▶ 확장: 하네스 화면
```

## 하네스 화면

| 영역 | 내용 |
| --- | --- |
| 세션 추가 | 상단 **+ 세션 추가** → 이 폴더에서 작업한 세션 중 멤버가 아닌 것 목록 팝업. 누르면 멤버로 들어가고, 이름(/rename)이 없는 세션은 이름을 붙이면 그 세션 입력창에 `/rename 이름`이 채워짐. 사이드바에서 멤버 세션을 누르면 이 화면에서 그 멤버의 이벤트가 열림 |
| 가운데 | 멤버 노드와 메시지 방향. **실행 흐름**: 정한 방향에 실제 메시지 수, 방금 오간 연결은 흐르는 점선, 아직 안 오간 방향은 흐린 점선(정한 방향 밖도 같은 선으로 그림, 차단된 건수만 표시). **작업 중**(질문·메시지를 받고 아직 응답이 끝나지 않은 세션)인 캐릭터는 노트북 앞에서 타이핑하고, 응답이 끝나면 멈춤. 멤버 밖과 오간 메시지는 노드의 "외부 n" 배지. 새 이벤트가 들어오면 **러너**가 재생됨: 메시지는 보낸 세션 캐릭터가 편지를 들고 받는 쪽으로 뛰고, 차단되면 벽에 막혀 돌아오고, 파일 수정은 망치질, 서브에이전트 위임은 분신.  **설계**: 보내는 세션 → 받는 세션 순서로 눌러 방향 추가, 화살표를 눌러 삭제 |
| 오른쪽 | 경계를 끌어 폭 조절. **이벤트 목록**(보냄·받음·차단·수정 +/−·위임, 누르면 다시 재생, 수정은 "비교"로 전/후). 노드 클릭 = 그 세션 이벤트, 노드 더블클릭 = 설정: 고른 세션의 역할(바로 편집), 주소·연락 대상, **Claude Code 열기**, **지시 보내기**(그 세션 입력창에 채움), 주고받은 메시지, 변경 파일 → GitHub 스타일 전/후 비교 |
| 상단 | 설계 ↔ 실행 흐름, 움직임(캐릭터 / 점 / 끄기), 메인 ↔ 전원 연결, 차단 |

노드를 더블클릭하면 그 세션의 Claude Code가 열립니다(이미 열려 있으면 그 탭으로).

## 하네스를 처음 만들 때

이미 세션들이 역할을 나눠 일하고 있다면, 그 구성을 아는 세션(보통 메인)에게 맡기면 됩니다.

```
/session-flow:harness
```

화면의 **세션에게 하네스 작성 맡기기** 버튼을 누르면 고른 세션 입력창에 이 명령이 채워집니다. 세션이 `ListAgents`와 대화 맥락으로 멤버·역할·방향을 정리해 `.claude/session-flow.json`을 쓰고, 화면에 바로 반영됩니다.

## 세션이 받는 안내

각 멤버 세션은 시작할 때, 그리고 설정이나 이름이 바뀐 뒤 첫 질문에서 hook으로 이런 안내를 받습니다.

```
[Session Flow 하네스 "kftc"]
이 세션은 "GNN" 입니다.
역할: GNN 학습·평가
메인(총괄): "메인 핸들러"
보내올 수 있는 세션: "메인 핸들러" (받은 메시지에는 답할 수 있습니다)
"RAG 및 LLM" 와(과)는 직접 주고받지 말고 메인을 거치세요.
다른 세션에 보낼 때는 SendMessage 의 수신자로 위 이름을 그대로 쓰세요.
```

- 방향을 하나도 정하지 않으면 제한 없이 멤버와 역할만 안내합니다.
- 정한 방향으로 받은 메시지에 대한 답장은 반대 화살표가 없어도 허용됩니다.
- **차단**을 켜면 정한 방향 밖(또는 하네스 밖)으로 보내는 메시지를 거부하고 이유와 허용된 대상을 알려줍니다. 어느 세션인지 모르는 주소는 막지 않습니다.

## 하네스 파일

`<작업 폴더>/.claude/session-flow.json` — git으로 커밋해 공유할 수 있습니다. 멤버를 이름으로 적기 때문에 다른 PC에서도 같은 이름의 세션이면 그대로 연결됩니다.

```json
{
  "version": 2,
  "name": "kftc",
  "enforce": false,
  "members": [
    { "name": "메인 핸들러", "role": "작업 분배와 결과 검토", "main": true },
    { "name": "GNN", "role": "GNN 학습·평가" }
  ],
  "edges": [{ "from": "메인 핸들러", "to": "GNN" }],
  "layout": {}
}
```

`members[].session`(세션 ID)은 선택입니다. 이름을 아직 안 붙인 세션을 임시로 연결할 때만 씁니다. 이전 버전(세션 ID 기반) 파일은 읽을 때 자동으로 변환됩니다.

## 설치

**요구사항**: Node.js (Claude Code가 있으면 이미 있음)

원격 SSH로 작업한다면 아래는 전부 **원격 서버(세션이 도는 곳)** 에서 합니다.

### 1. Claude Code 플러그인

```bash
claude plugin marketplace add tjehdgus/session-flow
claude plugin install session-flow@session-flow
```

플러그인은 세션이 **시작될 때** 읽힙니다. 이미 열려 있던 Claude Code 세션은 한 번 닫았다가 다시 열어야 기록이 시작됩니다.

### 2. IDE 확장 (VS Code · Antigravity)

**① 확장 파일(.vsix) 만들기**: 터미널에서

```bash
git clone https://github.com/tjehdgus/session-flow ~/session-flow
cd ~/session-flow/extension
npx --yes @vscode/vsce package --no-dependencies -o session-flow.vsix
```

`~/session-flow/extension/session-flow.vsix` 파일이 생깁니다. ([Releases](https://github.com/tjehdgus/session-flow/releases)에 올라온 `.vsix`를 받아도 됩니다.)

**② IDE에 설치하기**: 메뉴를 찾기보다 명령 팔레트가 가장 빠릅니다.

1. `Ctrl+Shift+P` (Mac은 `Cmd+Shift+P`)
2. `vsix` 입력 → **Extensions: Install from VSIX...** 선택
3. 파일 선택 창에서 `session-flow/extension/session-flow.vsix` 선택
   - 원격 SSH면 이 창에 **서버의 파일**이 보입니다. 홈 폴더(`/home/<사용자>`)에서 찾아가면 됩니다.
4. 오른쪽 아래에 설치 완료 알림이 뜹니다.

> 메뉴로 하려면: 왼쪽 세로 막대의 **확장 아이콘**(네모 4개) → 확장 패널 맨 위 오른쪽 **`···`** → **Install from VSIX...**

**③ 창 새로고침**

1. `Ctrl+Shift+P`
2. `reload` 입력 → **Developer: Reload Window** 선택

새로고침하면 왼쪽 세로 막대에 **Session Flow 아이콘**이 생깁니다. 새로고침 뒤 Claude Code 패널이 닫혔다면 Claude Code에서 이전 대화를 다시 열면 됩니다(대화 내용은 그대로입니다).

## 업데이트

**확장** (화면이 바뀌는 업데이트):

```bash
cd ~/session-flow && git pull
cd extension && npx --yes @vscode/vsce package --no-dependencies -o session-flow.vsix
```

그다음 위 **②**(Install from VSIX)와 **③**(Reload Window)을 그대로 반복합니다. 하네스 설정(`.claude/session-flow.json`)과 기록은 그대로 남습니다.

**플러그인** (기록·차단 동작이 바뀌는 업데이트, 릴리스 노트에 적혀 있을 때만):

```bash
claude plugin marketplace update session-flow
claude plugin update session-flow@session-flow
```

플러그인을 업데이트했으면 열려 있던 Claude Code 세션을 닫았다가 다시 열어야 새 버전이 적용됩니다.

## 터미널에서 보기 (IDE 없이)

SSH 터미널만 있어도 같은 내용을 실시간으로 볼 수 있습니다. 확장과 같은 기록(`~/.session-flow`)과 하네스 파일을 읽습니다.

```bash
node ~/session-flow/cli/session-flow.js ~/kftc      # 작업 폴더 (생략하면 현재 폴더)
```

한 번만 등록해 두면 `session-flow`로 바로 실행됩니다.

```bash
mkdir -p ~/.local/bin && ln -sf ~/session-flow/cli/session-flow.js ~/.local/bin/session-flow
# ~/.local/bin 이 PATH 에 없으면: echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc && source ~/.bashrc
cd ~/kftc && session-flow
```

- 위: 멤버(★ 메인, 작업 중/대기, 역할, 이름 필요, 마지막 활동)
- 가운데: 많이 오간 방향과 건수, **지금** 오가는 메시지는 점이 보낸 쪽에서 받는 쪽으로 이동
- 아래: 이벤트(보냄·받음·차단·수정 +/−·위임), 최신이 위, 방금 들어온 줄은 굵게
- 키: `Tab`/`→` 다음 멤버만 · `←` 이전 · `a` 전체 · `q` 종료
- `--once`: 한 번 출력하고 끝 (스크립트·로그용), `--no-color`: 색 없이

## 기록되는 것 (`~/.session-flow`)

| 파일 | 내용 |
| --- | --- |
| `events.jsonl` | 질문, 툴 호출, 서브에이전트 위임/결과, 세션 간 메시지(보냄/받음/차단), 하네스 안내 |
| `snapshots/` | 파일 수정 직전·직후 스냅샷 (1MB 초과 파일 제외) → 전/후 비교 |
| `addr.json` | 각 세션이 스스로 남긴 메시지 소켓 주소 → 세션 ID |
| `titles.json` | 세션 ID → `/rename` 이름 캐시 |

스냅샷에는 수정된 파일 전체가 저장됩니다. 비밀값이 든 파일을 다루는 세션이라면 이 폴더를 공유하지 마세요.

## 개발

```bash
node test/smoke.js       # hook 기록 → 세션
node test/store.js       # 메시지 → 세션 연결(주소 재사용·재시작 포함)
node test/harness.js     # 하네스 hook: 안내, 차단, 주소·이름 캐시
node test/extension.js   # 확장 로직 (가짜 VS Code API)
node test/panel.js       # 하네스 화면 (jsdom 있으면 렌더링까지)
```

## 릴리스

GitHub → Releases → **Draft a new release** → 새 태그 `vX.Y.Z` → **Publish**. Actions가 테스트 후 `.vsix`를 첨부합니다. 플러그인 변경을 배포할 때는 `plugin/.claude-plugin/plugin.json`의 `version`도 올리세요.
