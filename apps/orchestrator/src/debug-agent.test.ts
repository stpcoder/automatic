import test from "node:test";
import assert from "node:assert/strict";

import { buildDebugLoopPlannerRequest, parsePlannerJsonText } from "./debug-agent.js";

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
  assert.match(userContent, /response_contract/);
});

test("parsePlannerJsonText recovers JSON wrapped in prose", () => {
  const parsed = parsePlannerJsonText(
    'The search plan is below.\n{"objective":"Search","rationale":"Need result","next_action":{"tool":"open_system","input":{}},"requires_approval":false,"expected_transition":"RUNNING"}'
  ) as Record<string, unknown>;

  assert.equal(parsed.objective, "Search");
});

test("parsePlannerJsonText recovers fenced JSON with smart quotes", () => {
  const parsed = parsePlannerJsonText(
    '```json\n{\n  “objective”: “Search”,\n  “rationale”: “Need result”,\n  “next_action”: { “tool”: “open_system”, “input”: {} },\n  “requires_approval”: false,\n  “expected_transition”: “RUNNING”\n}\n```'
  ) as Record<string, unknown>;

  assert.equal(parsed.expected_transition, "RUNNING");
});
