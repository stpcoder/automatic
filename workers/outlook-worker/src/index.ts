import { type ToolExecutor, type ToolRequest, type ToolResult } from "../../../packages/contracts/src/index.js";
import { OutlookComAdapter } from "./outlook-com-adapter.js";

interface MailDraft {
  draftId: string;
  to: string[];
  cc: string[];
  templateId: string;
  variables: Record<string, unknown>;
  subject?: string;
  bodyHtml?: string;
}

interface MailMessage {
  entry_id: string;
  subject: string;
  sender: string;
  recipients: string[];
  received_time: string;
  conversation_id: string;
  body: string;
  body_snippet: string;
  folder: string;
  store?: string;
}

interface ContactCandidate {
  name: string;
  email: string;
  source: string;
  company?: string;
  department?: string;
  job_title?: string;
  entry_id?: string;
}

export class OutlookWorker implements ToolExecutor {
  private readonly drafts = new Map<string, MailDraft>();
  private readonly watchedConversations = new Set<string>();
  private readonly useRealAdapter: boolean;
  private readonly messages = new Map<string, MailMessage>();

  constructor() {
    this.useRealAdapter = process.env.OUTLOOK_WORKER_ADAPTER === "outlook_com";
  }

  async execute(request: ToolRequest): Promise<ToolResult> {
    switch (request.tool_name) {
      case "draft_outlook_mail":
        return this.draftMail(request);
      case "send_outlook_mail":
        return this.sendMail(request);
      case "read_outlook_mail":
        return this.readMail(request);
      case "read_outlook_conversation":
        return this.readConversation(request);
      case "reply_outlook_mail":
        return this.replyMail(request);
      case "update_outlook_draft":
        return this.updateDraft(request);
      case "preview_outlook_draft":
        return this.previewDraft(request);
      case "watch_email_reply":
        return this.watchReply(request);
      case "await_email_reply":
        return this.awaitReply(request);
      case "search_outlook_mail":
        return this.searchMail(request);
      case "search_outlook_contacts":
        return this.searchContacts(request);
      default:
        return this.fail(request, `Unsupported Outlook tool: ${request.tool_name}`);
    }
  }

  private async draftMail(request: ToolRequest): Promise<ToolResult> {
    if (this.useRealAdapter) {
      const output = await new OutlookComAdapter().draftMail({
        template_id: typeof request.input.template_id === "string" ? request.input.template_id : undefined,
        to: Array.isArray(request.input.to) ? (request.input.to as string[]) : [],
        cc: Array.isArray(request.input.cc) ? (request.input.cc as string[]) : [],
        variables:
          typeof request.input.variables === "object" && request.input.variables !== null
            ? (request.input.variables as Record<string, unknown>)
            : undefined,
        subject: typeof request.input.subject === "string" ? request.input.subject : undefined,
        body_text: typeof request.input.body_text === "string" ? request.input.body_text : undefined,
        body_html: typeof request.input.body_html === "string" ? request.input.body_html : undefined
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
      templateId: typeof request.input.template_id === "string" ? request.input.template_id : "general_mail",
      variables:
        typeof request.input.variables === "object" && request.input.variables !== null
          ? (request.input.variables as Record<string, unknown>)
          : {},
      subject:
        typeof request.input.subject === "string" && request.input.subject.trim().length > 0
          ? request.input.subject
          : `[${typeof request.input.template_id === "string" ? request.input.template_id : "general_mail"}] Automated Draft`,
      bodyHtml:
        typeof request.input.body_html === "string" && request.input.body_html.trim().length > 0
          ? request.input.body_html
          : typeof request.input.body_text === "string"
            ? `<div>${request.input.body_text}</div>`
            : `<pre>${JSON.stringify(
                typeof request.input.variables === "object" && request.input.variables !== null
                  ? (request.input.variables as Record<string, unknown>)
                  : {},
                null,
                2
              )}</pre>`
    };
    this.drafts.set(draftId, draft);

    return {
      request_id: request.request_id,
      success: true,
      output: {
        artifact_kind: "mail_draft",
        draft_id: draftId,
        preview_summary: `Drafted ${draft.templateId} for ${draft.to.join(", ")}`,
        subject: draft.subject,
        to: draft.to,
        cc: draft.cc
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
    const messageId = `MSG-${crypto.randomUUID()}`;
    const body = draft.bodyHtml ?? "";
    this.messages.set(messageId, {
      entry_id: messageId,
      subject: draft.subject ?? `[${draft.templateId}] Automated Draft`,
      sender: "taeho.je@sk.com",
      recipients: draft.to,
      received_time: new Date().toISOString(),
      conversation_id: conversationId,
      body,
      body_snippet: body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500),
      folder: "sent",
      store: "fake"
    });
    return {
      request_id: request.request_id,
      success: true,
      output: {
        artifact_kind: "sent_mail",
        message_id: messageId,
        conversation_id: conversationId,
        recipients: draft.to,
        template_id: draft.templateId
      },
      memory_patch: {},
      emitted_events: []
    };
  }

  private async readMail(request: ToolRequest): Promise<ToolResult> {
    if (this.useRealAdapter) {
      const output = await new OutlookComAdapter().readMail({
        entry_id: typeof request.input.entry_id === "string" ? request.input.entry_id : undefined,
        conversation_id: typeof request.input.conversation_id === "string" ? request.input.conversation_id : undefined
      });
      return {
        request_id: request.request_id,
        success: true,
        output,
        memory_patch: {},
        emitted_events: []
      };
    }

    const entryId = typeof request.input.entry_id === "string" ? request.input.entry_id : "";
    const conversationId = typeof request.input.conversation_id === "string" ? request.input.conversation_id : "";
    const message =
      (entryId ? this.messages.get(entryId) : undefined) ??
      [...this.messages.values()].find((item) => item.conversation_id === conversationId);

    if (!message) {
      return this.fail(request, "Mail not found");
    }

    return {
      request_id: request.request_id,
      success: true,
      output: {
        artifact_kind: "mail_detail",
        ...message
      },
      memory_patch: {},
      emitted_events: []
    };
  }

  private async readConversation(request: ToolRequest): Promise<ToolResult> {
    if (this.useRealAdapter) {
      const output = await new OutlookComAdapter().readConversation({
        conversation_id: String(request.input.conversation_id ?? ""),
        max_messages: typeof request.input.max_messages === "number" ? request.input.max_messages : undefined
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
    const maxMessages = typeof request.input.max_messages === "number" ? request.input.max_messages : 20;
    const messages = [...this.messages.values()]
      .filter((item) => item.conversation_id === conversationId)
      .sort((a, b) => a.received_time.localeCompare(b.received_time))
      .slice(0, maxMessages);

    return {
      request_id: request.request_id,
      success: true,
      output: {
        artifact_kind: "mail_conversation",
        conversation_id: conversationId,
        count: messages.length,
        messages
      },
      memory_patch: {},
      emitted_events: []
    };
  }

  private async replyMail(request: ToolRequest): Promise<ToolResult> {
    if (this.useRealAdapter) {
      const output = await new OutlookComAdapter().replyMail({
        entry_id: typeof request.input.entry_id === "string" ? request.input.entry_id : undefined,
        conversation_id: typeof request.input.conversation_id === "string" ? request.input.conversation_id : undefined,
        body_text: typeof request.input.body_text === "string" ? request.input.body_text : undefined,
        body_html: typeof request.input.body_html === "string" ? request.input.body_html : undefined,
        reply_all: request.input.reply_all === true
      });
      return {
        request_id: request.request_id,
        success: true,
        output,
        memory_patch: {},
        emitted_events: []
      };
    }

    const entryId = typeof request.input.entry_id === "string" ? request.input.entry_id : "";
    const conversationId = typeof request.input.conversation_id === "string" ? request.input.conversation_id : "";
    const baseMessage =
      (entryId ? this.messages.get(entryId) : undefined) ??
      [...this.messages.values()].find((item) => item.conversation_id === conversationId);

    if (!baseMessage) {
      return this.fail(request, "Base message not found for reply");
    }

    const draftId = `DRAFT-${crypto.randomUUID()}`;
    const replyBody =
      typeof request.input.body_html === "string" && request.input.body_html.trim().length > 0
        ? request.input.body_html
        : typeof request.input.body_text === "string"
          ? `<div>${request.input.body_text}</div>`
          : "<div></div>";
    const draft: MailDraft = {
      draftId,
      to: [baseMessage.sender],
      cc: [],
      templateId: "reply",
      variables: {},
      subject: baseMessage.subject.startsWith("Re:") ? baseMessage.subject : `Re: ${baseMessage.subject}`,
      bodyHtml: `${replyBody}<hr/><div>${baseMessage.body}</div>`
    };
    this.drafts.set(draftId, draft);

    return {
      request_id: request.request_id,
      success: true,
      output: {
        artifact_kind: "mail_draft",
        draft_id: draftId,
        conversation_id: baseMessage.conversation_id,
        preview_summary: `Reply draft for ${baseMessage.subject}`,
        subject: draft.subject,
        to: draft.to,
        cc: draft.cc
      },
      memory_patch: {},
      emitted_events: []
    };
  }

  private async updateDraft(request: ToolRequest): Promise<ToolResult> {
    if (this.useRealAdapter) {
      const output = await new OutlookComAdapter().updateDraft({
        draft_id: String(request.input.draft_id ?? ""),
        subject: typeof request.input.subject === "string" ? request.input.subject : undefined,
        to: Array.isArray(request.input.to) ? (request.input.to as string[]) : undefined,
        cc: Array.isArray(request.input.cc) ? (request.input.cc as string[]) : undefined,
        body_text: typeof request.input.body_text === "string" ? request.input.body_text : undefined,
        body_html: typeof request.input.body_html === "string" ? request.input.body_html : undefined
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
    if (typeof request.input.subject === "string") {
      draft.subject = request.input.subject;
    }
    if (Array.isArray(request.input.to)) {
      draft.to = request.input.to as string[];
    }
    if (Array.isArray(request.input.cc)) {
      draft.cc = request.input.cc as string[];
    }
    if (typeof request.input.body_html === "string") {
      draft.bodyHtml = request.input.body_html;
    } else if (typeof request.input.body_text === "string") {
      draft.bodyHtml = `<div>${request.input.body_text}</div>`;
    }
    this.drafts.set(draftId, draft);

    return {
      request_id: request.request_id,
      success: true,
      output: {
        artifact_kind: "mail_draft",
        draft_id: draftId,
        preview_summary: `Updated draft for ${draft.to.join(", ")}`,
        subject: draft.subject,
        to: draft.to,
        cc: draft.cc
      },
      memory_patch: {},
      emitted_events: []
    };
  }

  private async previewDraft(request: ToolRequest): Promise<ToolResult> {
    if (this.useRealAdapter) {
      const output = await new OutlookComAdapter().previewDraft({
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

    return {
      request_id: request.request_id,
      success: true,
      output: {
        artifact_kind: "mail_draft_preview",
        draft_id: draftId,
        subject: draft.subject ?? `[${draft.templateId}] Automated Draft`,
        to: draft.to,
        cc: draft.cc,
        body_html: draft.bodyHtml ?? "",
        preview_summary: `Draft preview for ${draft.to.join(", ")}`
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
        required_fields: Array.isArray(request.input.required_fields) ? (request.input.required_fields as string[]) : [],
        keyword_contains: Array.isArray(request.input.keyword_contains) ? (request.input.keyword_contains as string[]) : []
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
        conversation_id: conversationId,
        keyword_contains: Array.isArray(request.input.keyword_contains) ? (request.input.keyword_contains as string[]) : []
      },
      memory_patch: {},
      emitted_events: []
    };
  }

  private async awaitReply(request: ToolRequest): Promise<ToolResult> {
    if (this.useRealAdapter) {
      const output = await new OutlookComAdapter().awaitReply({
        case_id: typeof request.input.case_id === "string" ? request.input.case_id : undefined,
        conversation_id: typeof request.input.conversation_id === "string" ? request.input.conversation_id : undefined,
        expected_from: Array.isArray(request.input.expected_from) ? (request.input.expected_from as string[]) : [],
        required_fields: Array.isArray(request.input.required_fields) ? (request.input.required_fields as string[]) : [],
        keyword_contains: Array.isArray(request.input.keyword_contains) ? (request.input.keyword_contains as string[]) : [],
        watch_directory: typeof request.input.watch_directory === "string" ? request.input.watch_directory : undefined,
        timeout_seconds: typeof request.input.timeout_seconds === "number" ? request.input.timeout_seconds : undefined,
        poll_interval_ms: typeof request.input.poll_interval_ms === "number" ? request.input.poll_interval_ms : undefined
      });
      return {
        request_id: request.request_id,
        success: true,
        output,
        memory_patch: {},
        emitted_events: []
      };
    }

    return this.fail(request, "await_email_reply is only supported with the outlook_com adapter");
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

  private async searchContacts(request: ToolRequest): Promise<ToolResult> {
    if (this.useRealAdapter) {
      const output = await new OutlookComAdapter().searchContacts({
        query: String(request.input.query ?? ""),
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

    const query = String(request.input.query ?? "").toLowerCase();
    const maxResults = typeof request.input.max_results === "number" ? request.input.max_results : 10;
    const contacts: ContactCandidate[] = [
      {
        name: "Taeho Je",
        email: "taeho.je@sk.com",
        source: "directory_resolved",
        company: "SK hynix",
        department: "Automation",
        job_title: "Engineer"
      },
      {
        name: "AE School 운영팀",
        email: "ae.school@sk.com",
        source: "directory",
        company: "SK hynix",
        department: "Education",
        job_title: "Distribution Group"
      }
    ];
    const matches = contacts.filter((contact) => {
      if (query.length === 0) {
        return true;
      }
      const haystack = [contact.name, contact.email, contact.company, contact.department, contact.job_title]
        .filter((value) => typeof value === "string")
        .join("\n")
        .toLowerCase();
      return haystack.includes(query);
    }).slice(0, maxResults);

    return {
      request_id: request.request_id,
      success: true,
      output: {
        artifact_kind: "contact_search",
        query,
        count: matches.length,
        contacts: matches
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
