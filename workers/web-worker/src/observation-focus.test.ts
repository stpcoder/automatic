import test from "node:test";
import assert from "node:assert/strict";

import { applyObservationFocus } from "./observation-focus.js";
import type { PageObservation } from "./types.js";

function buildObservation(): PageObservation {
  return {
    sessionId: "session-1",
    systemId: "web_generic",
    pageId: "live_page",
    url: "https://search.shopping.naver.com/ns/search?query=sk+hynix",
    title: "SK hynix : 네이버쇼핑",
    summary: "네이버 쇼핑 검색 결과",
    pageText:
      "네이버플러스 스토어 가격비교 검색 낮은 가격순 SK hynix Platinum P41 1TB 149,000원 판매처 네이버스토어",
    domOutline:
      "[12]<link key=nav_price type=link>가격비교 />\n[18]<link key=product_1 type=link role=result_link>SK hynix Platinum P41 1TB />",
    visibleTextBlocks: [
      "네이버플러스 스토어",
      "가격비교",
      "SK hynix Platinum P41 1TB",
      "149,000원",
      "판매처 네이버스토어"
    ],
    semanticBlocks: [
      { id: "s1", type: "heading", text: "SK hynix : 네이버쇼핑", importance: 0.8, region: "header" },
      { id: "s2", type: "summary", text: "가격비교 낮은 가격순", importance: 0.72, region: "header" },
      {
        id: "s3",
        type: "result_item",
        text: "SK hynix Platinum P41 1TB 149,000원 판매처 네이버스토어",
        importance: 0.95,
        region: "main"
      }
    ],
    keyMetrics: [{ label: "가격", value: "149,000원", importance: 0.92 }],
    actionableCards: [
      {
        id: "card-1",
        type: "product",
        title: "SK hynix Platinum P41 1TB",
        summary: "판매처 네이버스토어",
        href: "https://shopping.example.test/p41",
        targetKey: "product_1",
        targetHandle: "18",
        importance: 0.95
      }
    ],
    interactiveElements: [
      {
        index: 1,
        type: "link",
        key: "nav_price",
        label: "가격비교",
        semanticRole: "navigation_link",
        region: "header",
        importance: 0.74
      },
      {
        index: 2,
        type: "link",
        key: "product_1",
        handle: "18",
        label: "SK hynix Platinum P41 1TB",
        href: "https://shopping.example.test/p41",
        semanticRole: "result_link",
        region: "main",
        importance: 0.95,
        nearbyText: "149,000원 판매처 네이버스토어"
      }
    ]
  };
}

test("cards focus prioritizes result cards and recommends cards on shopping-like pages", () => {
  const focused = applyObservationFocus(buildObservation(), "cards");
  assert.equal(focused.focusUsed, "cards");
  assert.equal(focused.recommendedFocus, "cards");
  assert.equal(focused.actionableCards?.[0]?.title, "SK hynix Platinum P41 1TB");
  assert.equal(focused.interactiveElements[0]?.key, "product_1");
  assert.match(focused.summary, /focus=cards/i);
});

test("metrics focus retains key metric style summary", () => {
  const observation = buildObservation();
  observation.url = "https://finance.naver.com/item/main.naver?code=000660";
  observation.title = "SK하이닉스 : 네이버페이 증권";
  observation.pageText = "현재가 1,007,000 전일대비 6,000 거래량 5,177,516 시가총액 732,000억";
  observation.keyMetrics = [{ label: "현재가", value: "1,007,000", importance: 0.97 }];

  const focused = applyObservationFocus(observation, "metrics");
  assert.equal(focused.focusUsed, "metrics");
  assert.equal(focused.recommendedFocus, "metrics");
  assert.ok((focused.keyMetrics?.length ?? 0) >= 3);
  assert.equal(focused.keyMetrics?.[0]?.label, "현재가");
  assert.match(focused.pageText ?? "", /거래량/i);
});

test("forms focus highlights field values and actions", () => {
  const observation = buildObservation();
  observation.url = "https://www.naver.com";
  observation.title = "NAVER";
  observation.interactiveElements = [
    {
      index: 1,
      type: "input",
      key: "검색어를_입력해_주세요",
      label: "검색어를 입력해 주세요",
      value: "SK hynix",
      semanticRole: "search_input",
      region: "main",
      importance: 0.99
    },
    {
      index: 2,
      type: "button",
      key: "search_action",
      label: "검색",
      semanticRole: "primary_action",
      region: "main",
      importance: 0.9
    }
  ];
  observation.actionableCards = [];
  observation.keyMetrics = [];

  const focused = applyObservationFocus(observation, "forms");
  assert.equal(focused.focusUsed, "forms");
  assert.equal(focused.interactiveElements[0]?.key, "검색어를_입력해_주세요");
  assert.match(focused.pageText ?? "", /SK hynix/);
});
