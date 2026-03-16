import test from "node:test";
import assert from "node:assert/strict";

import { OutlookReplyPoller } from "./reply-poller.js";

test("reply poller posts matched replies to orchestrator", async () => {
  const delivered: Array<{ caseId: string; payload: Record<string, unknown> }> = [];
  const poller = new OutlookReplyPoller(
    {
      async pollReplies() {
        return {
          matches: [
            {
              case_id: "CASE-1",
              sender: "vendor@example.com",
              subject: "Re: customs number",
              conversation_id: "CONV-1",
              body: "customs number: GB-8839-22",
              extracted_fields: {
                customs_number: "GB-8839-22"
              }
            }
          ]
        };
      }
    },
    {
      async postIncomingEmail(caseId, payload) {
        delivered.push({ caseId, payload });
      }
    }
  );

  const result = await poller.runOnce();
  assert.equal(result.delivered, 1);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].caseId, "CASE-1");
  assert.equal((delivered[0].payload.extracted_fields as Record<string, unknown>).customs_number, "GB-8839-22");
});

test("reply poller handles empty poll results", async () => {
  const poller = new OutlookReplyPoller(
    {
      async pollReplies() {
        return { matches: [] };
      }
    },
    {
      async postIncomingEmail() {
        throw new Error("should not be called");
      }
    }
  );

  const result = await poller.runOnce();
  assert.equal(result.delivered, 0);
});
