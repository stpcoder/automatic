import test from "node:test";
import assert from "node:assert/strict";

import { CubeWorker } from "./index.js";

test("cube worker drafts and sends messages", async () => {
  const worker = new CubeWorker();
  const draft = await worker.execute({
    request_id: "TR-1",
    case_id: "CASE-1",
    step_id: "notify_current_assignee",
    tool_name: "draft_cube_message",
    mode: "draft",
    input: {
      recipient: "operator-a"
    }
  });

  assert.equal(draft.success, true);
  assert.ok(draft.output.draft_id);

  const send = await worker.execute({
    request_id: "TR-2",
    case_id: "CASE-1",
    step_id: "notify_current_assignee",
    tool_name: "send_cube_message",
    mode: "commit",
    input: {
      draft_id: draft.output.draft_id
    }
  });

  assert.equal(send.success, true);
  assert.ok(send.output.message_id);
});
