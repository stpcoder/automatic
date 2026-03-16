import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function powershellBinary(): string {
  return process.platform === "win32" ? "powershell.exe" : "pwsh";
}

async function runScript(scriptName: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const scriptPath = path.resolve(process.cwd(), "workers", "outlook-worker", "scripts", scriptName);
  const { stdout } = await execFileAsync(
    powershellBinary(),
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-PayloadJson", JSON.stringify(payload)],
    { maxBuffer: 1024 * 1024 }
  );
  return JSON.parse(stdout.trim() || "{}") as Record<string, unknown>;
}

export class OutlookComAdapter {
  async draftMail(input: {
    template_id: string;
    to: string[];
    cc: string[];
    variables: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    return runScript("draft-mail.ps1", input);
  }

  async sendMail(input: { draft_id: string }): Promise<Record<string, unknown>> {
    return runScript("send-mail.ps1", input);
  }

  async watchReply(input: {
    case_id?: string;
    conversation_id: string;
    expected_from: string[];
    required_fields: string[];
  }): Promise<Record<string, unknown>> {
    return runScript("watch-reply.ps1", input);
  }

  async searchMail(input: {
    keyword: string;
    max_results?: number;
  }): Promise<Record<string, unknown>> {
    return runScript("search-mail.ps1", input);
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
