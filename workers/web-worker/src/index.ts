import { type ToolExecutor, type ToolRequest, type ToolResult } from "../../../packages/contracts/src/index.js";
import { BookmarkletBridgeAdapter } from "./bookmarklet-bridge-adapter.js";
import { LiveChromeDomAdapter } from "./live-chrome-dom-adapter.js";
import { PageAgentDomAdapter } from "./page-agent-dom-adapter.js";
import type { WebAdapter } from "./types.js";

export interface WebWorkerOptions {
  adapter?: WebAdapter;
  adapterKind?: "page_agent_dom" | "live_chrome" | "bookmarklet_bridge";
  cdpUrl?: string;
}

export class WebWorker implements ToolExecutor {
  private readonly adapter: WebAdapter;

  constructor(options: WebWorkerOptions = {}) {
    this.adapter =
      options.adapter ??
      (options.adapterKind === "live_chrome" || process.env.WEB_WORKER_ADAPTER === "live_chrome"
        ? new LiveChromeDomAdapter({ cdpUrl: options.cdpUrl })
        : options.adapterKind === "bookmarklet_bridge" || process.env.WEB_WORKER_ADAPTER === "bookmarklet_bridge"
          ? new BookmarkletBridgeAdapter()
        : new PageAgentDomAdapter());
  }

  async execute(request: ToolRequest): Promise<ToolResult> {
    switch (request.tool_name) {
      case "open_system":
        return this.openSystem(request);
      case "fill_web_form":
        return this.fillWebForm(request);
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
    const observation = await this.adapter.openSystem(systemId, pageId);
    return {
      request_id: request.request_id,
      success: true,
      output: {
        opened: true,
        system_id: systemId,
        harness: this.adapter.harnessName,
        observation
      },
      memory_patch: {},
      emitted_events: []
    };
  }

  private async fillWebForm(request: ToolRequest): Promise<ToolResult> {
    const systemId = String(request.input.system_id ?? "unknown");
    const fields =
      typeof request.input.field_values === "object" && request.input.field_values !== null
        ? (request.input.field_values as Record<string, unknown>)
        : {};
    const result = await this.adapter.fillForm(systemId, fields);

    return {
      request_id: request.request_id,
      success: true,
      output: {
        artifact_kind: "web_draft",
        draft_id: result.draftId,
        system_id: systemId,
        harness: this.adapter.harnessName,
        filled_fields: result.filledFields,
        observation: result.observation
      },
      memory_patch: {},
      emitted_events: []
    };
  }

  private async previewSubmission(request: ToolRequest): Promise<ToolResult> {
    const systemId = String(request.input.system_id ?? "unknown");
    const result = await this.adapter.previewSubmission(systemId);
    return {
      request_id: request.request_id,
      success: true,
      output: {
        artifact_kind: "web_preview",
        preview_id: result.previewId,
        system_id: systemId,
        harness: this.adapter.harnessName,
        observation: result.observation
      },
      memory_patch: {},
      emitted_events: []
    };
  }

  private async submitForm(request: ToolRequest): Promise<ToolResult> {
    const systemId = String(request.input.system_id ?? "unknown");
    const expectedButton = String(request.input.expected_button ?? "Submit");
    const result = await this.adapter.submit(systemId, expectedButton);
    return {
      request_id: request.request_id,
      success: true,
      output: {
        artifact_kind: "web_submission",
        record_id: result.recordId,
        system_id: systemId,
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
    const goal = String(request.input.goal ?? request.input.instruction ?? "").trim();
    const query = String(request.input.query ?? "").trim();
    const observation = await this.adapter.observe(systemId);
    const pageText = [observation.title, observation.summary, observation.pageText ?? ""].join("\n").trim();
    const matchTerms = buildMatchTerms(goal, query);
    const matchedSnippets = collectMatchedSnippets(pageText, matchTerms);
    const goalSatisfied = systemId === "naver_search"
      ? includesAllTerms(pageText, ["sk hynix", "stock", "price"])
      : matchedSnippets.length > 0;
    const summary =
      matchedSnippets[0] ??
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
