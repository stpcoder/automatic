import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { WorkflowRegistry } from "./index.js";

test("workflow registry loads example workflows", async () => {
  const registry = await WorkflowRegistry.fromExampleDirectory(path.resolve(process.cwd(), "examples"));
  const workflow = registry.getWorkflow("overseas_equipment_shipment");
  const step = registry.getStep("overseas_equipment_shipment", "request_customs_number");

  assert.equal(workflow.workflow_id, "overseas_equipment_shipment");
  assert.equal(step.step_id, "request_customs_number");
});
