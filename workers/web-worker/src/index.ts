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
      case "read_web_page":
        return this.readWebPage(request);
      case "fill_web_form":
        return this.fillWebForm(request);
      case "click_web_element":
        return this.clickWebElement(request);
      case "scroll_web_page":
        return this.scrollWebPage(request);
      case "navigate_browser_history":
        return this.navigateBrowserHistory(request);
      case "follow_web_navigation":
        return this.followWebNavigation(request);
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

  private async readWebPage(request: ToolRequest): Promise<ToolResult> {
    const systemId = String(request.input.system_id ?? "unknown");
    const sessionId = typeof request.input.session_id === "string" ? request.input.session_id : undefined;
    const observation = await this.adapter.observe(systemId, sessionId);
    return {
      request_id: request.request_id,
      success: true,
      output: {
        artifact_kind: "web_read",
        read_id: `READ-${crypto.randomUUID()}`,
        system_id: systemId,
        session_id: observation.sessionId,
        harness: this.adapter.harnessName,
        summary: observation.summary,
        title: observation.title,
        url: observation.url,
        dom_outline: observation.domOutline,
        visible_text_blocks: observation.visibleTextBlocks ?? [],
        semantic_blocks: observation.semanticBlocks ?? [],
        interactive_elements: observation.interactiveElements,
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
    const targetHandle = typeof request.input.target_handle === "string" ? request.input.target_handle : undefined;
    const result = await this.adapter.clickElement(systemId, targetKey, sessionId, targetHandle);

    return {
      request_id: request.request_id,
      success: true,
      output: {
        artifact_kind: "web_click",
        click_id: result.clickId,
        system_id: systemId,
        session_id: result.observation.sessionId,
        target_key: targetKey,
        target_handle: targetHandle,
        target: result.target,
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

  private async navigateBrowserHistory(request: ToolRequest): Promise<ToolResult> {
    const systemId = String(request.input.system_id ?? "unknown");
    const sessionId = typeof request.input.session_id === "string" ? request.input.session_id : undefined;
    const direction = request.input.direction === "forward" ? "forward" : "back";
    if (!this.adapter.navigateHistory) {
      throw new Error(`${this.adapter.harnessName} does not support navigate_browser_history`);
    }
    const result = await this.adapter.navigateHistory(systemId, direction, sessionId);
    return {
      request_id: request.request_id,
      success: true,
      output: {
        artifact_kind: "web_history_navigation",
        navigation_id: result.navigationId,
        direction,
        system_id: systemId,
        session_id: result.observation.sessionId,
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
