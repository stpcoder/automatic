# Chrome Bridge Extension

이 확장은 기존 `/bridge/*` API를 그대로 사용하면서, 북마클릿 대신 content script로 현재 탭을 브리지 세션에 연결한다.

## 설치

1. Chrome에서 `chrome://extensions` 열기
2. `Developer mode` 켜기
3. `Load unpacked` 클릭
4. 이 폴더 선택:
   - `extensions/chrome-bridge`

## 설정

확장 옵션에서 아래 값을 맞춘다.
- `Server origin`: 기본 `http://127.0.0.1:43117`
- `Poll interval`: 기본 `1000`
- `Observation change timeout`: 기본 `4000`

## 동작

- 현재 탭 URL이 `/bridge/extension-bootstrap`에 정의된 시스템 패턴과 맞으면 자동 활성화된다.
- 세션은 `ext-tab-<tabId>` 형태로 등록된다.
- 페이지 이동 후에도 새 content script가 같은 탭에서 다시 붙는다.

## 장점

- 북마클릿 수동 클릭 불필요
- 페이지 이동 후 자동 재연결
- 같은 브리지 API 재사용

## 한계

- 여전히 content script 기반이므로 브라우저 외부 애플리케이션 수준 제어는 못 한다.
- 멀티탭 고급 선택은 서버 쪽 `session_id` 라우팅 강화가 더 필요하다.
