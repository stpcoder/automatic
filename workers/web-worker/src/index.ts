import { type ToolExecutor, type ToolRequest, type ToolResult } from "../../../packages/contracts/src/index.js";

interface FormState {
  systemId: string;
  fields: Record<string, unknown>;
}

export class WebWorker implements ToolExecutor {
  private readonly forms = new Map<string, FormState>();

  async execute(request: ToolRequest): Promise<ToolResult> {
    switch (request.tool_name) {
      case "open_system":
        return {
          request_id: request.request_id,
          success: true,
          output: {
            opened: true,
            system_id: request.input.system_id
          },
          memory_patch: {},
          emitted_events: []
        };
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

  private async fillWebForm(request: ToolRequest): Promise<ToolResult> {
    const systemId = String(request.input.system_id ?? "unknown");
    const draftId = `WEBDRAFT-${crypto.randomUUID()}`;
    const fields =
      typeof request.input.field_values === "object" && request.input.field_values !== null
        ? (request.input.field_values as Record<string, unknown>)
        : {};
    this.forms.set(draftId, { systemId, fields });

    return {
      request_id: request.request_id,
      success: true,
      output: {
        artifact_kind: "web_draft",
        draft_id: draftId,
        system_id: systemId,
        filled_fields: fields
      },
      memory_patch: {},
      emitted_events: []
    };
  }

  private async previewSubmission(request: ToolRequest): Promise<ToolResult> {
    return {
      request_id: request.request_id,
      success: true,
      output: {
        artifact_kind: "web_preview",
        preview_id: `PREVIEW-${crypto.randomUUID()}`,
        system_id: request.input.system_id
      },
      memory_patch: {},
      emitted_events: []
    };
  }

  private async submitForm(request: ToolRequest): Promise<ToolResult> {
    return {
      request_id: request.request_id,
      success: true,
      output: {
        artifact_kind: "web_submission",
        record_id: `REC-${crypto.randomUUID()}`,
        system_id: request.input.system_id,
        expected_button: request.input.expected_button
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
