import { setTimeout as sleep } from "node:timers/promises";

interface OutlookReplyMatch {
  case_id: string;
  sender: string;
  subject: string;
  conversation_id?: string;
  body?: string;
  extracted_fields: Record<string, unknown>;
}

interface OutlookReplyPollerAdapter {
  pollReplies(input: { watch_directory?: string }): Promise<{ matches: OutlookReplyMatch[] }>;
}

interface OutlookReplyEventSink {
  postIncomingEmail(caseId: string, payload: {
    sender: string;
    subject: string;
    conversation_id?: string;
    body?: string;
    extracted_fields: Record<string, unknown>;
  }): Promise<void>;
}

export class HttpOutlookReplyEventSink implements OutlookReplyEventSink {
  constructor(private readonly baseUrl = process.env.ORCHESTRATOR_BASE_URL ?? "http://127.0.0.1:3000") {}

  async postIncomingEmail(caseId: string, payload: {
    sender: string;
    subject: string;
    conversation_id?: string;
    body?: string;
    extracted_fields: Record<string, unknown>;
  }): Promise<void> {
    const response = await fetch(`${this.baseUrl}/cases/${caseId}/events/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      throw new Error(`Failed to post incoming email for ${caseId}: ${response.status}`);
    }
  }
}

export class OutlookReplyPoller {
  constructor(
    private readonly adapter: OutlookReplyPollerAdapter,
    private readonly sink: OutlookReplyEventSink,
    private readonly options: { watchDirectory?: string; intervalMs?: number } = {}
  ) {}

  async runOnce(): Promise<{ delivered: number; matches: OutlookReplyMatch[] }> {
    const result = await this.adapter.pollReplies({
      watch_directory: this.options.watchDirectory
    });
    for (const match of result.matches) {
      await this.sink.postIncomingEmail(match.case_id, {
        sender: match.sender,
        subject: match.subject,
        conversation_id: match.conversation_id,
        body: match.body,
        extracted_fields: match.extracted_fields
      });
    }
    return {
      delivered: result.matches.length,
      matches: result.matches
    };
  }

  async runForever(): Promise<never> {
    const intervalMs = this.options.intervalMs ?? Number(process.env.OUTLOOK_REPLY_POLL_INTERVAL_MS ?? "10000");
    for (;;) {
      try {
        await this.runOnce();
      } catch (error) {
        console.error("Outlook reply poller iteration failed", error);
      }
      await sleep(intervalMs);
    }
  }
}
