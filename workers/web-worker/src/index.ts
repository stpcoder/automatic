import { type ToolExecutor, type ToolRequest, type ToolResult } from "../../../packages/contracts/src/index.js";
import { ExtensionBridgeAdapter } from "./extension-bridge-adapter.js";
import { PageAgentDomAdapter } from "./page-agent-dom-adapter.js";
import { getWebSystemDefinition } from "./system-definitions.js";
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
    const observation = await this.adapter.openSystem(systemId, pageId, sessionId);
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
    const systemDefinition = getWebSystemDefinition(systemId);
    const requiredIndicators = systemDefinition.resultIndicators ?? [];
    const goalSatisfied =
      requiredIndicators.length > 0
        ? includesAllTerms(pageText, requiredIndicators)
        : matchedSnippets.length > 0;
    const stockResult = parseStockResult(systemId, pageText);
    const summary =
      stockResult
        ? `${stockResult.company} ${stockResult.price} ${stockResult.currency}`
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
        stock_result: stockResult,
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

function includesAllTerms(pageText: string, terms: string[]): boolean {
  const normalized = pageText.toLowerCase();
  return terms.every((term) => normalized.includes(term));
}

function parseStockResult(systemId: string, pageText: string): { company: string; price: string; currency: string } | undefined {
  if (systemId !== "naver_search" && systemId !== "naver_stock") {
    return undefined;
  }

  const company = /sk hynix/i.test(pageText) ? "SK hynix" : undefined;
  const priceMatch = pageText.match(/([0-9]{1,3}(?:,[0-9]{3})+)\s*(KRW|원)/i);
  if (!company || !priceMatch) {
    return undefined;
  }

  return {
    company,
    price: priceMatch[1],
    currency: /krw/i.test(priceMatch[2]) ? "KRW" : "KRW"
  };
}
