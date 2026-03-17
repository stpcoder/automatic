import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { browserBridgeCoordinator } from "../../../packages/browser-bridge/src/index.js";
import type { PlannerOutput, PlannerRequest } from "../../../packages/contracts/src/index.js";
import { createApp } from "./app.js";
import type { DebugPlannerClient } from "./debug-agent.js";
import { resolveLlmConfig } from "./llm-config.js";

function createTestPlanner(
  resolver: (request: PlannerRequest) => PlannerOutput
): DebugPlannerClient {
  return {
    async plan(request: PlannerRequest): Promise<PlannerOutput> {
      return resolver(request);
    },
    getTrace(): Record<string, unknown> {
      return {
        source: "test_planner"
      };
    }
  };
}

function parsePlannerPayload(request: PlannerRequest): { instruction: string; context: Record<string, unknown> } {
  const userContent = request.messages.find((message) => message.role === "user")?.content ?? "{}";
  const parsed = JSON.parse(userContent) as { instruction?: string; context?: Record<string, unknown> };
  return {
    instruction: typeof parsed.instruction === "string" ? parsed.instruction : "",
    context: typeof parsed.context === "object" && parsed.context !== null ? parsed.context : {}
  };
}

function buildPlannerOutput(
  objective: string,
  tool: string,
  input: Record<string, unknown>,
  overrides: Partial<PlannerOutput> = {}
): PlannerOutput {
  return {
    objective,
    rationale: "Selected by test planner",
    evaluation_previous_goal: "No previous step to evaluate yet",
    memory: [],
    next_goal: objective,
    next_action: {
      tool,
      input
    },
    requires_approval: false,
    expected_transition: "RUNNING",
    global_plan: {
      goal: objective,
      success_criteria: ["Requested result is returned"],
      assumptions: [],
      steps: [
        {
          step_id: "step-1",
          title: objective,
          description: objective,
          completion_signals: ["Tool result advances the task"]
        }
      ],
      current_step_id: "step-1",
      progress_summary: objective
    },
    step_plan: {
      step_id: "step-1",
      current_goal: objective,
      action_plan: [objective],
      completion_signals: ["Tool result advances the task"],
      replan_if: ["Tool fails or page changes unexpectedly"]
    },
    ...overrides
  };
}

function createGenericBrowserTestPlanner(): DebugPlannerClient {
  return createTestPlanner((request) => {
    const { instruction, context } = parsePlannerPayload(request);
    const currentObservation =
      typeof context.current_observation === "object" && context.current_observation !== null
        ? (context.current_observation as Record<string, unknown>)
        : null;
    const lastToolResult =
      typeof context.last_tool_result === "object" && context.last_tool_result !== null
        ? (context.last_tool_result as Record<string, unknown>)
        : null;

    if (!currentObservation) {
      const urlMatch = instruction.match(/https?:\/\/[^\s"'<>]+/i)?.[0] ?? "https://search.example.test";
      return buildPlannerOutput("Open the target page", "open_system", {
        system_id: "web_generic",
        target_url: urlMatch,
        open_if_missing: true
      });
    }

    const pageId = typeof currentObservation.pageId === "string" ? currentObservation.pageId : "";
    const sessionId = typeof currentObservation.sessionId === "string" ? currentObservation.sessionId : undefined;

    if (pageId === "generic_search_home") {
      const interactiveElements = Array.isArray(currentObservation.interactiveElements)
        ? (currentObservation.interactiveElements as Array<Record<string, unknown>>)
        : [];
      const queryInput = interactiveElements.find((element) => element.key === "query");
      const currentValue = typeof queryInput?.value === "string" ? queryInput.value.trim() : "";
      if (currentValue.length === 0) {
        const query = /뉴스/.test(instruction) ? "SK hynix 뉴스" : "하이닉스 주가";
        return buildPlannerOutput("Type the search query", "fill_web_form", {
          system_id: "web_generic",
          session_id: sessionId,
          field_values: { query }
        });
      }
      return buildPlannerOutput("Submit the search", "click_web_element", {
        system_id: "web_generic",
        session_id: sessionId,
        target_key: "search_action"
      });
    }

    if (pageId === "generic_search_results") {
      if (!lastToolResult || lastToolResult.artifact_kind !== "web_result_extraction") {
        return buildPlannerOutput("Read the result list", "extract_web_result", {
          system_id: "web_generic",
          session_id: sessionId,
          goal: instruction,
          query: ""
        });
      }
      return buildPlannerOutput("Open the most relevant result", "click_web_element", {
        system_id: "web_generic",
        session_id: sessionId,
        target_key: "result_1"
      });
    }

    if (pageId === "generic_product_page" || pageId === "generic_news_article" || pageId === "generic_detail_page") {
      if (!lastToolResult || lastToolResult.artifact_kind !== "web_result_extraction") {
        return buildPlannerOutput("Extract the final answer", "extract_web_result", {
          system_id: "web_generic",
          session_id: sessionId,
          goal: instruction,
          query: ""
        });
      }
      return buildPlannerOutput("Finish with the extracted answer", "finish_task", {
        summary:
          typeof lastToolResult.summary === "string" && lastToolResult.summary.trim().length > 0
            ? lastToolResult.summary
            : "Task completed."
      }, {
        expected_transition: "COMPLETED"
      });
    }

    return buildPlannerOutput("Extract the currently visible result", "extract_web_result", {
      system_id: "web_generic",
      session_id: sessionId,
      goal: instruction,
      query: ""
    });
  });
}

test("http api creates, advances, approves, and resumes a shipment case", async () => {
  const app = await createApp();

  const createResponse = await app.inject({
    method: "POST",
    url: "/cases",
    payload: {
      workflow_id: "overseas_equipment_shipment",
      facts: {
        case_id: "CASE-API-001",
        traveler_name: "Kim",
        destination_country: "Germany",
        equipment_list: [{ serial_number: "SN123", asset_tag: "AT-001" }],
        vendor_email: "vendor@example.com",
        due_date: "2026-03-20",
        receiver_address: "Berlin Office"
      }
    }
  });

  assert.equal(createResponse.statusCode, 201);
  const created = createResponse.json();
  const caseId = created.case_id as string;

  const firstAdvance = await app.inject({
    method: "POST",
    url: `/cases/${caseId}/advance`
  });
  assert.equal(firstAdvance.statusCode, 200);
  assert.equal(firstAdvance.json().caseRecord.state, "DRAFT_READY");

  const secondAdvance = await app.inject({
    method: "POST",
    url: `/cases/${caseId}/advance`
  });
  const approvalId = secondAdvance.json().approval.approval_id as string;
  assert.equal(secondAdvance.json().caseRecord.state, "APPROVAL_REQUIRED");

  const approveResponse = await app.inject({
    method: "POST",
    url: `/approvals/${approvalId}/decision`,
    payload: {
      decision: "approve",
      actor: "tester@example.com"
    }
  });
  assert.equal(approveResponse.statusCode, 200);

  const thirdAdvance = await app.inject({
    method: "POST",
    url: `/cases/${caseId}/advance`
  });
  assert.equal(thirdAdvance.json().caseRecord.state, "WAITING_EMAIL");
  const conversationId = thirdAdvance.json().expectation.matcher.conversation_id as string;

  const emailResponse = await app.inject({
    method: "POST",
    url: `/cases/${caseId}/events/email`,
    payload: {
      sender: "vendor@example.com",
      subject: "Re: customs number",
      conversation_id: conversationId,
      extracted_fields: {
        customs_number: "GB-8839-22"
      }
    }
  });
  assert.equal(emailResponse.json().caseRecord.current_step_id, "register_security_portal");
  assert.equal(emailResponse.json().caseRecord.facts.customs_number, "GB-8839-22");

  await app.close();
});

test("http api exposes extension bridge endpoints", async () => {
  const app = await createApp();

  const optionsResponse = await app.inject({
    method: "OPTIONS",
    url: "/bridge/sessions/register",
    headers: {
      origin: "https://internal.example.com",
      "access-control-request-method": "POST",
      "access-control-request-private-network": "true"
    }
  });
  assert.equal(optionsResponse.statusCode, 204);
  assert.equal(optionsResponse.headers["access-control-allow-origin"], "https://internal.example.com");
  assert.equal(optionsResponse.headers["access-control-allow-private-network"], "true");

  await app.close();
});

test("approval ui renders pending approvals and case detail", async () => {
  const app = await createApp();

  const createResponse = await app.inject({
    method: "POST",
    url: "/cases",
    payload: {
      workflow_id: "overseas_equipment_shipment",
      facts: {
        case_id: "CASE-UI-001",
        traveler_name: "Kim",
        destination_country: "Germany",
        equipment_list: [{ serial_number: "SN123", asset_tag: "AT-001" }],
        vendor_email: "vendor@example.com",
        due_date: "2026-03-20",
        receiver_address: "Berlin Office"
      }
    }
  });
  const caseId = createResponse.json().case_id as string;

  await app.inject({
    method: "POST",
    url: `/cases/${caseId}/advance`
  });
  await app.inject({
    method: "POST",
    url: `/cases/${caseId}/advance`
  });

  const approvalsPage = await app.inject({
    method: "GET",
    url: "/ui/approvals"
  });
  assert.equal(approvalsPage.statusCode, 200);
  assert.match(approvalsPage.body, /Approval Center/);
  assert.match(approvalsPage.body, /request_customs_number/);
  assert.match(approvalsPage.body, /Approve/);

  const casePage = await app.inject({
    method: "GET",
    url: `/ui/cases/${caseId}`
  });
  assert.equal(casePage.statusCode, 200);
  assert.match(casePage.body, new RegExp(caseId));
  assert.match(casePage.body, /request_customs_number/);
  assert.match(casePage.body, /vendor@example.com/);

  await app.close();
});

test("debug overview and mail draft endpoints are available", async () => {
  const app = await createApp();

  const overviewResponse = await app.inject({
    method: "GET",
    url: "/debug/overview"
  });
  assert.equal(overviewResponse.statusCode, 200);
  assert.ok(Array.isArray(overviewResponse.json().bridge_sessions));

  const draftResponse = await app.inject({
    method: "POST",
    url: "/debug/mail/draft",
    payload: {
      template_id: "request_customs_number",
      to: ["vendor@example.com"],
      variables: {
        traveler_name: "Kim"
      }
    }
  });
  assert.equal(draftResponse.statusCode, 200);
  assert.equal(draftResponse.json().success, true);
  assert.equal(draftResponse.json().output.artifact_kind, "mail_draft");

  const searchResponse = await app.inject({
    method: "POST",
    url: "/debug/mail/search",
    payload: {
      keyword: "ae school",
      max_results: 10
    }
  });
  assert.equal(searchResponse.statusCode, 200);
  assert.equal(searchResponse.json().success, true);
  assert.equal(searchResponse.json().output.artifact_kind, "mail_search");

  await app.close();
});

test("debug web open can read a registered extension bridge session", async () => {
  browserBridgeCoordinator.reset();
  const previousAdapter = process.env.WEB_WORKER_ADAPTER;
  process.env.WEB_WORKER_ADAPTER = "extension_bridge";
  const app = await createApp();

  await app.inject({
    method: "POST",
    url: "/bridge/sessions/register",
    payload: {
      session_id: "debug-session-1",
      system_id: "security_portal",
      title: "Export Registration",
      url: "https://security.internal/export-registration"
    }
  });

  await app.inject({
    method: "POST",
    url: "/bridge/sessions/debug-session-1/snapshot",
    payload: {
      channel: "web",
      summary: "Security export registration form is open.",
      payload: {
        systemId: "security_portal",
        pageId: "export_registration",
        url: "https://security.internal/export-registration",
        title: "Export Registration",
        finalActionButton: "등록",
        interactiveElements: []
      }
    }
  });

  const openResponse = await app.inject({
    method: "POST",
    url: "/debug/web/open",
    payload: {
      system_id: "security_portal"
    }
  });

  assert.equal(openResponse.statusCode, 200);
  assert.equal(openResponse.json().success, true);
  assert.equal(openResponse.json().output.harness, "extension_bridge");

  await app.close();
  process.env.WEB_WORKER_ADAPTER = previousAdapter;
  browserBridgeCoordinator.reset();
});

test("extension bootstrap endpoint exposes web system definitions", async () => {
  const app = await createApp();

  const response = await app.inject({
    method: "GET",
    url: "/bridge/extension-bootstrap"
  });

  assert.equal(response.statusCode, 200);
  assert.ok(Array.isArray(response.json().systems));
  assert.ok(response.json().systems.some((system: { system_id: string }) => system.system_id === "web_generic"));
  assert.ok(response.json().systems.some((system: { system_id: string }) => system.system_id === "security_portal"));

  await app.close();
});

test("debug agent can route a natural language mail draft instruction", async () => {
  const app = await createApp(undefined, {
    debugPlanner: createTestPlanner(() =>
      buildPlannerOutput("Draft the requested mail", "draft_outlook_mail", {
        template_id: "request_customs_number",
        to: ["vendor@example.com"],
        variables: {
          traveler_name: "Kim"
        }
      })
    )
  });

  const response = await app.inject({
    method: "POST",
    url: "/debug/agent/run",
    payload: {
      instruction: "메일 초안을 작성해줘",
      context: {
        template_id: "request_customs_number",
        to: ["vendor@example.com"],
        variables: {
          traveler_name: "Kim"
        }
      }
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().planner_output.next_action.tool, "draft_outlook_mail");
  assert.equal(response.json().tool_result.success, true);
  assert.equal(response.json().tool_result.output.artifact_kind, "mail_draft");

  await app.close();
});

test("debug agent loop can complete a multi-step web interaction", async () => {
  const previousAdapter = process.env.WEB_WORKER_ADAPTER;
  delete process.env.WEB_WORKER_ADAPTER;
  const app = await createApp(undefined, {
    debugPlanner: createGenericBrowserTestPlanner()
  });

  const response = await app.inject({
    method: "POST",
    url: "/debug/agent/run-loop",
    payload: {
      instruction: "https://search.example.test 에 접속해서 하이닉스 주가를 검색하고 지금 주가를 알려줘",
      context: {}
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, true);
  assert.equal(response.json().completed, true);
  assert.ok(Array.isArray(response.json().steps));
  assert.deepEqual(response.json().steps.map((step: { tool: string }) => step.tool), [
    "open_system",
    "fill_web_form",
    "click_web_element",
    "extract_web_result",
    "click_web_element",
    "extract_web_result"
  ]);
  assert.match(String(response.json().final_response), /하이닉스|SK hynix/i);

  await app.close();
  process.env.WEB_WORKER_ADAPTER = previousAdapter;
});

test("debug agent loop can read stock result from a direct naver stock page", async () => {
  const previousAdapter = process.env.WEB_WORKER_ADAPTER;
  delete process.env.WEB_WORKER_ADAPTER;
  const app = await createApp(undefined, {
    debugPlanner: createGenericBrowserTestPlanner()
  });

  const response = await app.inject({
    method: "POST",
    url: "/debug/agent/run-loop",
    payload: {
      instruction: "https://example.com/products/sk-hynix 페이지를 열고 현재 하이닉스 가격을 알려줘",
      context: {}
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, true);
  assert.equal(response.json().completed, true);
  assert.deepEqual(response.json().steps.map((step: { tool: string }) => step.tool), ["open_system", "extract_web_result"]);
  assert.match(String(response.json().final_result.stock_result.company), /하이닉스|SK hynix/i);
  assert.match(String(response.json().final_response), /하이닉스|SK hynix/i);

  await app.close();
  process.env.WEB_WORKER_ADAPTER = previousAdapter;
});

test("debug agent loop decodes base64 Korean instruction and query payloads", async () => {
  const previousAdapter = process.env.WEB_WORKER_ADAPTER;
  delete process.env.WEB_WORKER_ADAPTER;
  const app = await createApp(undefined, {
    debugPlanner: createGenericBrowserTestPlanner()
  });

  const response = await app.inject({
    method: "POST",
    url: "/debug/agent/run-loop",
    payload: {
      instruction_base64: "aHR0cHM6Ly9zZWFyY2guZXhhbXBsZS50ZXN0IOyXkCDsoJHsho3tlbTshJwg7ZWY7J2064uJ7IqkIOyjvOqwgOulvCDqsoDsg4ntlZjqs6Ag7KeA6riIIOyjvOqwgOulvCDslYzroKTspJg=",
      context: {}
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, true);
  assert.equal(response.json().completed, true);
  assert.match(String(response.json().final_response), /하이닉스|SK hynix/i);

  await app.close();
  process.env.WEB_WORKER_ADAPTER = previousAdapter;
});

test("debug agent loop can click a search result and read a news headline", async () => {
  const previousAdapter = process.env.WEB_WORKER_ADAPTER;
  delete process.env.WEB_WORKER_ADAPTER;
  const app = await createApp(undefined, {
    debugPlanner: createGenericBrowserTestPlanner()
  });

  const response = await app.inject({
    method: "POST",
    url: "/debug/agent/run-loop",
    payload: {
      instruction: "https://search.example.test 에 접속해서 SK hynix 뉴스를 검색하고 가장 관련 높은 결과를 열어서 핵심 내용을 알려줘",
      context: {}
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, true);
  assert.equal(response.json().completed, true);
  assert.ok(response.json().steps.filter((step: { tool: string }) => step.tool === "click_web_element").length >= 2);
  assert.match(String(response.json().final_response), /SK hynix|시장 반응|동향/i);

  await app.close();
  process.env.WEB_WORKER_ADAPTER = previousAdapter;
});

test("llm config resolves from opencode.ai config file", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "skh-agent-llm-"));
  const configDir = path.join(tempDir, "opencode.ai");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, "config.json"),
    JSON.stringify({
      llm: {
        base_url: "https://common.llm.skhynix.com/v1",
        apiKey: "test-key",
        model: "GLM-4.7"
      }
    })
  );

  const resolved = resolveLlmConfig(tempDir);
  assert.equal(resolved.source, "file");
  assert.equal(resolved.baseUrl, "https://common.llm.skhynix.com/v1");
  assert.equal(resolved.model, "GLM-4.7");
  assert.equal(resolved.apiKey, "test-key");
});

test("llm config resolves from opencode provider config file", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "skh-agent-llm-provider-"));
  const configDir = path.join(tempDir, "opencode.ai");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, "config.json"),
    JSON.stringify({
      provider: {
        name: "GLM-4.7",
        npm: "@ai-sdk/openai-compatible",
        models: {
          "GLM-4.7": {
            name: "GLM-4.7"
          }
        },
        options: {
          apiKey: "provider-test-key",
          baseURL: "http://common.llm.skhynix.com/v1"
        }
      }
    })
  );

  const resolved = resolveLlmConfig(tempDir);
  assert.equal(resolved.source, "file");
  assert.equal(resolved.baseUrl, "http://common.llm.skhynix.com/v1");
  assert.equal(resolved.model, "GLM-4.7");
  assert.equal(resolved.apiKey, "provider-test-key");
});

test("llm config falls back safely on malformed config file", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "skh-agent-llm-bad-"));
  const configDir = path.join(tempDir, "opencode.ai");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, "config.json"), "| not valid json");

  const resolved = resolveLlmConfig(tempDir);
  assert.equal(resolved.source, "none");
  assert.equal(resolved.baseUrl, "");
  assert.match(resolved.error ?? "", /json|unexpected token|not valid json/i);
});
