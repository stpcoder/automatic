import { browserBridgeCoordinator } from "../../../packages/browser-bridge/src/index.js";
import { type ToolExecutor, type ToolRequest, type ToolResult } from "../../../packages/contracts/src/index.js";

interface CubeDraft {
  draftId: string;
  recipient: string;
  body: string;
}

export class CubeWorker implements ToolExecutor {
  private readonly drafts = new Map<string, CubeDraft>();

  async execute(request: ToolRequest): Promise<ToolResult> {
    switch (request.tool_name) {
      case "draft_cube_message":
        return this.draftMessage(request);
      case "send_cube_message":
        return this.sendMessage(request);
      default:
        return {
          request_id: request.request_id,
          success: false,
          output: {
            error: `Unsupported cube tool: ${request.tool_name}`
          },
          memory_patch: {},
          emitted_events: []
        };
    }
  }

  private async draftMessage(request: ToolRequest): Promise<ToolResult> {
    const draftId = `CUBE-DRAFT-${crypto.randomUUID()}`;
    const body =
      typeof request.input.body === "string"
        ? request.input.body
        : typeof request.input.variables === "object" && request.input.variables !== null
          ? JSON.stringify(request.input.variables)
          : String(request.input.template_id ?? "");

    this.drafts.set(draftId, {
      draftId,
      recipient: String(request.input.recipient ?? ""),
      body
    });

    return {
      request_id: request.request_id,
      success: true,
      output: {
        artifact_kind: "cube_draft",
        draft_id: draftId,
        recipient: request.input.recipient,
        preview_summary: body
      },
      memory_patch: {},
      emitted_events: []
    };
  }

  private async sendMessage(request: ToolRequest): Promise<ToolResult> {
    const draftId = String(request.input.draft_id ?? "");
    const draft = this.drafts.get(draftId);
    if (!draft) {
      return {
        request_id: request.request_id,
        success: false,
        output: {
          error: `Draft ${draftId} not found`
        },
        memory_patch: {},
        emitted_events: []
      };
    }

    if (process.env.CUBE_WORKER_ADAPTER === "bookmarklet_bridge") {
      const fillCommand = browserBridgeCoordinator.enqueueCommand("cube", "fill", {
        field_values: {
          message_body: draft.body
        }
      });
      const fillResult = await browserBridgeCoordinator.waitForCommandResult("cube", fillCommand.command_id);
      if (fillResult.status === "failed") {
        return {
          request_id: request.request_id,
          success: false,
          output: {
            error: fillResult.error ?? "Cube fill failed"
          },
          memory_patch: {},
          emitted_events: []
        };
      }

      const submitCommand = browserBridgeCoordinator.enqueueCommand("cube", "submit", {
        expected_button: "Send"
      });
      const submitResult = await browserBridgeCoordinator.waitForCommandResult("cube", submitCommand.command_id);
      if (submitResult.status === "failed") {
        return {
          request_id: request.request_id,
          success: false,
          output: {
            error: submitResult.error ?? "Cube send failed"
          },
          memory_patch: {},
          emitted_events: []
        };
      }
    }

    return {
      request_id: request.request_id,
      success: true,
      output: {
        artifact_kind: "cube_sent",
        message_id: `CUBE-MSG-${crypto.randomUUID()}`
      },
      memory_patch: {},
      emitted_events: []
    };
  }
}
