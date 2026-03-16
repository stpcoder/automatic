import { type ToolExecutor, type ToolRequest, type ToolResult } from "../../../packages/contracts/src/index.js";
import { OutlookComAdapter } from "./outlook-com-adapter.js";

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
  private readonly useRealAdapter: boolean;

  constructor() {
    this.useRealAdapter = process.env.OUTLOOK_WORKER_ADAPTER === "outlook_com";
  }

  async execute(request: ToolRequest): Promise<ToolResult> {
    switch (request.tool_name) {
      case "draft_outlook_mail":
        return this.draftMail(request);
      case "send_outlook_mail":
        return this.sendMail(request);
      case "watch_email_reply":
        return this.watchReply(request);
      case "search_outlook_mail":
        return this.searchMail(request);
      default:
        return this.fail(request, `Unsupported Outlook tool: ${request.tool_name}`);
    }
  }

  private async draftMail(request: ToolRequest): Promise<ToolResult> {
    if (this.useRealAdapter) {
      const output = await new OutlookComAdapter().draftMail({
        template_id: String(request.input.template_id ?? "unknown"),
        to: Array.isArray(request.input.to) ? (request.input.to as string[]) : [],
        cc: Array.isArray(request.input.cc) ? (request.input.cc as string[]) : [],
        variables:
          typeof request.input.variables === "object" && request.input.variables !== null
            ? (request.input.variables as Record<string, unknown>)
            : {}
      });
      return {
        request_id: request.request_id,
        success: true,
        output,
        memory_patch: {},
        emitted_events: []
      };
    }

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
    if (this.useRealAdapter) {
      const output = await new OutlookComAdapter().sendMail({
        draft_id: String(request.input.draft_id ?? "")
      });
      return {
        request_id: request.request_id,
        success: true,
        output,
        memory_patch: {},
        emitted_events: []
      };
    }

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
    if (this.useRealAdapter) {
      const output = await new OutlookComAdapter().watchReply({
        case_id: typeof request.input.case_id === "string" ? request.input.case_id : undefined,
        conversation_id: String(request.input.conversation_id ?? ""),
        expected_from: Array.isArray(request.input.expected_from) ? (request.input.expected_from as string[]) : [],
        required_fields: Array.isArray(request.input.required_fields) ? (request.input.required_fields as string[]) : []
      });
      return {
        request_id: request.request_id,
        success: true,
        output,
        memory_patch: {},
        emitted_events: []
      };
    }

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

  private async searchMail(request: ToolRequest): Promise<ToolResult> {
    if (this.useRealAdapter) {
      const output = await new OutlookComAdapter().searchMail({
        keyword: String(request.input.keyword ?? ""),
        max_results: Number(request.input.max_results ?? 10)
      });
      return {
        request_id: request.request_id,
        success: true,
        output,
        memory_patch: {},
        emitted_events: []
      };
    }

    const keyword = String(request.input.keyword ?? "").toLowerCase();
    const sampleMessages = [
      {
        entry_id: "MSG-1",
        subject: "AE School 안내",
        sender: "taeho.je@sk.com",
        received_time: new Date().toISOString(),
        conversation_id: "CONV-AE-SCHOOL"
      }
    ];
    const matches = sampleMessages.filter(
      (message) =>
        keyword.length === 0 ||
        message.subject.toLowerCase().includes(keyword) ||
        message.sender.toLowerCase().includes(keyword)
    );

    return {
      request_id: request.request_id,
      success: true,
      output: {
        artifact_kind: "mail_search",
        keyword,
        count: matches.length,
        messages: matches
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
