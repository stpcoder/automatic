import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { browserBridgeCoordinator } from "../../../packages/browser-bridge/src/index.js";
import { createApp } from "./app.js";
import { resolveLlmConfig } from "./llm-config.js";

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

test("http api exposes bookmarklet bridge endpoints", async () => {
  const app = await createApp();

  const bookmarkletResponse = await app.inject({
    method: "GET",
    url: "/bridge/bookmarklet?systemId=security_portal"
  });
  assert.equal(bookmarkletResponse.statusCode, 200);
  assert.equal(bookmarkletResponse.json().system_id, "security_portal");

  const scriptResponse = await app.inject({
    method: "GET",
    url: "/bridge/bookmarklet.js?systemId=security_portal"
  });
  assert.equal(scriptResponse.statusCode, 200);
  assert.match(scriptResponse.body, /SKH agent bridge/i);

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

test("debug web open can read a registered bookmarklet session", async () => {
  browserBridgeCoordinator.reset();
  const previousAdapter = process.env.WEB_WORKER_ADAPTER;
  process.env.WEB_WORKER_ADAPTER = "bookmarklet_bridge";
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
  assert.equal(openResponse.json().output.harness, "bookmarklet_bridge");

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
  assert.ok(response.json().systems.some((system: { system_id: string }) => system.system_id === "naver_search"));
  assert.ok(response.json().systems.some((system: { system_id: string }) => system.system_id === "naver_stock"));

  await app.close();
});

test("debug agent can route a natural language mail draft instruction", async () => {
  const app = await createApp();

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
  const app = await createApp();

  const response = await app.inject({
    method: "POST",
    url: "/debug/agent/run-loop",
    payload: {
      instruction: "Open Naver search and search for SK hynix stock price",
      context: {
        system_id: "naver_search",
        field_values: {
          query: "SK hynix stock price"
        },
        expected_button: "search"
      },
      max_steps: 6
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, true);
  assert.equal(response.json().completed, true);
  assert.ok(Array.isArray(response.json().steps));
  assert.deepEqual(
    response.json().steps.map((step: { tool: string }) => step.tool),
    ["open_system", "fill_web_form", "click_web_element", "extract_web_result"]
  );
  assert.match(String(response.json().final_response), /SK hynix/i);

  await app.close();
  process.env.WEB_WORKER_ADAPTER = previousAdapter;
});

test("debug agent loop can read stock result from a direct naver stock page", async () => {
  const previousAdapter = process.env.WEB_WORKER_ADAPTER;
  delete process.env.WEB_WORKER_ADAPTER;
  const app = await createApp();

  const response = await app.inject({
    method: "POST",
    url: "/debug/agent/run-loop",
    payload: {
      instruction: "Read SK hynix stock result from the current Naver stock page",
      context: {
        system_id: "naver_stock"
      },
      max_steps: 4
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, true);
  assert.equal(response.json().completed, true);
  assert.deepEqual(
    response.json().steps.map((step: { tool: string }) => step.tool),
    ["open_system", "extract_web_result"]
  );
  assert.equal(response.json().final_result.stock_result.company, "SK hynix");

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
