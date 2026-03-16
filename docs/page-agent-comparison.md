# Page Agent Comparison

이 문서는 현재 `skh-agent` 웹 에이전트가 Alibaba `Page Agent` 스타일과 어디까지 맞춰졌는지, 그리고 아직 남아 있는 차이가 무엇인지 정리한다.

## 현재 맞춰진 부분

### 1. DOM 기반 관찰
- 브라우저 스크린샷이 아니라 DOM 기반 관찰을 사용한다.
- 북마클릿 브리지는 현재 페이지의:
  - `interactiveElements`
  - `title`
  - `url`
  - `pageText`
  를 서버로 올린다.

### 2. 멀티스텝 루프
- 단일 tool call 후 종료하지 않는다.
- 현재 디버그 루프는:
  - `open_system`
  - `fill_web_form`
  - `click_web_element`
  - `submit_web_form`
  - `extract_web_result`
  - `finish_task`
  를 여러 step에 걸쳐 실행한다.

### 3. 결과 읽기 후 종료
- 단순히 버튼 클릭에서 끝나지 않는다.
- `extract_web_result`가 결과 페이지의 `pageText`를 읽고 목표 만족 여부를 판단한다.
- `naver_search`는 결과 텍스트에서 `SK hynix`, `stock`, `price`를 확인한 뒤 종료한다.

### 4. 시스템 정의 기반 동작
- 시스템별로:
  - 필드 alias
  - 버튼 alias
  - 결과 indicator
  를 정의한다.
- 이 구조는 Page Agent의 “페이지 상태 + tool” 철학과 유사하다.

## 아직 남아 있는 차이

### 1. 범용 액션 폭
현재 구현:
- input
- click
- preview
- submit
- extract

Page Agent 계열과 비교해 아직 부족한 것:
- hover
- scroll
- keyboard shortcut
- drag and drop
- file upload
- tab switch / multi-tab planning

### 2. 웹 전용 planner의 깊이
현재 루프:
- 휴리스틱 planner + LLM fallback
- 단계는 순차적으로 잘 이어지지만 아직 강한 장기 재계획은 제한적

부족한 부분:
- 실패 원인 분석 후 대체 경로 탐색
- 페이지 전환 후 새 목표 자동 재설정
- 다중 후보 버튼/필드 중 최적 선택

### 3. 결과 추출의 범용성
현재:
- 시스템 정의의 `resultIndicators`
- 텍스트 snippet 매칭

부족한 부분:
- 표/카드/리스트 구조 이해
- 여러 결과 후보 중 정확한 대상 선택
- 수치/라벨 정규화

## Naver Stock Search 기준 현재 판정

### 가능한 것
- 네이버 페이지 연결
- 검색어 입력
- 검색 버튼 클릭
- 결과 텍스트 읽기
- 목표 만족 여부 판단
- 종료 summary 반환

### 현재 명령 흐름
1. `open_system`
2. `fill_web_form`
3. `click_web_element`
4. `extract_web_result`
5. `finish_task`

## 다음 우선순위

### 1. scroll / hover / keyboard 추가
일반 웹사이트 대응 폭을 넓히려면 필요하다.

### 2. session selection 강화
현재는 같은 `system_id`의 최신 세션을 우선 사용한다.
멀티탭 환경에서는 `session_id` 지정이 필요하다.

### 3. extraction 고도화
`pageText` 기반에서:
- 결과 카드 추출
- label/value 추출
- ranking
으로 올라가야 한다.
