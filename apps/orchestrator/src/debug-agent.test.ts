import test from "node:test";
import assert from "node:assert/strict";

import type { PlannerClient, PlannerRequest } from "../../../packages/contracts/src/index.js";

import { buildDebugPlannerRequest, createFallbackDebugPlanner, createHeuristicDebugPlanner } from "./debug-agent.js";

test("fallback debug planner uses heuristic planner when llm returns non-json text", async () => {
  const failingPlanner: PlannerClient = {
    async plan(): Promise<never> {
      throw new Error("Unable to parse JSON from legacy LLM response");
    }
  };

  const planner = createFallbackDebugPlanner(failingPlanner, createHeuristicDebugPlanner());
  const request = buildDebugPlannerRequest(
    "하청업체에 통관번호 요청 메일 초안을 작성해줘",
    {
      template_id: "request_customs_number",
      to: ["vendor@example.com"],
      variables: {
        traveler_name: "Kim"
      }
    },
    []
  );

  const result = await planner.plan(request);
  assert.equal(result.next_action.tool, "draft_outlook_mail");
});

test("heuristic planner rejects non-actionable greeting input", async () => {
  const planner = createHeuristicDebugPlanner();
  const request: PlannerRequest = buildDebugPlannerRequest("hi", {}, []);

  await assert.rejects(() => planner.plan(request), /No actionable tool inferred from instruction/);
});
