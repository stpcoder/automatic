import { buildHarnessPage } from "./system-definitions.js";
import type {
  ClickResult,
  FillResult,
  HarnessPageDefinition,
  HistoryNavigationResult,
  PageObservation,
  PreviewResult,
  SemanticBlock,
  ScrollResult,
  SubmitResult,
  WebAdapter,
  WebOpenSelection
} from "./types.js";

interface SessionState {
  sessionId: string;
  parentSessionId?: string;
  systemId: string;
  page: HarnessPageDefinition;
  history: HarnessPageDefinition[];
  historyIndex: number;
}

export class PageAgentDomAdapter implements WebAdapter {
  readonly harnessName = "page_agent_dom";
  private readonly sessions = new Map<string, SessionState>();

  async openSystem(systemId: string, pageId?: string, selection?: WebOpenSelection): Promise<PageObservation> {
    const page = this.buildDefaultPage(systemId, pageId, selection);
    this.sessions.set(systemId, {
      sessionId: `page-agent-${crypto.randomUUID()}`,
      systemId,
      page,
      history: [page],
      historyIndex: 0
    });
    const session = this.getSession(systemId);
    return this.toObservation(session.page, systemId, session.sessionId, session.parentSessionId);
  }

  async observe(systemId: string): Promise<PageObservation> {
    const session = this.getOrCreateSession(systemId);
    return this.toObservation(session.page, systemId, session.sessionId, session.parentSessionId);
  }

  async fillForm(systemId: string, values: Record<string, unknown>): Promise<FillResult> {
    const session = this.getOrCreateSession(systemId);
    const updatedElements = session.page.interactiveElements.map((element) => {
      if (element.type !== "input" && element.type !== "select") {
        return element;
      }
      const nextValue = values[element.key];
      if (nextValue === undefined) {
        return element;
      }
      return {
        ...element,
        value: this.stringifyValue(nextValue)
      };
    });

    session.page = {
      ...session.page,
      interactiveElements: updatedElements,
      summary: `${session.page.title} draft updated with ${Object.keys(values).length} fields.`
    };
    this.sessions.set(systemId, session);

    return {
      draftId: `WEBDRAFT-${crypto.randomUUID()}`,
      filledFields: values,
      observation: this.toObservation(session.page, systemId, session.sessionId, session.parentSessionId)
    };
  }

  async clickElement(systemId: string, targetKey: string, _sessionId?: string, targetHandle?: string): Promise<ClickResult> {
    const session = this.getOrCreateSession(systemId);
    const target = session.page.interactiveElements.find(
      (element) =>
        (element.type === "button" || element.type === "link") &&
        (String(element.handle ?? "") === String(targetHandle ?? "") || element.key === targetKey)
    );
    if (!target) {
      throw new Error(`No clickable element found for key ${targetKey}`);
    }

    session.page = this.advanceGenericPage(session.page, targetKey);
    this.pushHistory(session, session.page);
    this.sessions.set(systemId, session);

    return {
      clickId: `WEBCLICK-${crypto.randomUUID()}`,
      targetKey,
      targetHandle,
      target: {
        handle: target.handle,
        key: target.key,
        label: target.label,
        domPath: target.domPath,
        nearbyText: target.nearbyText
      },
      observation: this.toObservation(session.page, systemId, session.sessionId, session.parentSessionId)
    };
  }

  async scrollPage(systemId: string): Promise<ScrollResult> {
    const session = this.getOrCreateSession(systemId);
    return {
      scrollId: `WEBSCROLL-${crypto.randomUUID()}`,
      observation: this.toObservation(session.page, systemId, session.sessionId, session.parentSessionId)
    };
  }

  async navigateHistory(systemId: string, direction: "back" | "forward"): Promise<HistoryNavigationResult> {
    const session = this.getOrCreateSession(systemId);
    if (direction === "back" && session.historyIndex > 0) {
      session.historyIndex -= 1;
      session.page = session.history[session.historyIndex];
    } else if (direction === "forward" && session.historyIndex < session.history.length - 1) {
      session.historyIndex += 1;
      session.page = session.history[session.historyIndex];
    }
    this.sessions.set(systemId, session);
    return {
      navigationId: `WEBNAV-${crypto.randomUUID()}`,
      direction,
      observation: this.toObservation(session.page, systemId, session.sessionId, session.parentSessionId)
    };
  }

  async previewSubmission(systemId: string): Promise<PreviewResult> {
    const session = this.getOrCreateSession(systemId);
    return {
      previewId: `PREVIEW-${crypto.randomUUID()}`,
      observation: this.toObservation(session.page, systemId, session.sessionId, session.parentSessionId)
    };
  }

  async submit(systemId: string, expectedButton: string): Promise<SubmitResult> {
    const session = this.getOrCreateSession(systemId);
    if (session.page.finalActionButton !== expectedButton) {
      throw new Error(
        `Expected final action button ${expectedButton} but found ${session.page.finalActionButton ?? "none"}`
      );
    }

    const missingRequired = session.page.interactiveElements.filter(
      (element) => element.required && (element.value === undefined || element.value === "")
    );
    if (missingRequired.length > 0) {
      throw new Error(`Missing required fields: ${missingRequired.map((field) => field.key).join(", ")}`);
    }

    session.page = this.advanceGenericPage(session.page, expectedButton, true);
    this.pushHistory(session, session.page);
    this.sessions.set(systemId, session);

    return {
      recordId: `REC-${crypto.randomUUID()}`,
      observation: this.toObservation(session.page, systemId, session.sessionId, session.parentSessionId)
    };
  }

  async followNavigation(systemId: string): Promise<PageObservation> {
    const session = this.getOrCreateSession(systemId);
    return this.toObservation(session.page, systemId, session.sessionId, session.parentSessionId);
  }

  private getSession(systemId: string): SessionState {
    const session = this.sessions.get(systemId);
    if (!session) {
      throw new Error(`No DOM harness session for system ${systemId}`);
    }
    return session;
  }

  private getOrCreateSession(systemId: string): SessionState {
    const existing = this.sessions.get(systemId);
    if (existing) {
      return existing;
    }
    const page = this.buildDefaultPage(systemId);
    const created: SessionState = {
      sessionId: `page-agent-${crypto.randomUUID()}`,
      systemId,
      page,
      history: [page],
      historyIndex: 0
    };
    this.sessions.set(systemId, created);
    return created;
  }

  private pushHistory(session: SessionState, nextPage: HarnessPageDefinition): void {
    const truncated = session.history.slice(0, session.historyIndex + 1);
    truncated.push(nextPage);
    session.history = truncated.slice(-10);
    session.historyIndex = session.history.length - 1;
  }

  private toObservation(
    page: HarnessPageDefinition,
    systemId: string,
    sessionId?: string,
    parentSessionId?: string
  ): PageObservation {
    const pageText = this.buildPageText(page);
    const visibleTextBlocks = splitVisibleTextBlocks(pageText);
    const interactiveElements = page.interactiveElements.map((element) => ({
      ...element,
      region: element.region ?? "main",
      importance:
        typeof element.importance === "number"
          ? element.importance
          : element.type === "input" || element.type === "select"
            ? 0.86
            : element.type === "button"
              ? 0.82
              : 0.74,
      semanticRole:
        element.semanticRole ??
        (element.type === "input" || element.type === "select"
          ? /검색|search/i.test(element.label)
            ? "search_input"
            : "form_field"
          : element.type === "button"
            ? /검색|조회|submit|등록|open|next/i.test(element.label)
              ? "primary_action"
              : "secondary_action"
            : element.type === "link"
              ? "result_link"
              : "unknown")
    }));
    return {
      sessionId,
      parentSessionId,
      systemId,
      pageId: page.pageId,
      url: page.url,
      title: page.title,
      summary: page.summary,
      pageText,
      domOutline: buildHarnessDomOutline(page, visibleTextBlocks),
      visibleTextBlocks,
      semanticBlocks: buildHarnessSemanticBlocks(page, visibleTextBlocks),
      interactiveElements,
      finalActionButton: page.finalActionButton
    };
  }

  private buildDefaultPage(systemId: string, pageId?: string, selection?: WebOpenSelection): HarnessPageDefinition {
    if (systemId === "web_generic") {
      return this.buildGenericWebPage(selection, pageId);
    }
    return buildHarnessPage(systemId, pageId);
  }

  private stringifyValue(value: unknown): string {
    if (typeof value === "string") {
      return value;
    }
    return JSON.stringify(value);
  }

  private buildPageText(page: HarnessPageDefinition): string {
    const query = typeof page.meta?.query === "string" ? page.meta.query : "";
    const pageType = typeof page.meta?.pageType === "string" ? page.meta.pageType : "";
    if (pageType === "search_home") {
      return `${page.title}. 검색 또는 search 입력창이 보인다. 현재 입력값: ${query || "없음"}.`;
    }
    if (pageType === "search_results") {
      return `${page.title}. ${page.summary} ${page.interactiveElements
        .filter((element) => element.type === "link")
        .map((element) => element.label)
        .join(" | ")}`;
    }
    if (pageType === "news_article" || pageType === "product_page" || pageType === "detail_page") {
      return `${page.title}. ${page.summary}`;
    }
    return page.interactiveElements
      .map((element) => `${element.label}${element.value ? `: ${element.value}` : ""}`)
      .join(" | ");
  }

  private buildGenericWebPage(selection?: WebOpenSelection, pageId?: string): HarnessPageDefinition {
    const targetUrl = selection?.targetUrl ?? "https://example.com";
    const host = safeHost(targetUrl);
    if (/\/products?\//i.test(targetUrl) || /item\/main/i.test(targetUrl)) {
      return buildGenericDetailPage(targetUrl, "하이닉스 가격", "SK hynix 현재 가격 정보", targetUrl);
    }
    if (/\/news/i.test(targetUrl) || /article/i.test(targetUrl)) {
      return buildGenericDetailPage(targetUrl, "SK hynix 뉴스", "SK hynix 관련 상세 기사", targetUrl);
    }
    const title = host.includes("google") ? "Google" : host.includes("naver") ? "네이버" : "Generic Search";
    return {
      pageId: pageId ?? "generic_search_home",
      title,
      url: targetUrl,
      summary: "검색을 시작할 수 있는 페이지가 열려 있다.",
      finalActionButton: "submit_action",
      interactiveElements: [
        {
          index: 0,
          handle: "1",
          type: "input",
          key: "query",
          label: "검색어",
          value: "",
          required: true,
          action: "type",
          region: "main"
        },
        {
          index: 1,
          handle: "2",
          type: "button",
          key: "search_action",
          label: "검색",
          action: "click",
          region: "main"
        }
      ],
      meta: {
        pageType: "search_home",
        host,
        query: ""
      }
    };
  }

  private advanceGenericPage(page: HarnessPageDefinition, targetKey: string, isSubmit = false): HarnessPageDefinition {
    const pageType = typeof page.meta?.pageType === "string" ? page.meta.pageType : "";
    const query = page.interactiveElements.find((element) => element.key === "query")?.value ?? String(page.meta?.query ?? "");

    if ((pageType === "search_home" || pageType === "search_results") && (targetKey === "search_action" || targetKey === "submit_action" || isSubmit)) {
      return buildGenericSearchResultsPage(page.url, query);
    }

    if (pageType === "search_results") {
      const clicked = page.interactiveElements.find((element) => element.key === targetKey);
      if (clicked?.type === "link") {
        return buildGenericDetailPage(page.url, query, clicked.label, clicked.href);
      }
    }

    return {
      ...page,
      summary: `${page.title}에서 ${targetKey} 동작을 수행했다.`
    };
  }
}

function splitVisibleTextBlocks(pageText: string): string[] {
  return pageText
    .split(/\s+\|\s+|(?<=[.!?])\s+/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function buildHarnessSemanticBlocks(page: HarnessPageDefinition, visibleTextBlocks: string[]): SemanticBlock[] {
  const blocks: SemanticBlock[] = visibleTextBlocks.map((text, index) => ({
    id: `harness-text-${index + 1}`,
    type: index === 0 ? "heading" : index < 3 ? "summary" : "paragraph",
    text,
    title: index === 0 ? page.title : undefined,
    region: "main" as const,
    importance: Math.max(0.45, 0.95 - index * 0.08),
    relatedKeys: []
  }));

  const controlBlocks: SemanticBlock[] = page.interactiveElements.slice(0, 6).map((element, index) => ({
    id: `harness-control-${index + 1}`,
    type: element.type === "link" ? "result_item" : "form_area",
    text: `${element.label}${element.value ? `: ${element.value}` : ""}`,
    title: element.label,
    region: element.region ?? "main",
    importance: typeof element.importance === "number" ? element.importance : element.type === "input" ? 0.86 : 0.78,
    relatedKeys: [element.key]
  }));

  return [...blocks, ...controlBlocks].slice(0, 12);
}

function buildHarnessDomOutline(page: HarnessPageDefinition, visibleTextBlocks: string[]): string {
  const lines: string[] = [];

  for (const text of visibleTextBlocks.slice(0, 6)) {
    lines.push(text);
  }

  for (const element of page.interactiveElements.slice(0, 12)) {
    const attrs = [`key=${element.key}`, `type=${element.type}`];
    if (element.semanticRole) {
      attrs.push(`role=${element.semanticRole}`);
    }
    lines.push(`[${element.handle ?? element.key}]<${element.type} ${attrs.join(" ")}>${element.label || element.key} />`);
    if (element.value) {
      lines.push(`  value: ${element.value}`);
    }
  }

  return lines.join("\n").slice(0, 4000);
}

function buildGenericSearchResultsPage(baseUrl: string, query: string): HarnessPageDefinition {
  const normalizedQuery = String(query || "").trim();
  const isNews = /뉴스|news/i.test(normalizedQuery);
  const isPrice = /가격|price|주가|시세/i.test(normalizedQuery);
  const resultLinks = isNews
    ? [
        "SK hynix 관련 최신 뉴스 헤드라인",
        "반도체 업계 주요 뉴스 요약",
        "시장 반응과 증권사 코멘트"
      ]
    : isPrice
      ? [
          "SK hynix 현재 주가와 시세 정보",
          "상품 가격 비교 및 판매처",
          "관련 시장 데이터 상세 보기"
        ]
      : [
          `${normalizedQuery} 관련 대표 검색 결과`,
          `${normalizedQuery} 상세 설명 페이지`,
          `${normalizedQuery} 참고 자료`
        ];

  return {
    pageId: "generic_search_results",
    title: "Search Results",
    url: `${baseUrl.replace(/\/$/, "")}/search?q=${encodeURIComponent(normalizedQuery)}`,
    summary: `${normalizedQuery}에 대한 검색 결과가 표시되었다.`,
    interactiveElements: [
      {
        index: 0,
        handle: "1",
        type: "input",
        key: "query",
        label: "검색어",
        value: normalizedQuery,
        required: true,
        action: "type",
        region: "main"
      },
      {
        index: 1,
        handle: "2",
        type: "button",
        key: "search_action",
        label: "검색",
        action: "click",
        region: "main"
      },
      ...resultLinks.map((label, index) => ({
        index: index + 2,
        handle: String(index + 3),
        type: "link" as const,
        key: `result_${index + 1}`,
        label,
        action: "click" as const,
        href: `https://example.com/result/${index + 1}`,
        region: "main" as const
      }))
    ],
    meta: {
      pageType: "search_results",
      query: normalizedQuery,
      intent: isNews ? "news" : isPrice ? "price" : "generic"
    }
  };
}

function buildGenericDetailPage(baseUrl: string, query: string, label: string, href?: string): HarnessPageDefinition {
  const normalizedQuery = String(query || "").trim();
  const isNews = /뉴스|news/i.test(normalizedQuery) || /뉴스|headline|article/i.test(label);
  const isPrice = /가격|price|주가|시세/i.test(normalizedQuery) || /price|주가|시세/i.test(label);
  const title = isNews ? "News Article" : isPrice ? "Product / Quote Detail" : "Detail Page";
  const summary = isNews
    ? `${label}. 핵심 내용: SK hynix 관련 최신 동향과 시장 반응을 설명한다.`
    : isPrice
      ? `${label}. 현재 표시 가격은 210,000 KRW 이다. 추가 설명과 비교 정보가 보인다.`
      : `${label}. 상세 설명과 관련 정보가 보인다.`;

  return {
    pageId: isNews ? "generic_news_article" : isPrice ? "generic_product_page" : "generic_detail_page",
    title,
    url: href ?? `${baseUrl.replace(/\/$/, "")}/detail`,
    summary,
    interactiveElements: [
      {
        index: 0,
        handle: "1",
        type: "link",
        key: "back_to_results",
        label: "검색 결과로 돌아가기",
        action: "click",
        href: `${baseUrl.replace(/\/$/, "")}/search`,
        region: "main"
      }
    ],
    meta: {
      pageType: isNews ? "news_article" : isPrice ? "product_page" : "detail_page",
      query: normalizedQuery,
      detailLabel: label
    }
  };
}

function safeHost(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return "example.com";
  }
}
