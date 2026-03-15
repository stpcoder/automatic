import { type ToolExecutor, type ToolRequest, type ToolResult } from "../../../packages/contracts/src/index.js";
import { LiveChromeDomAdapter } from "./live-chrome-dom-adapter.js";
import { PageAgentDomAdapter } from "./page-agent-dom-adapter.js";
import type { WebAdapter } from "./types.js";

export interface WebWorkerOptions {
  adapter?: WebAdapter;
  adapterKind?: "page_agent_dom" | "live_chrome";
  cdpUrl?: string;
}

export class WebWorker implements ToolExecutor {
  private readonly adapter: WebAdapter;

  constructor(options: WebWorkerOptions = {}) {
    this.adapter =
      options.adapter ??
      (options.adapterKind === "live_chrome" || process.env.WEB_WORKER_ADAPTER === "live_chrome"
        ? new LiveChromeDomAdapter({ cdpUrl: options.cdpUrl })
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
