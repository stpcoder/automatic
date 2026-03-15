import test from "node:test";
import assert from "node:assert/strict";

import { OutlookWorker } from "./index.js";

test("outlook worker drafts, sends, and watches replies", async () => {
  const worker = new OutlookWorker();

  const draft = await worker.execute({
    request_id: "TR-1",
    case_id: "CASE-1",
    step_id: "request_customs_number",
    tool_name: "draft_outlook_mail",
    mode: "draft",
    input: {
      template_id: "request_customs_number",
      to: ["vendor@example.com"],
      cc: [],
      variables: {}
    }
  });

  assert.equal(draft.success, true);
  assert.ok(draft.output.draft_id);

  const send = await worker.execute({
    request_id: "TR-2",
    case_id: "CASE-1",
    step_id: "request_customs_number",
    tool_name: "send_outlook_mail",
    mode: "commit",
    input: {
      draft_id: draft.output.draft_id
    }
  });

  assert.equal(send.success, true);
  assert.ok(send.output.conversation_id);

  const watch = await worker.execute({
    request_id: "TR-3",
    case_id: "CASE-1",
    step_id: "request_customs_number",
    tool_name: "watch_email_reply",
    mode: "preview",
    input: {
      conversation_id: send.output.conversation_id
    }
  });

  assert.equal(watch.success, true);
  assert.equal(watch.output.expectation_registered, true);
});
