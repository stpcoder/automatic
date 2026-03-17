# Current Status

## Scope

이 문서는 2026-03-17 기준 현재 구현 상태를 짧고 정확하게 정리한다.

## Core Architecture

- `Orchestrator`
  - 케이스 상태 관리
  - step 진행
  - approval gate
  - waiting / resume
- `Web Worker`
  - 기본 경로는 `extension_bridge`
  - Chrome extension content script가 DOM observation, 입력, 클릭, follow를 수행
- `Outlook Worker`
  - `outlook_com`
  - draft / send / search / watch
- `Browser Bridge`
  - session registration
  - observation push
  - command queue
  - same-tab / child-tab follow
- `LLM Adapter`
  - `@ai-sdk/openai-compatible`
  - 사내 OpenAI-compatible endpoint 연결

## Solved Work

### Workflow / orchestration

- 케이스 생성
- step progression
- approval required state
- WAITING_EMAIL
- 메일 회신 후 resume
- SQLite persistence

### Web

- 기본 웹 경로를 `extension_bridge`로 통일
- bookmarklet 경로 제거
- CDP/live_chrome 경로 제거
- DOM 기반 observation
- 멀티스텝 루프
  - `open_system`
  - `fill_web_form`
  - `click_web_element`
  - `read_web_page`
  - `finish_task`
- same-tab / child-tab follow
- 포인터 / 스크롤 / 클릭 시각화
- extension bootstrap retry
  - 서버가 늦게 떠도 다시 붙음

### Outlook

- draft
- send
- search
- watch
- poller

### Debug / test surface

- `/debug/overview`
- `/debug/agent/run`
- `/debug/agent/run-loop`
- `/debug/web/*`
- `/debug/mail/*`
- Windows helper commands
- concise server-side debug logs

## Current Limits

### Web agent

- 여러 검색 결과를 구조적으로 비교해서 최적 후보를 고르는 로직은 약함
- `hover`, 고급 `scroll`, shortcut, upload 같은 action primitive는 아직 제한적
- 여러 같은-system 세션 중 어떤 세션을 선택할지 더 강화할 여지가 있음

### Enterprise workflows

- 사내 사이트별 field mapping은 아직 실제 운영 사이트 기준 검증이 더 필요
- Cube inbound polling은 아직 본격 구현 전
- approval UI는 기본 기능은 있으나 운영형 고도화 여지 있음

## Recommended Next Direction

1. DOM observation 고도화
   - semantic blocks
   - visible DOM ordering
   - candidate grounding
2. 검색 결과 리스트 추출 / 후보 선택
3. extension session selection 강화
4. site-specific mapping validation
   - DHL
   - security portal
   - Cube
5. Cube inbound flow
6. approval / audit UI 강화

## Current Verification

- `npm run check`: PASS
- `npm test`: PASS
- automated tests: `46/46 PASS`

## Latest Extension Fix

최근 extension 추가 뒤 local server와 통신이 안 되던 문제는 아래 원인으로 확인됐다.

- content script가 `/bridge/extension-bootstrap`를 한 번만 호출
- 그 시점에 서버가 없거나 URL이 system rule과 안 맞으면 즉시 종료

현재는 retry 구조로 수정되어:

- 서버가 늦게 떠도 재시도
- 지원 페이지가 늦게 열려도 재시도
- `win:doctor`에서 extension session 존재 여부까지 확인 가능
