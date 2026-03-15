import { type ToolExecutor, type ToolRequest, type ToolResult } from "../../../packages/contracts/src/index.js";

interface MailDraft {
  draftId: string;
  to: string[];
  cc: string[];
  templateId: string;
  variables: Record<string, unknown>;
}

export class OutlookWorker implements ToolExecutor {
  private readonly drafts = new Map<string, MailDraft>();
  private readonly watchedConversations = new Set<string>();

  async execute(request: ToolRequest): Promise<ToolResult> {
    switch (request.tool_name) {
      case "draft_outlook_mail":
        return this.draftMail(request);
      case "send_outlook_mail":
        return this.sendMail(request);
      case "watch_email_reply":
        return this.watchReply(request);
      default:
        return this.fail(request, `Unsupported Outlook tool: ${request.tool_name}`);
    }
  }

  private async draftMail(request: ToolRequest): Promise<ToolResult> {
    const draftId = `DRAFT-${crypto.randomUUID()}`;
    const draft: MailDraft = {
      draftId,
      to: Array.isArray(request.input.to) ? (request.input.to as string[]) : [],
      cc: Array.isArray(request.input.cc) ? (request.input.cc as string[]) : [],
      templateId: String(request.input.template_id ?? "unknown"),
      variables:
        typeof request.input.variables === "object" && request.input.variables !== null
          ? (request.input.variables as Record<string, unknown>)
          : {}
    };
    this.drafts.set(draftId, draft);

    return {
      request_id: request.request_id,
      success: true,
      output: {
        artifact_kind: "mail_draft",
        draft_id: draftId,
        preview_summary: `Drafted ${draft.templateId} for ${draft.to.join(", ")}`
      },
      memory_patch: {},
      emitted_events: []
    };
  }

  private async sendMail(request: ToolRequest): Promise<ToolResult> {
    const draftId = String(request.input.draft_id ?? "");
    const draft = this.drafts.get(draftId);
    if (!draft) {
      return this.fail(request, `Draft ${draftId} not found`);
    }

    const conversationId = `CONV-${crypto.randomUUID()}`;
    return {
      request_id: request.request_id,
      success: true,
      output: {
        artifact_kind: "sent_mail",
        message_id: `MSG-${crypto.randomUUID()}`,
        conversation_id: conversationId,
        recipients: draft.to,
        template_id: draft.templateId
      },
      memory_patch: {},
      emitted_events: []
    };
  }

  private async watchReply(request: ToolRequest): Promise<ToolResult> {
    const conversationId = String(request.input.conversation_id ?? "");
    if (conversationId) {
      this.watchedConversations.add(conversationId);
    }

    return {
      request_id: request.request_id,
      success: true,
      output: {
        watcher: "email",
        expectation_registered: true,
        conversation_id: conversationId
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
