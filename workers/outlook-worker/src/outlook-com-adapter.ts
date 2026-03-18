import { execFile } from "node:child_process";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function powershellBinary(): string {
  return process.platform === "win32" ? "powershell.exe" : "pwsh";
}

async function runScript(scriptName: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const scriptPath = path.resolve(process.cwd(), "workers", "outlook-worker", "scripts", scriptName);
  try {
    const { stdout } = await execFileAsync(
      powershellBinary(),
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-PayloadJson", JSON.stringify(payload)],
      { maxBuffer: 1024 * 1024 }
    );
    return JSON.parse(stdout.trim() || "{}") as Record<string, unknown>;
  } catch (error) {
    const details =
      typeof error === "object" && error !== null
        ? [Reflect.get(error, "message"), Reflect.get(error, "stderr"), Reflect.get(error, "stdout")]
            .filter((value) => typeof value === "string" && value.trim().length > 0)
            .join("\n")
        : String(error);
    throw new Error(`Outlook script ${scriptName} failed.\n${details}`);
  }
}

export class OutlookComAdapter {
  async draftMail(input: {
    template_id?: string;
    to: string[];
    cc: string[];
    variables?: Record<string, unknown>;
    subject?: string;
    body_text?: string;
    body_html?: string;
  }): Promise<Record<string, unknown>> {
    return runScript("draft-mail.ps1", input);
  }

  async sendMail(input: { draft_id: string }): Promise<Record<string, unknown>> {
    return runScript("send-mail.ps1", input);
  }

  async readMail(input: { entry_id?: string; conversation_id?: string }): Promise<Record<string, unknown>> {
    return runScript("read-mail.ps1", input);
  }

  async readConversation(input: { conversation_id: string; max_messages?: number }): Promise<Record<string, unknown>> {
    return runScript("read-conversation.ps1", input);
  }

  async replyMail(input: {
    entry_id?: string;
    conversation_id?: string;
    body_text?: string;
    body_html?: string;
    reply_all?: boolean;
  }): Promise<Record<string, unknown>> {
    return runScript("reply-mail.ps1", input);
  }

  async updateDraft(input: {
    draft_id: string;
    subject?: string;
    to?: string[];
    cc?: string[];
    body_text?: string;
    body_html?: string;
  }): Promise<Record<string, unknown>> {
    return runScript("update-draft.ps1", input);
  }

  async previewDraft(input: { draft_id: string }): Promise<Record<string, unknown>> {
    return runScript("preview-draft.ps1", input);
  }

  async watchReply(input: {
    case_id?: string;
    conversation_id: string;
    expected_from: string[];
    required_fields: string[];
    keyword_contains?: string[];
  }): Promise<Record<string, unknown>> {
    return runScript("watch-reply.ps1", input);
  }

  async awaitReply(input: {
    case_id?: string;
    conversation_id?: string;
    expected_from?: string[];
    required_fields?: string[];
    keyword_contains?: string[];
    watch_directory?: string;
    timeout_seconds?: number;
    poll_interval_ms?: number;
  }): Promise<Record<string, unknown>> {
    const caseId =
      typeof input.case_id === "string" && input.case_id.trim().length > 0
        ? input.case_id
        : `DEBUG-WAIT-${crypto.randomUUID()}`;
    const timeoutSeconds =
      typeof input.timeout_seconds === "number" && Number.isFinite(input.timeout_seconds) && input.timeout_seconds > 0
        ? input.timeout_seconds
        : Number(process.env.OUTLOOK_WAIT_TIMEOUT_SECONDS ?? "86400");
    const pollIntervalMs =
      typeof input.poll_interval_ms === "number" && Number.isFinite(input.poll_interval_ms) && input.poll_interval_ms > 0
        ? input.poll_interval_ms
        : Number(process.env.OUTLOOK_WAIT_POLL_INTERVAL_MS ?? "10000");

    await this.watchReply({
      case_id: caseId,
      conversation_id: input.conversation_id ?? "",
      expected_from: input.expected_from ?? [],
      required_fields: input.required_fields ?? [],
      keyword_contains: input.keyword_contains ?? []
    });

    const deadline = Date.now() + timeoutSeconds * 1000;
    for (;;) {
      const result = await this.pollReplies({
        watch_directory: input.watch_directory
      });
      const match = result.matches.find((candidate) => candidate.case_id === caseId);
      if (match) {
        return {
          artifact_kind: "incoming_mail_reply",
          waiting: false,
          case_id: caseId,
          sender: match.sender,
          subject: match.subject,
          conversation_id: match.conversation_id,
          body: match.body,
          extracted_fields: match.extracted_fields
        };
      }

      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for matching email reply after ${timeoutSeconds}s`);
      }

      await sleep(pollIntervalMs);
    }
  }

  async searchMail(input: {
    keyword: string;
    max_results?: number;
  }): Promise<Record<string, unknown>> {
    return runScript("search-mail.ps1", input);
  }

  async searchContacts(input: {
    query: string;
    max_results?: number;
  }): Promise<Record<string, unknown>> {
    return runScript("search-contacts.ps1", input);
  }

  async pollReplies(input: { watch_directory?: string }): Promise<{ matches: Array<{
    case_id: string;
    sender: string;
    subject: string;
    conversation_id?: string;
    body?: string;
    extracted_fields: Record<string, unknown>;
  }> }> {
    const output = await runScript("poll-replies.ps1", input);
    return {
      matches: Array.isArray(output.matches) ? (output.matches as Array<{
        case_id: string;
        sender: string;
        subject: string;
        conversation_id?: string;
        body?: string;
        extracted_fields: Record<string, unknown>;
      }>) : []
    };
  }
}
