import { type ToolExecutor, type ToolRequest, type ToolResult } from "../../../packages/contracts/src/index.js";
import { ExtensionBridgeAdapter } from "./extension-bridge-adapter.js";
import { PageAgentDomAdapter } from "./page-agent-dom-adapter.js";
import type { WebAdapter } from "./types.js";

export interface WebWorkerOptions {
  adapter?: WebAdapter;
  adapterKind?: "page_agent_dom" | "extension_bridge";
}

export class WebWorker implements ToolExecutor {
  private readonly adapter: WebAdapter;

  constructor(options: WebWorkerOptions = {}) {
    this.adapter =
      options.adapter ??
      (options.adapterKind === "extension_bridge" || process.env.WEB_WORKER_ADAPTER === "extension_bridge"
        ? new ExtensionBridgeAdapter()
        : new PageAgentDomAdapter());
  }

  async execute(request: ToolRequest): Promise<ToolResult> {
    switch (request.tool_name) {
      case "open_system":
        return this.openSystem(request);
      case "fill_web_form":
        return this.fillWebForm(request);
      case "click_web_element":
        return this.clickWebElement(request);
      case "scroll_web_page":
        return this.scrollWebPage(request);
      case "follow_web_navigation":
        return this.followWebNavigation(request);
      case "preview_web_submission":
        return this.previewSubmission(request);
      case "submit_web_form":
        return this.submitForm(request);
      case "extract_web_result":
        return this.extractWebResult(request);
      default:
        return this.fail(request, `Unsupported web tool: ${request.tool_name}`);
    }
  }

  private async openSystem(request: ToolRequest): Promise<ToolResult> {
    const systemId = String(request.input.system_id ?? "unknown");
    const pageId = typeof request.input.page_id === "string" ? request.input.page_id : undefined;
    const sessionId = typeof request.input.session_id === "string" ? request.input.session_id : undefined;
    const targetUrl = typeof request.input.target_url === "string" ? request.input.target_url : undefined;
    const urlContains = typeof request.input.url_contains === "string" ? request.input.url_contains : undefined;
    const titleContains = typeof request.input.title_contains === "string" ? request.input.title_contains : undefined;
    const openIfMissing = request.input.open_if_missing === true;
    const observation = await this.adapter.openSystem(systemId, pageId, {
      sessionId,
      targetUrl,
      urlContains,
      titleContains,
      openIfMissing
    });
    return {
      request_id: request.request_id,
      success: true,
      output: {
        opened: true,
        system_id: systemId,
        session_id: observation.sessionId,
        harness: this.adapter.harnessName,
        observation
      },
      memory_patch: {},
      emitted_events: []
    };
  }

  private async fillWebForm(request: ToolRequest): Promise<ToolResult> {
    const systemId = String(request.input.system_id ?? "unknown");
    const sessionId = typeof request.input.session_id === "string" ? request.input.session_id : undefined;
    const fields =
      typeof request.input.field_values === "object" && request.input.field_values !== null
        ? (request.input.field_values as Record<string, unknown>)
        : {};
    const result = await this.adapter.fillForm(systemId, fields, sessionId);

    return {
      request_id: request.request_id,
      success: true,
      output: {
        artifact_kind: "web_draft",
        draft_id: result.draftId,
        system_id: systemId,
        session_id: result.observation.sessionId,
        harness: this.adapter.harnessName,
        filled_fields: result.filledFields,
        observation: result.observation
      },
      memory_patch: {},
      emitted_events: []
    };
  }

  private async clickWebElement(request: ToolRequest): Promise<ToolResult> {
    const systemId = String(request.input.system_id ?? "unknown");
    const sessionId = typeof request.input.session_id === "string" ? request.input.session_id : undefined;
    const targetKey = String(request.input.target_key ?? request.input.expected_button ?? "").trim();
    const result = await this.adapter.clickElement(systemId, targetKey, sessionId);

    return {
      request_id: request.request_id,
      success: true,
      output: {
        artifact_kind: "web_click",
        click_id: result.clickId,
        system_id: systemId,
        session_id: result.observation.sessionId,
        target_key: targetKey,
        harness: this.adapter.harnessName,
        observation: result.observation
      },
      memory_patch: {},
      emitted_events: []
    };
  }

  private async scrollWebPage(request: ToolRequest): Promise<ToolResult> {
    const systemId = String(request.input.system_id ?? "unknown");
    const sessionId = typeof request.input.session_id === "string" ? request.input.session_id : undefined;
    const direction = request.input.direction === "up" ? "up" : "down";
    const amount = typeof request.input.amount === "number" ? request.input.amount : 0.75;
    if (!this.adapter.scrollPage) {
      throw new Error(`${this.adapter.harnessName} does not support scroll_web_page`);
    }
    const result = await this.adapter.scrollPage(systemId, direction, amount, sessionId);
    return {
      request_id: request.request_id,
      success: true,
      output: {
        artifact_kind: "web_scroll",
        scroll_id: result.scrollId,
        system_id: systemId,
        session_id: result.observation.sessionId,
        harness: this.adapter.harnessName,
        direction,
        amount,
        observation: result.observation
      },
      memory_patch: {},
      emitted_events: []
    };
  }

  private async followWebNavigation(request: ToolRequest): Promise<ToolResult> {
    const systemId = String(request.input.system_id ?? "unknown");
    const sessionId = typeof request.input.session_id === "string" ? request.input.session_id : undefined;
    if (!this.adapter.followNavigation) {
      throw new Error(`${this.adapter.harnessName} does not support follow_web_navigation`);
    }
    const observation = await this.adapter.followNavigation(systemId, sessionId);
    return {
      request_id: request.request_id,
      success: true,
      output: {
        artifact_kind: "web_follow",
        follow_id: `FOLLOW-${crypto.randomUUID()}`,
        system_id: observation.systemId,
        session_id: observation.sessionId,
        harness: this.adapter.harnessName,
        observation
      },
      memory_patch: {},
      emitted_events: []
    };
  }

  private async previewSubmission(request: ToolRequest): Promise<ToolResult> {
    const systemId = String(request.input.system_id ?? "unknown");
    const sessionId = typeof request.input.session_id === "string" ? request.input.session_id : undefined;
    const result = await this.adapter.previewSubmission(systemId, sessionId);
    return {
      request_id: request.request_id,
      success: true,
      output: {
        artifact_kind: "web_preview",
        preview_id: result.previewId,
        system_id: systemId,
        session_id: result.observation.sessionId,
        harness: this.adapter.harnessName,
        observation: result.observation
      },
      memory_patch: {},
      emitted_events: []
    };
  }

  private async submitForm(request: ToolRequest): Promise<ToolResult> {
    const systemId = String(request.input.system_id ?? "unknown");
    const sessionId = typeof request.input.session_id === "string" ? request.input.session_id : undefined;
    const expectedButton = String(request.input.expected_button ?? "Submit");
    const result = await this.adapter.submit(systemId, expectedButton, sessionId);
    return {
      request_id: request.request_id,
      success: true,
      output: {
        artifact_kind: "web_submission",
        record_id: result.recordId,
        system_id: systemId,
        session_id: result.observation.sessionId,
        expected_button: expectedButton,
        harness: this.adapter.harnessName,
        observation: result.observation
      },
      memory_patch: {},
      emitted_events: []
    };
  }

  private async extractWebResult(request: ToolRequest): Promise<ToolResult> {
    const systemId = String(request.input.system_id ?? "unknown");
    const sessionId = typeof request.input.session_id === "string" ? request.input.session_id : undefined;
    const goal = String(request.input.goal ?? request.input.instruction ?? "").trim();
    const query = String(request.input.query ?? "").trim();
    const observation = await this.adapter.observe(systemId, sessionId);
    const pageText = [observation.title, observation.summary, observation.pageText ?? ""].join("\n").trim();
    const matchTerms = buildMatchTerms(goal, query);
    const matchedSnippets = collectMatchedSnippets(pageText, matchTerms);
    const extractedResult = parseGenericResult(goal, query, observation);
    const detailRequired = requiresDetailVisit(goal);
    const resultListPage = looksLikeResultListPage(observation);
    const goalSatisfied =
      Boolean(extractedResult) &&
      (!detailRequired || !resultListPage || (extractedResult && extractedResult.kind === "price"));
    const summary =
      extractedResult
        ? extractedResult.summary
        : matchedSnippets[0] ??
      (goalSatisfied
        ? `${observation.title} result appears to satisfy the goal.`
        : `${observation.title} result was observed but goal could not be confirmed.`);

    return {
      request_id: request.request_id,
      success: true,
      output: {
        artifact_kind: "web_result_extraction",
        extraction_id: `EXTRACT-${crypto.randomUUID()}`,
        system_id: systemId,
        harness: this.adapter.harnessName,
        goal,
        query,
        goal_satisfied: goalSatisfied,
        matched_snippets: matchedSnippets,
        stock_result: extractedResult?.kind === "price" ? extractedResult.value : undefined,
        extracted_result: extractedResult ?? null,
        summary,
        observation
      },
      memory_patch: {},
      emitted_events: []
    };
  }

  private fail(request: ToolRequest, error: string): ToolResult {
    return {
      request_id: request.request_id,
      success: false,
      output: { error },
      memory_patch: {},
      emitted_events: []
    };
  }
}

function buildMatchTerms(goal: string, query: string): string[] {
  return Array.from(
    new Set(
      [goal, query]
        .flatMap((value) => value.split(/[\s,]+/))
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value.length >= 2)
    )
  );
}

function collectMatchedSnippets(pageText: string, terms: string[]): string[] {
  const normalizedText = pageText.replace(/\s+/g, " ").trim();
  if (normalizedText.length === 0) {
    return [];
  }

  const segments = normalizedText.split(/(?<=[.!?])\s+|\s\|\s+/).map((segment) => segment.trim()).filter(Boolean);
  const matched = segments.filter((segment) => {
    const normalizedSegment = segment.toLowerCase();
    return terms.some((term) => normalizedSegment.includes(term));
  });

  return matched.slice(0, 5);
}

function parseGenericResult(
  goal: string,
  query: string,
  observation: { title: string; pageText?: string; visibleTextBlocks?: string[]; interactiveElements: Array<{ type: string; label: string }> }
):
  | { kind: "price"; summary: string; value: { company: string; price: string; currency: string } }
  | { kind: "headline"; summary: string; value: { headline: string } }
  | { kind: "summary"; summary: string; value: { lines: string[] } }
  | undefined {
  const pageText = [observation.title, observation.pageText ?? ""].join("\n").trim();
  const quoteLikeResult = parseQuoteLikeResult(goal, query, pageText);
  if (quoteLikeResult) {
    return {
      kind: "price",
      summary: `${quoteLikeResult.company} ${quoteLikeResult.price} ${quoteLikeResult.currency}`,
      value: quoteLikeResult
    };
  }

  const headline = parseHeadlineLikeResult(goal, observation);
  if (headline) {
    return {
      kind: "headline",
      summary: headline,
      value: { headline }
    };
  }

  const lines = summarizeVisibleBlocks(observation.visibleTextBlocks ?? []);
  if (lines.length > 0 && /요약|summary|설명|무엇을 할 수|핵심 내용|정리/i.test(goal)) {
    return {
      kind: "summary",
      summary: lines.join(" / "),
      value: { lines }
    };
  }

  return undefined;
}

function requiresDetailVisit(goal: string): boolean {
  return /열어서|들어가|접속|본문|상세|자세히|핵심 내용|원문/i.test(goal);
}

function looksLikeResultListPage(observation: { pageId?: string; title: string; interactiveElements: Array<{ type: string }> }): boolean {
  const pageId = typeof observation.pageId === "string" ? observation.pageId : "";
  const linkCount = observation.interactiveElements.filter((element) => element.type === "link").length;
  return /result/i.test(pageId) || /search results/i.test(observation.title.toLowerCase()) || linkCount >= 2;
}

function parseQuoteLikeResult(goal: string, query: string, pageText: string): { company: string; price: string; currency: string } | undefined {
  const company = inferQuoteSubject(goal, query, pageText);
  const priceMatch = pageText.match(/([0-9]{1,3}(?:,[0-9]{3})+)\s*(KRW|원|USD|EUR|\$)/i);
  if (!company || !priceMatch) {
    return undefined;
  }

  const currencyToken = priceMatch[2];
  const currency =
    /\$/.test(currencyToken) ? "USD" : /eur/i.test(currencyToken) ? "EUR" : /usd/i.test(currencyToken) ? "USD" : "KRW";

  return {
    company,
    price: priceMatch[1],
    currency
  };
}

function parseHeadlineLikeResult(
  goal: string,
  observation: { visibleTextBlocks?: string[]; interactiveElements: Array<{ type: string; label: string }> }
): string | undefined {
  if (!/뉴스|headline|기사|article|title/i.test(goal)) {
    return undefined;
  }

  const visibleHeadline = (observation.visibleTextBlocks ?? []).find((line) => {
    const normalized = line.trim();
    return normalized.length >= 8 && !/돌아가기|back|^news article\.?$|^product \/ quote detail\.?$/i.test(normalized);
  });
  if (visibleHeadline) {
    return visibleHeadline;
  }

  const linkHeadline = observation.interactiveElements
    .filter((element) => element.type === "link")
    .map((element) => element.label.trim())
    .find((label) => label.length >= 8 && !/돌아가기|back/i.test(label));
  if (linkHeadline) {
    return linkHeadline;
  }

  return undefined;
}

function summarizeVisibleBlocks(blocks: string[]): string[] {
  return blocks
    .map((block) => block.trim())
    .filter((block) => block.length >= 6)
    .slice(0, 3);
}

function inferQuoteSubject(goal: string, query: string, pageText: string): string | undefined {
  const explicitSubject = pageText.match(/([가-힣A-Za-z][가-힣A-Za-z0-9&.\-\s]{1,40})\s+(?:현재\s+)?(?:주가|시세|가격)/);
  if (explicitSubject) {
    return explicitSubject[1].trim();
  }

  const titleSubject = pageText.match(/(?:-|:)\s*([A-Z][A-Za-z0-9&.\-]+(?:\s+[A-Za-z0-9&.\-]+){0,3})/);
  if (titleSubject && !/^(Naver|Finance|Search)$/i.test(titleSubject[1])) {
    return titleSubject[1].trim();
  }

  const candidates = [query, goal]
    .filter((value) => value.trim().length > 0)
    .map((value) =>
      value
        .replace(/https?:\/\/[^\s"'<>]+/gi, " ")
        .replace(/현재|지금|검색|알려줘|조회|가격|주가|시세|stock|price/gi, " ")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter((value) => value.length >= 2);

  for (const candidate of candidates) {
    if (pageText.toLowerCase().includes(candidate.toLowerCase())) {
      return candidate;
    }
  }

  const capitalizedCompany = pageText.match(/\b([A-Z][A-Za-z0-9&.\-]+(?:\s+[A-Za-z0-9&.\-]+){1,3})\b/);
  if (capitalizedCompany) {
    return capitalizedCompany[1];
  }

  const koreanCompany = pageText.match(/([가-힣A-Za-z0-9]+)\s*(주가|시세|가격)/);
  if (koreanCompany) {
    return koreanCompany[1];
  }

  return undefined;
}
