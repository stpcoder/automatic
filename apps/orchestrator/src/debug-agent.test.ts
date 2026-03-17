import test from "node:test";
import assert from "node:assert/strict";

import { buildDebugLoopPlannerRequest } from "./debug-agent.js";

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
