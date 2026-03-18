import test from "node:test";
import assert from "node:assert/strict";
import { plannerOutputSchema } from "../../../packages/contracts/src/index.js";

import { buildDebugLoopPlannerRequest, normalizePlannerOutputForSchema, parsePlannerJsonText } from "./debug-agent.js";

test("debug planner request includes explicit global and step planning contract", () => {
  const request = buildDebugLoopPlannerRequest("테스트", {}, [
    {
      name: "open_system",
      description: "Open a page",
      input_schema: {}
    }
  ]);

  const systemPrompt = request.messages.find((message) => message.role === "system")?.content ?? "";
  const userContent = request.messages.find((message) => message.role === "user")?.content ?? "";
  assert.match(systemPrompt, /global_plan/i);
  assert.match(systemPrompt, /step_plan/i);
  assert.match(systemPrompt, /evaluation_previous_goal/i);
  assert.match(systemPrompt, /memory/i);
  assert.match(systemPrompt, /next_goal/i);
  assert.match(userContent, /available_tools/);
  assert.doesNotMatch(userContent, /response_contract/);
});

test("parsePlannerJsonText recovers JSON wrapped in prose", () => {
  const parsed = parsePlannerJsonText(
    'The search plan is below.\n{"objective":"Search","next_action":{"tool":"open_system","input":{}},"requires_approval":false,"expected_transition":"RUNNING"}'
  ) as Record<string, unknown>;

  assert.equal(parsed.objective, "Search");
});

test("parsePlannerJsonText recovers fenced JSON with smart quotes", () => {
  const parsed = parsePlannerJsonText(
    '```json\n{\n  “objective”: “Search”,\n  “next_action”: { “tool”: “open_system”, “input”: {} },\n  “requires_approval”: false,\n  “expected_transition”: “RUNNING”\n}\n```'
  ) as Record<string, unknown>;

  assert.equal(parsed.expected_transition, "RUNNING");
});

test("debug planner normalizes SUCCEEDED transition aliases before schema validation", () => {
  const parsed = normalizePlannerOutputForSchema(
    parsePlannerJsonText(
      '{"objective":"Finish the task","next_action":{"tool":"finish_task","input":{"summary":"Done"}},"requires_approval":false,"expected_transition":"SUCCEEDED"}'
    )
  );
  const result = plannerOutputSchema.parse(parsed);
  assert.equal(result.expected_transition, "COMPLETED");
});
