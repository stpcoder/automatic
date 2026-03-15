import test from "node:test";
import assert from "node:assert/strict";

import { createCaseInputSchema, workflowDefinitionSchema } from "./index.js";

test("contracts validate create case input", () => {
  const result = createCaseInputSchema.parse({
    workflow_id: "overseas_equipment_shipment",
    facts: {
      traveler_name: "Kim"
    }
  });

  assert.equal(result.workflow_id, "overseas_equipment_shipment");
});

test("contracts validate workflow definition shape", () => {
  const workflow = workflowDefinitionSchema.parse({
    workflow: {
      workflow_id: "demo",
      trigger: ["manual_case_creation"],
      steps: [
        {
          step_id: "s1",
          goal: "collect",
          required_inputs: [],
          checklist: [],
          allowed_tools: []
        }
      ]
    }
  });

  assert.equal(workflow.workflow.workflow_id, "demo");
});
