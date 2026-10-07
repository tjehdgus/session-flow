# Session Flow (VS Code / Antigravity)

Claude Code 세션과 서브에이전트가 어떻게 움직였는지 타임라인으로 보고, 수정된 파일을 에디터의 diff 뷰로 확인합니다.

- 사이드바 **Session Flow** → 세션 → 에이전트(Main / 서브에이전트) → 이벤트
- 수정 이벤트를 누르면 전/후 diff, 나머지는 실행 결과·위임 프롬프트·반환 결과가 열립니다
- 타임라인 패널: 에이전트별 레인, 실시간 갱신

기록은 같은 레포의 Claude Code 플러그인(`session-flow`)이 `~/.session-flow`에 남깁니다.
