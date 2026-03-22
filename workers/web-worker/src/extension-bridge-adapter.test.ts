import test from "node:test";
import assert from "node:assert/strict";

import { browserBridgeCoordinator } from "../../../packages/browser-bridge/src/index.js";

import { ExtensionBridgeAdapter } from "./extension-bridge-adapter.js";

test("extension adapter opens a new tab for an explicit target url even when a current session is provided", async () => {
  browserBridgeCoordinator.reset();

  browserBridgeCoordinator.registerSession({
    session_id: "session-naver",
    system_id: "web_generic",
    title: "NAVER",
    url: "https://www.naver.com"
  });
  browserBridgeCoordinator.updateObservation("session-naver", {
    channel: "web",
    summary: "네이버 메인 페이지",
    payload: {
      sessionId: "session-naver",
      systemId: "web_generic",
      pageId: "generic_page",
      title: "NAVER",
      url: "https://www.naver.com",
      summary: "네이버 메인 페이지",
      interactiveElements: []
    }
  });

  const adapter = new ExtensionBridgeAdapter();
  const openPromise = adapter.openSystem("web_generic", undefined, {
    sessionId: "session-naver",
    targetUrl: "https://www.google.com",
    urlContains: "google.com",
    titleContains: "Google",
    openIfMissing: true
  });

  await new Promise((resolve) => setTimeout(resolve, 20));

  const tasks = browserBridgeCoordinator.listBrowserTasks();
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0]?.type, "open_tab");
  assert.equal(tasks[0]?.payload.url, "https://www.google.com");

  browserBridgeCoordinator.registerSession({
    session_id: "session-google",
    parent_session_id: "session-naver",
    system_id: "web_generic",
    title: "Google",
    url: "https://www.google.com"
  });
  browserBridgeCoordinator.updateObservation("session-google", {
    channel: "web",
    summary: "Google 검색 페이지",
    payload: {
      sessionId: "session-google",
      parentSessionId: "session-naver",
      systemId: "web_generic",
      pageId: "generic_search_home",
      title: "Google",
      url: "https://www.google.com",
      summary: "Google 검색 페이지",
      interactiveElements: []
    }
  });

  const observation = await openPromise;
  assert.equal(observation.sessionId, "session-google");
  assert.equal(observation.parentSessionId, "session-naver");
  assert.equal(observation.url, "https://www.google.com");
  assert.equal(observation.title, "Google");
});

test("extension adapter opens a new tab for an explicit target url without requiring a pinned current session", async () => {
  browserBridgeCoordinator.reset();

  const adapter = new ExtensionBridgeAdapter();
  const openPromise = adapter.openSystem("web_generic", undefined, {
    targetUrl: "https://www.google.com",
    urlContains: "google.com",
    titleContains: "Google",
    openIfMissing: true
  });

  await new Promise((resolve) => setTimeout(resolve, 20));

  const tasks = browserBridgeCoordinator.listBrowserTasks();
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0]?.type, "open_tab");
  assert.equal(tasks[0]?.payload.url, "https://www.google.com");

  browserBridgeCoordinator.registerSession({
    session_id: "session-google",
    system_id: "web_generic",
    title: "Google",
    url: "https://www.google.com"
  });
  browserBridgeCoordinator.updateObservation("session-google", {
    channel: "web",
    summary: "Google 검색 페이지",
    payload: {
      sessionId: "session-google",
      systemId: "web_generic",
      pageId: "generic_search_home",
      title: "Google",
      url: "https://www.google.com",
      summary: "Google 검색 페이지",
      interactiveElements: []
    }
  });

  const observation = await openPromise;
  assert.equal(observation.sessionId, "session-google");
  assert.equal(observation.url, "https://www.google.com");
  assert.equal(observation.title, "Google");
});

test("extension adapter treats default system_id as generic web for session reuse", async () => {
  browserBridgeCoordinator.reset();

  browserBridgeCoordinator.registerSession({
    session_id: "session-google",
    system_id: "web_generic",
    title: "Google",
    url: "https://www.google.com"
  });
  browserBridgeCoordinator.updateObservation("session-google", {
    channel: "web",
    summary: "Google 검색 페이지",
    payload: {
      sessionId: "session-google",
      systemId: "web_generic",
      pageId: "generic_search_home",
      title: "Google",
      url: "https://www.google.com",
      summary: "Google 검색 페이지",
      interactiveElements: []
    }
  });

  const adapter = new ExtensionBridgeAdapter();
  const observation = await adapter.openSystem("default", undefined, {
    targetUrl: "https://www.google.com",
    urlContains: "google.com",
    titleContains: "Google",
    openIfMissing: true
  });

  const tasks = browserBridgeCoordinator.listBrowserTasks();
  assert.equal(tasks.length, 0);
  assert.equal(observation.sessionId, "session-google");
  assert.equal(observation.url, "https://www.google.com");
});

test("extension adapter preserves structured observation fields from bridge payload", async () => {
  browserBridgeCoordinator.reset();

  browserBridgeCoordinator.registerSession({
    session_id: "session-structured",
    system_id: "web_generic",
    title: "SK hynix : 네이버 뉴스검색",
    url: "https://search.naver.com/search.naver?where=news&query=SK%20hynix"
  });
  browserBridgeCoordinator.updateObservation("session-structured", {
    channel: "web",
    summary: "SK hynix 뉴스검색",
    payload: {
      sessionId: "session-structured",
      systemId: "web_generic",
      pageId: "live_page",
      title: "SK hynix : 네이버 뉴스검색",
      url: "https://search.naver.com/search.naver?where=news&query=SK%20hynix",
      summary: "SK hynix 뉴스검색",
      keyMetrics: [{ label: "현재가", value: "1,021,000원", importance: 0.95 }],
      actionableCards: [
        {
          id: "card-1",
          type: "search_result",
          title: "美, SK하이닉스에 보조금 6600억 쏜다(종합)",
          href: "https://news.example.test/article",
          targetKey: "result_1",
          targetHandle: "28",
          importance: 0.91
        }
      ],
      interactiveElements: []
    }
  });

  const observation = await new ExtensionBridgeAdapter().openSystem("web_generic", undefined, {
    targetUrl: "https://search.naver.com/search.naver?where=news&query=SK%20hynix",
    urlContains: "search.naver.com/search.naver",
    openIfMissing: true
  });

  assert.equal(observation.keyMetrics?.[0]?.label, "현재가");
  assert.equal(observation.actionableCards?.[0]?.targetKey, "result_1");
});

test("extension adapter applies cards focus when requested", async () => {
  browserBridgeCoordinator.reset();

  browserBridgeCoordinator.registerSession({
    session_id: "session-cards",
    system_id: "web_generic",
    title: "SK hynix : 네이버쇼핑",
    url: "https://search.shopping.naver.com/ns/search?query=SK%20hynix"
  });
  browserBridgeCoordinator.updateObservation("session-cards", {
    channel: "web",
    summary: "SK hynix 쇼핑 검색 결과",
    payload: {
      sessionId: "session-cards",
      systemId: "web_generic",
      pageId: "live_page",
      title: "SK hynix : 네이버쇼핑",
      url: "https://search.shopping.naver.com/ns/search?query=SK%20hynix",
      summary: "SK hynix 쇼핑 검색 결과",
      interactiveElements: [
        {
          index: 1,
          handle: "12",
          type: "link",
          key: "nav_price",
          label: "가격비교",
          semanticRole: "navigation_link",
          region: "header",
          importance: 0.7
        },
        {
          index: 2,
          handle: "18",
          type: "link",
          key: "product_1",
          label: "SK hynix Platinum P41 1TB",
          href: "https://shopping.example.test/p41",
          semanticRole: "result_link",
          region: "main",
          importance: 0.95,
          nearbyText: "149,000원 판매처 네이버스토어"
        }
      ]
    }
  });

  const observation = await new ExtensionBridgeAdapter().observe("web_generic", "session-cards", { focus: "cards" });
  assert.equal(observation.focusUsed, "cards");
  assert.equal(observation.recommendedFocus, "cards");
  assert.equal(observation.interactiveElements[0]?.key, "product_1");
});

test("extension adapter derives structured observation fields when bridge payload is old", async () => {
  browserBridgeCoordinator.reset();

  browserBridgeCoordinator.registerSession({
    session_id: "session-legacy",
    system_id: "web_generic",
    title: "SK hynix : 네이버 뉴스검색",
    url: "https://search.naver.com/search.naver?where=news&query=SK%20hynix"
  });
  browserBridgeCoordinator.updateObservation("session-legacy", {
    channel: "web",
    summary: "SK hynix 뉴스검색",
    payload: {
      sessionId: "session-legacy",
      systemId: "web_generic",
      pageId: "live_page",
      title: "SK hynix : 네이버 뉴스검색",
      url: "https://search.naver.com/search.naver?where=news&query=SK%20hynix",
      summary: "SK hynix 뉴스검색",
      pageText: "현재가 1,021,000원 거래량 1,092,008",
      semanticBlocks: [
        { id: "metric-1", type: "label_value", text: "현재가 1,021,000원", importance: 0.92 },
        { id: "metric-2", type: "label_value", text: "거래량 1,092,008", importance: 0.88 }
      ],
      interactiveElements: [
        {
          index: 0,
          handle: "28",
          type: "link",
          key: "result_1",
          label: "美, SK하이닉스에 보조금 6600억 쏜다(종합)",
          href: "https://news.example.test/article",
          semanticRole: "result_link",
          nearbyText: "연합뉴스"
        }
      ]
    }
  });

  const observation = await new ExtensionBridgeAdapter().openSystem("web_generic", undefined, {
    targetUrl: "https://search.naver.com/search.naver?where=news&query=SK%20hynix",
    urlContains: "search.naver.com/search.naver",
    openIfMissing: true
  });

  assert.equal(observation.keyMetrics?.[0]?.label, "현재가");
  assert.equal(observation.actionableCards?.[0]?.targetKey, "result_1");
});

test("extension adapter prefers stable target key over stale handle when clicking", async () => {
  browserBridgeCoordinator.reset();

  browserBridgeCoordinator.registerSession({
    session_id: "session-news",
    system_id: "web_generic",
    title: "SK hynix : 네이버 뉴스검색",
    url: "https://search.naver.com/search.naver?where=news&query=SK%20hynix"
  });
  browserBridgeCoordinator.updateObservation("session-news", {
    channel: "web",
    summary: "SK hynix 뉴스검색",
    payload: {
      sessionId: "session-news",
      systemId: "web_generic",
      pageId: "live_page",
      title: "SK hynix : 네이버 뉴스검색",
      url: "https://search.naver.com/search.naver?where=news&query=SK%20hynix",
      summary: "SK hynix 뉴스검색",
      pageText: "JENSEN SK HYNIX article list",
      domOutline: "news results",
      interactiveElements: [
        {
          index: 0,
          handle: "14",
          type: "link",
          key: "cafe",
          label: "카페",
          href: "https://search.naver.com/search.naver?ssc=tab.cafe.all&query=SK+hynix",
          semanticRole: "navigation_link"
        },
        {
          index: 1,
          handle: "37",
          type: "link",
          key: "jensen_sk_hynix_최태원_젠슨황_ai_혈맹_굳히기",
          label: "JENSEN♡SK HYNIX…최태원-젠슨황, AI 혈맹 굳히기",
          href: "https://www.nocutnews.co.kr/news/123",
          semanticRole: "result_link",
          nearbyText: "JENSEN♡SK HYNIX…최태원-젠슨황, AI 혈맹 굳히기"
        }
      ]
    }
  });

  const clickPromise = new ExtensionBridgeAdapter().clickElement(
    "web_generic",
    "jensen_sk_hynix_최태원_젠슨황_ai_혈맹_굳히기",
    "session-news",
    "14"
  );

  setTimeout(() => {
    const pending = browserBridgeCoordinator.pullPendingCommands("session-news");
    assert.equal(pending.length, 1);
    browserBridgeCoordinator.completeCommand("session-news", pending[0].command_id, {
      success: true,
      result: {
        target: {
          handle: "37",
          key: "jensen_sk_hynix_최태원_젠슨황_ai_혈맹_굳히기",
          label: "JENSEN♡SK HYNIX…최태원-젠슨황, AI 혈맹 굳히기",
          href: "https://www.nocutnews.co.kr/news/123",
          semanticRole: "result_link"
        }
      }
    });
    browserBridgeCoordinator.updateObservation("session-news", {
      channel: "web",
      summary: "노컷뉴스 기사 상세",
      payload: {
        sessionId: "session-news",
        systemId: "web_generic",
        pageId: "live_page",
        title: "노컷뉴스 기사 상세",
        url: "https://www.nocutnews.co.kr/news/123",
        summary: "노컷뉴스 기사 상세",
        pageText: "기사 본문",
        domOutline: "기사 본문",
        interactiveElements: []
      }
    });
  }, 20);

  const result = await clickPromise;
  assert.equal(result.target?.key, "jensen_sk_hynix_최태원_젠슨황_ai_혈맹_굳히기");
  assert.equal(result.observation.url, "https://www.nocutnews.co.kr/news/123");
  assert.equal(result.navigationEvent?.kind, "same_session");
  assert.equal(result.navigationEvent?.matchedExpectation, true);
});

test("extension adapter reports navigation_event none when a link click does not produce a meaningful page transition", async () => {
  browserBridgeCoordinator.reset();
  process.env.BRIDGE_CLICK_NAVIGATION_TIMEOUT_MS = "50";
  process.env.BRIDGE_CLICK_OBSERVATION_TIMEOUT_MS = "50";
  try {
    browserBridgeCoordinator.registerSession({
      session_id: "session-static",
      system_id: "web_generic",
      title: "SK hynix : 네이버 뉴스검색",
      url: "https://search.naver.com/search.naver?where=news&query=SK%20hynix"
    });
    browserBridgeCoordinator.updateObservation("session-static", {
      channel: "web",
      summary: "SK hynix 뉴스검색",
      payload: {
        sessionId: "session-static",
        systemId: "web_generic",
        pageId: "live_page",
        title: "SK hynix : 네이버 뉴스검색",
        url: "https://search.naver.com/search.naver?where=news&query=SK%20hynix",
        summary: "SK hynix 뉴스검색",
        pageText: "same page",
        domOutline: "same outline",
        interactiveElements: [
          {
            index: 0,
            handle: "14",
            type: "link",
            key: "jensen_sk_hynix_최태원_젠슨황_ai_혈맹_굳히기",
            label: "JENSEN♡SK HYNIX…최태원-젠슨황, AI 혈맹 굳히기",
            href: "https://www.nocutnews.co.kr/news/123",
            semanticRole: "result_link"
          }
        ]
      }
    });

    const adapter = new ExtensionBridgeAdapter();
    const clickPromise = adapter.clickElement(
      "web_generic",
      "jensen_sk_hynix_최태원_젠슨황_ai_혈맹_굳히기",
      "session-static",
      "14"
    );

    setTimeout(() => {
      const pending = browserBridgeCoordinator.pullPendingCommands("session-static");
      assert.equal(pending.length, 1);
      browserBridgeCoordinator.completeCommand("session-static", pending[0].command_id, {
        success: true,
        result: {
          target: {
            handle: "14",
            key: "jensen_sk_hynix_최태원_젠슨황_ai_혈맹_굳히기",
            label: "JENSEN♡SK HYNIX…최태원-젠슨황, AI 혈맹 굳히기",
            href: "https://www.nocutnews.co.kr/news/123",
            semanticRole: "result_link"
          }
        }
      });
    }, 20);

    const result = await clickPromise;
    assert.equal(result.navigationEvent?.kind, "none");
    assert.equal(result.navigationEvent?.expectedNavigation, true);
    assert.equal(result.navigationEvent?.matchedExpectation, false);
    assert.equal(result.observation.sessionId, "session-static");
  } finally {
    delete process.env.BRIDGE_CLICK_NAVIGATION_TIMEOUT_MS;
    delete process.env.BRIDGE_CLICK_OBSERVATION_TIMEOUT_MS;
  }
});

test("extension adapter click result reports child_session when a new tab opens", async () => {
  browserBridgeCoordinator.reset();

  browserBridgeCoordinator.registerSession({
    session_id: "session-results",
    system_id: "web_generic",
    title: "SK hynix : 네이버 검색",
    url: "https://search.naver.com/search.naver?where=news&query=SK%20hynix"
  });
  browserBridgeCoordinator.updateObservation("session-results", {
    channel: "web",
    summary: "SK hynix 뉴스검색",
    payload: {
      sessionId: "session-results",
      systemId: "web_generic",
      pageId: "live_page",
      title: "SK hynix : 네이버 검색",
      url: "https://search.naver.com/search.naver?where=news&query=SK%20hynix",
      summary: "SK hynix 뉴스검색",
      pageText: "news results",
      domOutline: "news results",
      interactiveElements: [
        {
          index: 0,
          handle: "52",
          type: "link",
          key: "top_article",
          label: "SK하이닉스, 업무에 영어 입힌다…'AI 인프라' 조직부터 적용",
          href: "https://www.yna.co.kr/view/AKR20260320147100003?input=1195m",
          semanticRole: "result_link"
        }
      ]
    }
  });

  const clickPromise = new ExtensionBridgeAdapter().clickElement("web_generic", "top_article", "session-results", "52");

  setTimeout(() => {
    const pending = browserBridgeCoordinator.pullPendingCommands("session-results");
    assert.equal(pending.length, 1);
    browserBridgeCoordinator.completeCommand("session-results", pending[0].command_id, {
      success: true,
      result: {
        target: {
          handle: "52",
          key: "top_article",
          label: "SK하이닉스, 업무에 영어 입힌다…'AI 인프라' 조직부터 적용",
          href: "https://www.yna.co.kr/view/AKR20260320147100003?input=1195m",
          semanticRole: "result_link"
        }
      }
    });
    browserBridgeCoordinator.registerSession({
      session_id: "session-article",
      parent_session_id: "session-results",
      system_id: "web_generic",
      title: "SK하이닉스, 업무에 영어 입힌다…'AI 인프라' 조직부터 적용 | 연합뉴스",
      url: "https://www.yna.co.kr/view/AKR20260320147100003?input=1195m"
    });
    browserBridgeCoordinator.updateObservation("session-article", {
      channel: "web",
      summary: "연합뉴스 기사",
      payload: {
        sessionId: "session-article",
        parentSessionId: "session-results",
        systemId: "web_generic",
        pageId: "live_page",
        title: "SK하이닉스, 업무에 영어 입힌다…'AI 인프라' 조직부터 적용 | 연합뉴스",
        url: "https://www.yna.co.kr/view/AKR20260320147100003?input=1195m",
        summary: "연합뉴스 기사",
        pageText: "기사 본문",
        domOutline: "기사 본문",
        interactiveElements: []
      }
    });
  }, 20);

  const result = await clickPromise;
  assert.equal(result.navigationEvent?.kind, "child_session");
  assert.equal(result.navigationEvent?.newSessionOpened, true);
  assert.equal(result.navigationEvent?.currentSessionChanged, false);
  assert.equal(result.navigationEvent?.fromSessionId, "session-results");
  assert.equal(result.navigationEvent?.toSessionId, "session-article");
});

test("extension adapter click result can attach to a newly opened tab by href even when parent linkage is missing", async () => {
  browserBridgeCoordinator.reset();

  browserBridgeCoordinator.registerSession({
    session_id: "session-results",
    system_id: "web_generic",
    title: "SK hynix : 네이버 검색",
    url: "https://search.naver.com/search.naver?where=news&query=SK%20hynix"
  });
  browserBridgeCoordinator.updateObservation("session-results", {
    channel: "web",
    summary: "SK hynix 뉴스검색",
    payload: {
      sessionId: "session-results",
      systemId: "web_generic",
      pageId: "live_page",
      title: "SK hynix : 네이버 검색",
      url: "https://search.naver.com/search.naver?where=news&query=SK%20hynix",
      summary: "SK hynix 뉴스검색",
      pageText: "news results",
      domOutline: "news results",
      interactiveElements: [
        {
          index: 0,
          handle: "52",
          type: "link",
          key: "top_article",
          label: "SK하이닉스, 업무에 영어 입힌다…'AI 인프라' 조직부터 적용",
          href: "https://www.yna.co.kr/view/AKR20260320147100003?input=1195m",
          semanticRole: "result_link"
        }
      ]
    }
  });

  const clickPromise = new ExtensionBridgeAdapter().clickElement("web_generic", "top_article", "session-results", "52");

  setTimeout(() => {
    const pending = browserBridgeCoordinator.pullPendingCommands("session-results");
    assert.equal(pending.length, 1);
    browserBridgeCoordinator.completeCommand("session-results", pending[0].command_id, {
      success: true,
      result: {
        target: {
          handle: "52",
          key: "top_article",
          label: "SK하이닉스, 업무에 영어 입힌다…'AI 인프라' 조직부터 적용",
          href: "https://www.yna.co.kr/view/AKR20260320147100003?input=1195m",
          semanticRole: "result_link"
        }
      }
    });
    browserBridgeCoordinator.registerSession({
      session_id: "session-article-detached",
      system_id: "web_generic",
      title: "SK하이닉스, 업무에 영어 입힌다…'AI 인프라' 조직부터 적용 | 연합뉴스",
      url: "https://www.yna.co.kr/view/AKR20260320147100003?input=1195m"
    });
    browserBridgeCoordinator.updateObservation("session-article-detached", {
      channel: "web",
      summary: "연합뉴스 기사",
      payload: {
        sessionId: "session-article-detached",
        systemId: "web_generic",
        pageId: "live_page",
        title: "SK하이닉스, 업무에 영어 입힌다…'AI 인프라' 조직부터 적용 | 연합뉴스",
        url: "https://www.yna.co.kr/view/AKR20260320147100003?input=1195m",
        summary: "연합뉴스 기사",
        pageText: "기사 본문",
        domOutline: "기사 본문",
        interactiveElements: []
      }
    });
  }, 20);

  const result = await clickPromise;
  assert.equal(result.observation.sessionId, "session-article-detached");
  assert.equal(result.navigationEvent?.kind, "child_session");
  assert.equal(result.navigationEvent?.newSessionOpened, true);
  assert.equal(result.navigationEvent?.matchedExpectation, true);
  assert.equal(result.navigationEvent?.fromSessionId, "session-results");
  assert.equal(result.navigationEvent?.toSessionId, "session-article-detached");
});

test("extension adapter follow navigation can attach to a child session", async () => {
  browserBridgeCoordinator.reset();
  process.env.BRIDGE_FOLLOW_NAVIGATION_TIMEOUT_MS = "200";
  process.env.BRIDGE_FOLLOW_OBSERVATION_TIMEOUT_MS = "200";
  try {
    browserBridgeCoordinator.registerSession({
      session_id: "session-home",
      system_id: "web_generic",
      title: "NAVER",
      url: "https://www.naver.com"
    });
    browserBridgeCoordinator.updateObservation("session-home", {
      channel: "web",
      summary: "네이버 메인 페이지",
      payload: {
        sessionId: "session-home",
        systemId: "web_generic",
        pageId: "generic_home",
        title: "NAVER",
        url: "https://www.naver.com",
        summary: "네이버 메인 페이지",
        interactiveElements: []
      }
    });

    const followPromise = new ExtensionBridgeAdapter().followNavigation("web_generic", "session-home");

    setTimeout(() => {
      browserBridgeCoordinator.registerSession({
        session_id: "session-results",
        parent_session_id: "session-home",
        system_id: "web_generic",
        title: "SK hynix : 네이버 검색",
        url: "https://search.naver.com/search.naver?query=SK+hynix"
      });
      browserBridgeCoordinator.updateObservation("session-results", {
        channel: "web",
        summary: "SK hynix 검색 결과",
        payload: {
          sessionId: "session-results",
          parentSessionId: "session-home",
          systemId: "web_generic",
          pageId: "generic_search_results",
          title: "SK hynix : 네이버 검색",
          url: "https://search.naver.com/search.naver?query=SK+hynix",
          summary: "SK hynix 검색 결과",
          interactiveElements: []
        }
      });
    }, 20);

    const observation = await followPromise;
    assert.equal(observation.sessionId, "session-results");
    assert.equal(observation.parentSessionId, "session-home");
    assert.match(observation.url, /search\.naver\.com/);
  } finally {
    delete process.env.BRIDGE_FOLLOW_NAVIGATION_TIMEOUT_MS;
    delete process.env.BRIDGE_FOLLOW_OBSERVATION_TIMEOUT_MS;
  }
});

test("extension adapter follow navigation can attach to same-session navigation", async () => {
  browserBridgeCoordinator.reset();
  process.env.BRIDGE_FOLLOW_NAVIGATION_TIMEOUT_MS = "50";
  process.env.BRIDGE_FOLLOW_OBSERVATION_TIMEOUT_MS = "200";
  try {
    browserBridgeCoordinator.registerSession({
      session_id: "session-home",
      system_id: "web_generic",
      title: "NAVER",
      url: "https://www.naver.com"
    });
    browserBridgeCoordinator.updateObservation("session-home", {
      channel: "web",
      summary: "네이버 메인 페이지",
      payload: {
        sessionId: "session-home",
        systemId: "web_generic",
        pageId: "generic_home",
        title: "NAVER",
        url: "https://www.naver.com",
        summary: "네이버 메인 페이지",
        interactiveElements: []
      }
    });

    const followPromise = new ExtensionBridgeAdapter().followNavigation("web_generic", "session-home");

    setTimeout(() => {
      browserBridgeCoordinator.updateObservation("session-home", {
        channel: "web",
        summary: "SK hynix 검색 결과",
        payload: {
          sessionId: "session-home",
          systemId: "web_generic",
          pageId: "generic_search_results",
          title: "SK hynix : 네이버 검색",
          url: "https://search.naver.com/search.naver?query=SK+hynix",
          summary: "SK hynix 검색 결과",
          interactiveElements: []
        }
      });
    }, 80);

    const observation = await followPromise;
    assert.equal(observation.sessionId, "session-home");
    assert.equal(observation.title, "SK hynix : 네이버 검색");
    assert.match(observation.url, /search\.naver\.com/);
  } finally {
    delete process.env.BRIDGE_FOLLOW_NAVIGATION_TIMEOUT_MS;
    delete process.env.BRIDGE_FOLLOW_OBSERVATION_TIMEOUT_MS;
  }
});

test("extension adapter follow navigation falls back to the current observation when navigation already settled", async () => {
  browserBridgeCoordinator.reset();
  process.env.BRIDGE_FOLLOW_NAVIGATION_TIMEOUT_MS = "50";
  process.env.BRIDGE_FOLLOW_OBSERVATION_TIMEOUT_MS = "50";
  try {
    browserBridgeCoordinator.registerSession({
      session_id: "session-results",
      system_id: "web_generic",
      title: "SK hynix : 네이버 검색",
      url: "https://search.naver.com/search.naver?query=SK+hynix"
    });
    browserBridgeCoordinator.updateObservation("session-results", {
      channel: "web",
      summary: "SK hynix 검색 결과",
      payload: {
        sessionId: "session-results",
        systemId: "web_generic",
        pageId: "generic_search_results",
        title: "SK hynix : 네이버 검색",
        url: "https://search.naver.com/search.naver?query=SK+hynix",
        summary: "SK hynix 검색 결과",
        interactiveElements: []
      }
    });

    const observation = await new ExtensionBridgeAdapter().followNavigation("web_generic", "session-results");
    assert.equal(observation.sessionId, "session-results");
    assert.equal(observation.title, "SK hynix : 네이버 검색");
    assert.match(observation.url, /search\.naver\.com/);
  } finally {
    delete process.env.BRIDGE_FOLLOW_NAVIGATION_TIMEOUT_MS;
    delete process.env.BRIDGE_FOLLOW_OBSERVATION_TIMEOUT_MS;
  }
});
