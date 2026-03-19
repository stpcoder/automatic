# 에이전틱 오케스트레이션 정리

## 1. 이 시스템의 최종 목표

지금의 웹 에이전트와 메일 에이전트는 각각 잘 동작하는 하위 실행기다.
하지만 실제 업무 자동화의 최종 형태는 "웹을 잘 만지는 에이전트"나 "메일을 잘 쓰는 에이전트"가 아니라, 업무 메뉴얼을 따라가면서 필요한 정보를 점검하고, 부족한 정보는 사람에게 물어보고, 필요한 시점에 웹/메일 하네스를 호출하는 상위 오케스트레이터다.

쉽게 말하면 목표는 다음과 같다.

1. 사용자가 "DHL 송부하기" 같은 큰 목표를 던진다.
2. 시스템은 해당 목표에 맞는 메뉴얼 또는 플레이북을 찾는다.
3. 메뉴얼에서 필요한 정보가 무엇인지 점검한다.
4. 부족한 정보는 사용자에게 1, 2, 3 식으로 질문해서 채운다.
5. 정보가 충분해지면 웹 에이전트, 메일 에이전트 같은 서브에이전트를 호출한다.
6. 중간 결과를 케이스 상태로 저장한다.
7. 승인, 회신, 대기, 재개까지 포함해서 끝까지 업무를 완결한다.

즉 핵심은 "도구를 잘 쓰는 한 번짜리 에이전트"가 아니라, "업무 상태를 유지하면서 여러 채널을 오가며 끝까지 일하는 오케스트레이터"다.

## 2. 현재 이미 구현된 것

현재 저장소에는 하위 실행 레이어는 꽤 많이 구현돼 있다.

### 2.1 상태와 계약

- 케이스 상태
  - `READY`
  - `RUNNING`
  - `DRAFT_READY`
  - `APPROVAL_REQUIRED`
  - `WAITING_EMAIL`
  - `WAITING_CHAT`
  - `WAITING_HUMAN`
  - `WAITING_SYSTEM`
  - `COMPLETED`
  - `FAILED`
  - `ESCALATED`
- 이벤트, 기대조건(expectation), 승인(approval), artifact, planner output 스키마가 이미 있다.
- 이 레이어는 상위 오케스트레이션의 뼈대 역할을 한다.

### 2.2 케이스 오케스트레이터

현재 오케스트레이터는 다음을 이미 한다.

- 케이스 생성
- 현재 step 로드
- approval gate 처리
- 이메일 회신 expectation 등록
- 이벤트가 들어오면 matching 후 resume
- step 완료 후 다음 step 전이

즉 "승인 대기", "이메일 회신 대기", "이벤트 도착 후 재개" 같은 기본적인 비동기 상태기계는 이미 있다.

### 2.3 웹 하네스

웹 에이전트 쪽은 다음이 구현되어 있다.

- 브라우저 열기
- 페이지 observation 수집
- 읽기
- 입력
- 클릭
- 스크롤
- 현재 페이지 요약 및 액션 선택

즉 웹 사이트를 bounded tool 방식으로 다루는 하위 실행기는 이미 존재한다.

### 2.4 메일 하네스

메일 에이전트 쪽은 다음이 구현되어 있다.

- 메일 검색
- 메일 읽기
- 대화 thread 읽기
- 연락처 검색
- 새 초안 작성
- 답장 초안 작성
- 초안 수정
- 초안 미리보기
- 메일 발송
- 회신 대기
- 회신 watch 등록

즉 메일도 단순 전송이 아니라, 검색-읽기-초안-승인-발송-회신 대기 흐름의 하위 실행기가 이미 있다.

### 2.5 승인과 waiting 흐름

다음도 이미 있다.

- 최종 send/submit 전 approval gate
- approval UI
- 회신 도착 시 expectation matching
- waiting state 진입 및 resume

이 부분은 실제 업무형 에이전트에서 매우 중요한 기반이다.

## 3. 현재 구조가 아직 부족한 이유

현재 구조는 "웹/메일 서브에이전트"는 꽤 잘 되어 있지만, 상위 업무 오케스트레이션은 아직 반쯤만 있다.

핵심 부족점은 다음과 같다.

### 3.1 메뉴얼이 실행 가능한 형태로 부족하다

지금도 workflow step은 있지만, 실제 업무 메뉴얼 수준으로는 아직 부족하다.

예를 들어 "DHL 송부하기" 메뉴얼에는 보통 다음이 들어가야 한다.

- 필요한 필수 정보 목록
- 어떤 정보는 사용자에게 물어볼지
- 어떤 정보는 메일에서 찾을지
- 어떤 정보는 웹에서 확인할지
- 어떤 순서로 진행할지
- 어디서 승인받을지
- 어디서 대기할지
- 어떤 조건이면 실패/재시도/에스컬레이션할지

현재 step 정의는 이 정도의 풍부한 업무 의미를 다 담지는 못한다.

### 3.2 부족한 정보를 사용자에게 물어보는 엔진이 약하다

현재는 `required_inputs`가 없으면 바로 에러로 보는 흐름에 가깝다.
하지만 실제 업무형 에이전트는 이렇게 동작해야 한다.

1. 필요한 정보 목록을 점검한다.
2. 없는 항목만 추린다.
3. 사용자에게 순서대로 물어본다.
4. 답변을 facts에 병합한다.
5. 다시 다음 단계로 진행한다.

즉 "missing facts -> 질문 생성 -> 답변 수집 -> facts 반영 -> resume" 엔진이 필요하다.

### 3.3 사실(fact)과 증거(evidence)의 구분이 더 필요하다

실제 업무에서는 다음이 구분되어야 한다.

- 사용자가 말한 값
- 웹에서 확인한 값
- 메일에서 읽은 값
- 아직 후보인 값
- 최종 검증된 값

예를 들면:

- `traveler_name`
- `destination_country`
- `customs_number`
- `recipient_email`

각 항목마다 단순 값만 있는 게 아니라 다음이 필요하다.

- 값
- 출처
- 검증 여부
- 마지막 업데이트 시각
- 어떤 step에서 확정됐는지

지금은 이 구분이 약해서, 다음 step에서 다시 흔들릴 여지가 있다.

### 3.4 상위 오케스트레이터와 서브에이전트 호출 계층이 분명하지 않다

최종적으로는 상위 오케스트레이터가 직접 웹 도구와 메일 도구를 하나씩 건드리는 구조보다, 아래처럼 가는 것이 맞다.

- 상위 오케스트레이터
  - 어떤 정보가 필요한지 판단
  - 어떤 채널이 필요한지 판단
  - 웹 서브에이전트에게 목표를 위임
  - 메일 서브에이전트에게 목표를 위임
  - 결과를 다시 facts로 통합

즉 상위는 "무엇을 해야 하는지"를 결정하고, 하위는 "어떻게 수행하는지"를 담당해야 한다.

### 3.5 완료 판정이 더 구조화되어야 한다

현재는 step이 끝났는지 여부가 상대적으로 단순하다.
하지만 실제 업무 오케스트레이션에서는 각 단계마다 completion criteria가 명확해야 한다.

예:

- customs number가 확보되었는가
- recipient가 검증되었는가
- draft preview가 맞는가
- approval이 떨어졌는가
- 회신에 필요한 필드가 모두 있는가

이 조건이 명확해야 planner가 덜 흔들린다.

## 4. 최종적으로 필요한 상위 시스템

이 구조를 진짜 업무형 에이전틱 오케스트레이션으로 만들기 위해서는 아래 시스템이 더 필요하다.

### 4.1 메뉴얼/플레이북 레지스트리 강화

현재 workflow registry를 다음 수준으로 확장해야 한다.

- workflow id
- trigger
- required facts
- optional facts
- 질문 템플릿
- 질문 순서
- step별 목적
- step별 성공 조건
- step별 allowed subagent
- approval 정책
- waiting 정책
- timeout / remind / escalate 정책
- 결과물 저장 규칙

즉 단순 step 목록이 아니라 "업무를 수행하는 규칙집"이어야 한다.

### 4.2 Fact Collection Engine

이 엔진은 다음을 해야 한다.

- 현재 필요한 fact 목록 계산
- 이미 있는 fact와 없는 fact 구분
- 사용자에게 물어봐야 할 것만 선별
- 질문을 번호 리스트로 생성
- 답변을 파싱해서 facts에 병합
- 검증 실패 시 재질문

이게 있어야 사용자가 메뉴얼 기반 상호작용을 자연스럽게 할 수 있다.

### 4.3 Verified Fact / Evidence Store

각 fact는 최소 아래 정보를 가져야 한다.

- key
- value
- source
  - user
  - web
  - mail
  - system
- status
  - candidate
  - verified
  - rejected
- updated_at
- produced_by_step

이 구조가 있어야 planner가 매 step마다 다시 추측하지 않고, 이미 확정된 정보를 재사용할 수 있다.

### 4.4 Subagent Invocation Layer

상위 오케스트레이터는 직접 모든 도구를 다루기보다, 다음처럼 하위 실행기를 부르는 계층이 필요하다.

- `invoke_web_agent(goal, constraints, expected_output)`
- `invoke_mail_agent(goal, constraints, expected_output)`

예:

- "보안 포털에서 customs number가 필요한 필드 위치와 현재 값 확인"
- "양승수에게 보낼 요청 메일 초안 작성"
- "제태호를 cc로 넣은 최종 수신자 상태 확인"

이렇게 목적 중심으로 위임한 뒤, 결과만 facts/evidence로 다시 올리는 구조가 더 맞다.

### 4.5 Human Interaction Engine

사용자와의 상호작용은 approval만으로 끝나면 안 된다.
다음이 필요하다.

- 부족한 정보 질의
- 다중 항목 입력
- 확인 질문
- ambiguity resolution
- manual correction

즉 `WAITING_HUMAN`을 실제로 쓰는 질문-응답 루프가 필요하다.

### 4.6 Completion / Verification Engine

각 step마다 다음이 있어야 한다.

- 이번 step의 completion criteria
- 결과 검증 규칙
- 실패 시 재시도 조건
- 다른 subagent로 fallback할지 여부

예:

- 메일 검색 결과가 목표 메일과 같은가
- 연락처 검색 결과가 원하는 사람/그룹과 같은가
- 초안의 to/cc가 지시와 정확히 같은가
- 웹 폼의 preview가 실제 제출 대상과 같은가

### 4.7 상위 오케스트레이터 런타임 루프

실제로는 상위 오케스트레이터가 아래 순서로 매 턴 돌아야 한다.

1. 현재 case와 workflow를 읽는다.
2. 현재 step의 목적과 성공 조건을 읽는다.
3. facts, verified facts, pending questions, approval 상태, waiting 상태를 읽는다.
4. 지금 해야 할 일이 무엇인지 분기한다.

분기는 보통 이 순서가 맞다.

- 필요한 정보가 비어 있으면:
  - 사용자 질문 생성
  - `WAITING_HUMAN`
- 승인 대기 중이면:
  - `APPROVAL_REQUIRED`
- 외부 회신 대기 중이면:
  - `WAITING_EMAIL` 또는 `WAITING_CHAT`
- 필요한 정보가 충분하면:
  - 서브에이전트 호출
- step 성공 조건이 충족되면:
  - 다음 step으로 전이

즉 상위 오케스트레이터는 매번 "어떤 도구를 쓸까"를 먼저 고민하는 것이 아니라, "지금 상태에서 어떤 종류의 행동이 맞는가"를 먼저 판단해야 한다.

### 4.8 실패 처리와 재시도 엔진

이 부분이 없으면 에이전트가 한번 삐끗했을 때 금방 흔들린다.

실패는 최소 세 가지로 나눠야 한다.

1. 도구 실패
- 예:
  - 웹 페이지 로딩 실패
  - 메일 검색 실패
  - 연락처 검색 실패
- 이 경우는 같은 입력으로 재시도할지, 다른 서브에이전트로 fallback할지 결정해야 한다.

2. 검증 실패
- 예:
  - 읽은 메일이 목표 메일과 다름
  - 찾은 연락처가 원하는 사람과 다름
  - draft의 to/cc가 지시와 다름
- 이 경우는 "결과는 나왔지만 잘못된 결과"이므로, 다음 행동은 재검색 또는 수정이다.

3. 비즈니스 실패
- 예:
  - 회신이 SLA 안에 오지 않음
  - customs number가 끝까지 확보되지 않음
  - 사용자가 필수 정보를 주지 않음
- 이 경우는 재시도보다 `ESCALATED` 또는 장기 waiting으로 보내야 한다.

즉 상위 오케스트레이터는 실패를 단순히 "tool error" 하나로 보면 안 되고, 어떤 종류의 실패인지 분류해야 한다.

### 4.9 facts / evidence / artifacts의 저장 구조

업무형 오케스트레이션은 데이터를 아래처럼 나눠서 저장해야 안정적이다.

#### facts

상위 업무 판단에 쓰이는 현재 값이다.

예:

- `traveler_name`
- `destination_country`
- `customs_number`
- `primary_recipient`
- `cc_recipients`

#### evidence

해당 fact를 왜 믿는지에 대한 근거다.

예:

- 어떤 메일에서 customs number를 읽었는가
- 어떤 연락처 검색 결과에서 recipient를 확정했는가
- 어떤 웹 페이지에서 shipment id를 확인했는가

#### artifacts

실제 시스템에 남는 결과물이다.

예:

- draft id
- message id
- conversation id
- DHL shipment record id
- security portal registration id

이 셋을 구분해야:

- planner는 facts를 보고 의사결정
- operator는 evidence를 보고 검증
- 시스템은 artifacts를 보고 재개/resume

를 할 수 있다.

### 4.10 사람 질문과 승인 질문의 분리

질문은 두 종류다.

1. 정보 수집 질문
- "출장자 이름이 무엇인가요?"
- "배송 국가는 어디인가요?"
- "장비 수량은 몇 개인가요?"

이건 `WAITING_HUMAN`으로 가야 한다.

2. 승인 질문
- "이 메일을 보내시겠습니까?"
- "이 DHL 제출 preview가 맞습니까?"

이건 `APPROVAL_REQUIRED`로 가야 한다.

지금도 approval는 있지만, 실제 메뉴얼형 오케스트레이션에선 정보 수집 질문과 승인 질문을 명확히 분리해야 한다.

### 4.11 서브에이전트 호출 규약

웹/메일 서브에이전트를 그냥 자유 프롬프트로 호출하면 다시 흔들릴 수 있다.
그래서 상위 오케스트레이터는 아래 형태로 호출해야 한다.

- 목표
- 현재까지 확정된 facts
- 이번 호출의 completion criteria
- 허용된 채널
- 수정 가능 범위
- 금지 행동

예를 들면 메일 서브에이전트 호출은 이런 식이어야 한다.

- 목표: vendor에게 customs number 요청 메일 초안 작성
- 필수 facts:
  - traveler_name
  - destination_country
  - vendor_name
  - primary_recipient
  - cc_recipients
- 완료 조건:
  - draft가 생성되었고
  - to/cc/subject/body가 검증 가능하며
  - preview가 반환되었음

웹 서브에이전트도 마찬가지다.

- 목표: DHL 폼에 현재 facts를 입력하고 preview 확보
- 완료 조건:
  - preview가 생성되었고
  - 제출 직전 상태가 확인 가능함

즉 상위 오케스트레이터는 단순히 "웹 해줘"가 아니라 "무엇을 완성하고 돌아와야 하는지"를 명확히 내려줘야 한다.

## 5. DHL 송부하기 시나리오를 올바르게 풀어내는 방식

사용자가 "DHL 송부하기"라고 말했을 때 이상적인 오케스트레이션은 다음 순서다.

### 5.1 상위 목표 해석

- workflow = overseas_equipment_shipment
- 현재 목적 = DHL 송부 완료

### 5.2 필요한 fact 점검

예를 들어 아래 항목이 필요할 수 있다.

1. traveler name
2. traveler email
3. destination country
4. equipment name
5. quantity
6. serial number
7. shipping address
8. customs number 필요 여부
9. 보안 등록 필요 여부

### 5.3 부족한 항목을 사용자에게 질문

예:

1. 출장자 이름은 무엇인가요?
2. 배송 목적 국가는 어디인가요?
3. 장비명과 수량은 무엇인가요?
4. 시리얼 번호가 있나요?

사용자 답변은 facts로 저장한다.

### 5.4 prerequisite 검증

- customs number가 필요한지
- 보안 등록이 필요한지
- 외부 메일 송부 승인이 필요한지

### 5.5 메일 서브에이전트 호출

필요하면 다음을 위임한다.

- vendor에게 customs number 요청 메일 초안 작성
- 수신자/참조 검증
- preview 생성

승인 후 send한다.

### 5.6 WAITING_EMAIL

- 회신 expectation 등록
- `WAITING_EMAIL` 진입
- 회신 오면 resume
- customs number 추출

### 5.7 웹 서브에이전트 호출

이후 필요한 내부 시스템에서:

- 보안 등록 draft
- preview
- approval
- submit

다음으로 DHL 시스템에서:

- 배송 draft
- preview
- approval
- submit

### 5.8 완료와 통보

- DHL submission id 저장
- 관련자 통보 초안
- 필요 시 발송
- case를 `COMPLETED`로 전이

### 5.9 실제 운영에서의 재시도 루프

실제론 한 번에 안 끝나는 경우가 더 많다.
그래서 아래 루프가 필요하다.

1. 메일 서브에이전트가 draft 생성
2. 상위 오케스트레이터가 preview 검증
3. 잘못됐으면 수정 요청
4. 다시 update draft 또는 새 draft
5. 승인 후 send
6. 회신이 없으면 remind
7. 회신이 왔는데 필수 필드가 없으면 다시 요청 메일
8. DHL 웹 단계에서 preview mismatch면 수정 후 재실행

즉 상위 오케스트레이터는 단발성 호출이 아니라 "검증-수정-재실행"을 감싸야 한다.

## 6. 지금 구현된 것과 추가 구현이 필요한 것

### 6.1 지금 구현된 것

- 케이스 상태 모델
- approval / expectation / waiting
- 웹 하위 실행기
- 메일 하위 실행기
- planner 기반 bounded action 선택
- event resume

### 6.2 바로 추가 구현이 필요한 것

- 메뉴얼/플레이북 스키마 확장
- missing facts 질문 엔진
- `WAITING_HUMAN` 실제 사용 경로
- fact/evidence/verified 구조 강화
- 상위 orchestrator -> 하위 web/mail subagent 호출 구조
- completion criteria와 verification 규칙

이걸 코드 관점으로 더 구체적으로 풀면 다음과 같다.

#### A. workflow schema 확장

지금 workflow step에는 `required_inputs`, `checklist`, `allowed_tools`, `approval_policy`, `waiting` 정도가 있다.
여기에 아래가 더 필요하다.

- `required_facts`
- `optional_facts`
- `question_templates`
- `completion_criteria`
- `verification_rules`
- `retry_policy`
- `escalation_policy`
- `subagent_goal_template`
- `outputs_to_promote`

즉 workflow가 단순 실행 단계가 아니라, 사실상 "업무 메뉴얼 실행 규칙"이 되어야 한다.

#### B. missing facts 처리 방식 변경

현재는 missing facts가 있으면 바로 에러 성격으로 끝나기 쉽다.
이걸 아래처럼 바꿔야 한다.

- missing facts 계산
- 질문 리스트 생성
- `WAITING_HUMAN` 전이
- 답변 수집
- fact merge
- 같은 step 재평가

즉 "에러"가 아니라 "정상적인 인터랙션 상태"로 다뤄야 한다.

#### C. 상위 fact store 강화

현재 facts는 값 위주다.
여기에 아래 속성을 추가로 유지해야 한다.

- source
- verified
- confidence
- produced_by_step
- evidence_ref

그래야 웹/메일 결과가 다음 단계에서 안정적으로 재사용된다.

#### D. web/mail 결과를 case memory에 올리는 규칙

지금은 하위 에이전트가 자기 루프 안에서 많은 걸 알고 있어도, 상위 case에는 충분히 구조화되어 안 올라올 수 있다.
그래서 다음 규칙이 필요하다.

- 메일 읽기 결과에서 어떤 field를 facts로 승격할지
- 연락처 검색 결과에서 어떤 recipient를 확정할지
- draft preview에서 무엇을 verification 대상으로 쓸지
- 웹 preview에서 어떤 값을 artifact와 fact로 저장할지

즉 "서브에이전트 성공"과 "상위 업무 상태 갱신"을 분리해야 한다.

#### E. recovery 정책

각 step에는 최소 다음이 있어야 한다.

- tool fail 시 재시도 횟수
- verification fail 시 대안 행동
- 회신 미도착 시 remind/escalate
- 사용자 응답 지연 시 reminder

이게 없으면 실제 운영에서 불안정해진다.

### 6.3 추가 구현 후에도 반드시 적어야 하는 것

새 기능을 만들 때는 코드만 추가하면 안 되고, 아래까지 문서화해야 한다.

- workflow 정의 포맷
- fact 정의 목록
- 질문 템플릿
- step별 성공 조건
- approval 이유와 preview 규칙
- waiting matcher 규칙
- escalation 규칙
- 하위 서브에이전트 호출 규약
- 테스트 시나리오와 예상 상태 전이

추가로 아래도 적어야 한다.

- 어떤 질문은 사용자에게 묻고 어떤 값은 자동 추출하는지
- 어떤 step은 draft만 만들고 어떤 step은 commit까지 가는지
- 어떤 evidence가 fact 승격의 근거가 되는지
- 어떤 failure가 retry 대상이고 어떤 failure가 escalation 대상인지

즉 "기능 구현"과 "운영 가능한 문서화"를 같이 가져가야 한다.

## 7. 이해하기 쉽게 한 줄로 정리

현재 시스템은 "웹/메일을 잘 다루는 서브에이전트"까지는 많이 와 있다.
하지만 네가 원하는 최종 형태는 그 위에 "업무 메뉴얼을 읽고, 부족한 정보를 사람에게 물어보고, 적절한 시점에 웹/메일 서브에이전트를 호출하고, 승인/대기/재개까지 관리하는 상위 오케스트레이터"를 얹는 것이다.

즉 앞으로 필요한 핵심은 다음 네 가지다.

1. 메뉴얼을 실행 가능한 구조로 만들기
2. 부족한 정보를 사람에게 묻는 엔진 만들기
3. 확정된 사실과 근거를 상태로 고정하기
4. 웹/메일 서브에이전트를 상위 업무 흐름 안에서 호출하기

이 네 가지가 붙으면, "DHL 송부하기" 같은 큰 업무 목표도 자연어 입력 하나로 점진적으로 완결하는 진짜 업무형 에이전틱 시스템에 가까워진다.
