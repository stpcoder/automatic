import test from "node:test";
import assert from "node:assert/strict";

import { WebWorker } from "./index.js";

test("web worker fills, previews, and submits a form", async () => {
  const worker = new WebWorker();

  const fill = await worker.execute({
    request_id: "TR-1",
    case_id: "CASE-1",
    step_id: "register_security_portal",
    tool_name: "fill_web_form",
    mode: "draft",
    input: {
      system_id: "security_portal",
      field_values: {
        traveler_name: "Kim",
        customs_number: "GB-8839-22"
      }
    }
  });

  assert.equal(fill.success, true);
  assert.equal(fill.output.system_id, "security_portal");

  const preview = await worker.execute({
    request_id: "TR-2",
    case_id: "CASE-1",
    step_id: "register_security_portal",
    tool_name: "preview_web_submission",
    mode: "preview",
    input: {
      system_id: "security_portal"
    }
  });

  assert.equal(preview.success, true);

  const submit = await worker.execute({
    request_id: "TR-3",
    case_id: "CASE-1",
    step_id: "register_security_portal",
    tool_name: "submit_web_form",
    mode: "commit",
    input: {
      system_id: "security_portal",
      expected_button: "등록"
    }
  });

  assert.equal(submit.success, true);
  assert.ok(submit.output.record_id);
});
