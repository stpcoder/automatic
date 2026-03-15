import {
  type CaseEvent,
  type IncomingEmailPayload,
  type ToolExecutor,
  type ToolRequest,
  type ToolResult
} from "../../../packages/contracts/src/index.js";

function makeEvent(caseId: string, type: CaseEvent["event_type"], payload: Record<string, unknown>): CaseEvent {
  return {
    event_id: crypto.randomUUID(),
    case_id: caseId,
    event_type: type,
    payload,
    source: "tool-executor",
    created_at: new Date().toISOString()
  };
}

export class DemoToolExecutor implements ToolExecutor {
  async execute(request: ToolRequest): Promise<ToolResult> {
    switch (request.tool_name) {
      case "draft_outlook_mail":
        return {
          request_id: request.request_id,
          success: true,
          output: {
            artifact_kind: "mail_draft",
            draft_id: `DRAFT-${crypto.randomUUID()}`,
            preview_summary: `Drafted vendor mail for ${String(request.input.to ?? "")}`
          },
          memory_patch: {},
          emitted_events: []
        };
      case "send_outlook_mail":
        return {
          request_id: request.request_id,
          success: true,
          output: {
            artifact_kind: "sent_mail",
            message_id: `MSG-${crypto.randomUUID()}`,
            conversation_id: `CONV-${crypto.randomUUID()}`
          },
          memory_patch: {},
          emitted_events: []
        };
      case "watch_email_reply":
        return {
          request_id: request.request_id,
          success: true,
          output: {
            watcher: "email",
            expectation_registered: true
          },
          memory_patch: {},
          emitted_events: []
        };
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
        return {
          request_id: request.request_id,
          success: true,
          output: {
            artifact_kind: "web_draft",
            draft_id: `WEBDRAFT-${crypto.randomUUID()}`,
            filled_fields: request.input.field_values ?? {}
          },
          memory_patch: {},
          emitted_events: []
        };
      case "preview_web_submission":
        return {
          request_id: request.request_id,
          success: true,
          output: {
            preview_ready: true,
            artifact_kind: "web_preview",
            preview_id: `PREVIEW-${crypto.randomUUID()}`
          },
          memory_patch: {},
          emitted_events: []
        };
      case "submit_web_form":
        return {
          request_id: request.request_id,
          success: true,
          output: {
            artifact_kind: "web_submission",
            record_id: `REC-${crypto.randomUUID()}`
          },
          memory_patch: {},
          emitted_events: []
        };
      default:
        return {
          request_id: request.request_id,
          success: false,
          output: {
            error: `Tool ${request.tool_name} not implemented in demo executor`
          },
          memory_patch: {},
          emitted_events: []
        };
    }
  }
}

export function makeIncomingEmailEvent(caseId: string, payload: IncomingEmailPayload): CaseEvent {
  return makeEvent(caseId, "incoming_email", payload as unknown as Record<string, unknown>);
}
