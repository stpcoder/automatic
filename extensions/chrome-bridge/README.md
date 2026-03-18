# Chrome Bridge Extension

이 확장은 기존 `/bridge/*` API를 그대로 사용하면서, 북마클릿 대신 content script와 background service worker로 현재 탭을 브리지 세션에 연결한다.

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

- 일반 웹페이지에서는 자동 활성화된다.
- 시스템 패턴과 맞는 정의가 있으면 그 시스템으로 붙고, 없으면 `web_generic`으로 붙는다.
- 세션은 `ext-tab-<tabId>` 형태로 등록된다.
- 페이지 이동 후에도 새 content script가 같은 탭에서 다시 붙는다.
- 로컬 서버 통신은 content script가 직접 하지 않고 background service worker가 프록시한다.

## 예외

- `chrome://`, Chrome Web Store 같은 브라우저 내부 페이지는 Chrome 정책상 content script를 강제로 주입할 수 없다.
- Chrome 확장 설정에서 site access가 `On click`으로 바뀌어 있으면, 코드와 무관하게 자동 동작하지 않는다. 이 경우 `On all sites`로 바꿔야 한다.

## 장점

- 북마클릿 수동 클릭 불필요
- 페이지 이동 후 자동 재연결
- 같은 탭 이동과 child tab follow에 유리한 session 구조
- 클릭/입력 전에 포인터와 smooth scroll 시각화
- 같은 브리지 API 재사용

## 한계

- 여전히 content script 기반이므로 브라우저 외부 애플리케이션 수준 제어는 못 한다.
- 멀티탭 고급 선택은 서버 쪽 `session_id` 라우팅 강화가 더 필요하다.
