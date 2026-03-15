import test from "node:test";
import assert from "node:assert/strict";

import { SchedulerWorker } from "./index.js";

test("scheduler emits remind and escalate signals", () => {
  const worker = new SchedulerWorker();
  const signals = worker.evaluate(
    [
      {
        expectation_id: "EXP-1",
        case_id: "CASE-1",
        step_id: "request_customs_number",
        type: "email_reply",
        status: "waiting",
        matcher: {
          expected_from: ["vendor@example.com"],
          required_fields: ["customs_number"]
        },
        remind_at: "2026-03-15T00:00:00.000Z",
        escalate_at: "2026-03-15T01:00:00.000Z"
      }
    ],
    new Date("2026-03-15T02:00:00.000Z")
  );

  assert.deepEqual(signals, [
    { expectation_id: "EXP-1", action: "remind" },
    { expectation_id: "EXP-1", action: "escalate" }
  ]);
});
