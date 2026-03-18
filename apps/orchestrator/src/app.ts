import Fastify, { type FastifyInstance } from "fastify";

import {
  browserBridgeCoordinator,
  completeExtensionBrowserTask,
  pullPendingExtensionBrowserTasks
} from "../../../packages/browser-bridge/src/index.js";
import type { PlannerOutput } from "../../../packages/contracts/src/index.js";
import { approvalDecisionInputSchema, createCaseInputSchema, incomingEmailPayloadSchema } from "../../../packages/contracts/src/index.js";
import { OutlookWorker } from "../../../workers/outlook-worker/src/index.js";
import { OutlookComAdapter } from "../../../workers/outlook-worker/src/outlook-com-adapter.js";
import { HttpOutlookReplyEventSink, OutlookReplyPoller } from "../../../workers/outlook-worker/src/reply-poller.js";
import { getWebSystemDefinition, listWebSystemDefinitions } from "../../../workers/web-worker/src/system-definitions.js";
import { WebWorker } from "../../../workers/web-worker/src/index.js";
import { buildDebugLoopPlannerRequest, buildDebugPlannerRequest, createDebugPlanner, type DebugPlannerClient } from "./debug-agent.js";
import { resolveLlmConfig } from "./llm-config.js";
import { OrchestratorService } from "./orchestrator.js";
import { renderApprovalsPage, renderCaseDetailPage } from "./ui.js";

export async function createApp(
  orchestrator?: OrchestratorService,
  options: { debugPlanner?: DebugPlannerClient } = {}
): Promise<FastifyInstance> {
  const resolvedOrchestrator = orchestrator ?? (await OrchestratorService.createDefault());
  const app = Fastify({ logger: false });
  const defaultPort = process.env.ORCHESTRATOR_PORT ?? "43117";
  const defaultHost = `127.0.0.1:${defaultPort}`;
  const webWorker = new WebWorker();
  const outlookWorker = new OutlookWorker();
  const debugPlanner = options.debugPlanner ?? createDebugPlanner();
  const llmConfig = resolveLlmConfig();

  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    if (typeof origin === "string" && origin.length > 0) {
      reply.header("access-control-allow-origin", origin);
      reply.header("vary", "origin");
    } else {
      reply.header("access-control-allow-origin", "*");
    }
    reply.header("access-control-allow-methods", "GET,POST,OPTIONS");
    reply.header("access-control-allow-headers", "content-type");
    reply.header("access-control-allow-private-network", "true");

    if (request.method === "OPTIONS") {
      reply.code(204).send();
    }
  });

  app.get("/health", async () => ({ ok: true }));

  app.get("/ui", async (_request, reply) => {
    reply.redirect("/ui/approvals");
  });

  app.get("/ui/approvals", async (_request, reply) => {
    reply.header("content-type", "text/html; charset=utf-8");
    return renderApprovalsPage(resolvedOrchestrator.listApprovals());
  });

  app.get("/ui/cases/:caseId", async (request, reply) => {
    const params = request.params as { caseId: string };
    reply.header("content-type", "text/html; charset=utf-8");
    return renderCaseDetailPage({
      caseRecord: resolvedOrchestrator.getCase(params.caseId),
      approvals: resolvedOrchestrator.listApprovals(params.caseId),
      artifacts: resolvedOrchestrator.listArtifacts(params.caseId),
      events: resolvedOrchestrator.listEvents(params.caseId)
    });
  });

  app.get("/bridge/sessions", async () => browserBridgeCoordinator.listSessions());

  app.get("/bridge/extension/tasks", async () => pullPendingExtensionBrowserTasks());

  app.post("/bridge/extension/tasks/:taskId/result", async (request) => {
    const params = request.params as { taskId: string };
    const body = request.body as { success: boolean; result?: Record<string, unknown>; error?: string };
    return completeExtensionBrowserTask(params.taskId, body);
  });

  app.get("/bridge/extension-bootstrap", async (request) => {
    const host = request.headers.host ?? defaultHost;
    return {
      server_origin: `http://${host}`,
      systems: listWebSystemDefinitions().map((definition) => ({
        system_id: definition.systemId,
        title: definition.title,
        url_patterns: definition.urlPatterns ?? [],
        final_action_button: definition.finalActionButton ?? "Submit",
        fields: definition.fields,
        buttons: definition.buttons,
        result_indicators: definition.resultIndicators ?? []
      }))
    };
  });

  app.get("/debug/overview", async () => ({
    web_adapter: process.env.WEB_WORKER_ADAPTER ?? "page_agent_dom",
    outlook_adapter: process.env.OUTLOOK_WORKER_ADAPTER ?? "fake",
    cube_adapter: process.env.CUBE_WORKER_ADAPTER ?? "fake",
    orchestrator_base_url: process.env.ORCHESTRATOR_BASE_URL ?? `http://${defaultHost}`,
    llm: {
      enabled: Boolean(llmConfig.baseUrl && llmConfig.apiKey && llmConfig.model),
      source: llmConfig.source,
      base_url: llmConfig.baseUrl,
      model: llmConfig.model,
      config_path: llmConfig.configPath,
      error: llmConfig.error
    },
    bridge_sessions: browserBridgeCoordinator.listSessions()
  }));

  app.post("/debug/web/open", async (request) => {
    const body = request.body as { system_id?: string; page_id?: string };
    return webWorker.execute(buildDebugToolRequest("open_system", "preview", {
      system_id: body.system_id ?? "security_portal",
      page_id: body.page_id
    }));
  });

  app.post("/debug/web/fill", async (request) => {
    const rawBody = request.body as { system_id?: string; session_id?: string; field_values?: Record<string, unknown> };
    const body = decodePayloadStrings(rawBody) as { system_id?: string; session_id?: string; field_values?: Record<string, unknown> };
    return webWorker.execute(buildDebugToolRequest("fill_web_form", "draft", {
      system_id: body.system_id ?? "security_portal",
      session_id: body.session_id,
      field_values: body.field_values ?? {}
    }));
  });

  app.post("/debug/web/read", async (request) => {
    const body = request.body as { system_id?: string; session_id?: string };
    return webWorker.execute(buildDebugToolRequest("read_web_page", "preview", {
      system_id: body.system_id ?? "web_generic",
      session_id: body.session_id
    }));
  });

  app.post("/debug/web/click", async (request) => {
    const body = request.body as { system_id?: string; session_id?: string; target_key?: string };
    return webWorker.execute(buildDebugToolRequest("click_web_element", "preview", {
      system_id: body.system_id ?? "security_portal",
      session_id: body.session_id,
      target_key: body.target_key ?? "submit"
    }));
  });

  app.post("/debug/web/follow", async (request) => {
    const body = request.body as { system_id?: string; session_id?: string };
    return webWorker.execute(buildDebugToolRequest("follow_web_navigation", "preview", {
      system_id: body.system_id ?? "security_portal",
      session_id: body.session_id
    }));
  });

  app.post("/debug/web/preview", async (request) => {
    const body = request.body as { system_id?: string; session_id?: string };
    return webWorker.execute(buildDebugToolRequest("preview_web_submission", "preview", {
      system_id: body.system_id ?? "security_portal",
      session_id: body.session_id
    }));
  });

  app.post("/debug/web/submit", async (request) => {
    const body = request.body as { system_id?: string; session_id?: string; expected_button?: string };
    return webWorker.execute(buildDebugToolRequest("submit_web_form", "commit", {
      system_id: body.system_id ?? "security_portal",
      session_id: body.session_id,
      expected_button: body.expected_button ?? "Submit"
    }));
  });

  app.post("/debug/mail/draft", async (request) => {
    const body = request.body as {
      template_id?: string;
      to?: string[];
      cc?: string[];
      variables?: Record<string, unknown>;
    };
    return outlookWorker.execute(buildDebugToolRequest("draft_outlook_mail", "draft", {
      template_id: body.template_id ?? "debug_template",
      to: body.to ?? [],
      cc: body.cc ?? [],
      variables: body.variables ?? {}
    }));
  });

  app.post("/debug/mail/send", async (request) => {
    const body = request.body as { draft_id?: string };
    return outlookWorker.execute(buildDebugToolRequest("send_outlook_mail", "commit", {
      draft_id: body.draft_id ?? ""
    }));
  });

  app.post("/debug/mail/read", async (request) => {
    const body = request.body as { entry_id?: string; conversation_id?: string };
    return outlookWorker.execute(buildDebugToolRequest("read_outlook_mail", "preview", {
      entry_id: body.entry_id ?? "",
      conversation_id: body.conversation_id ?? ""
    }));
  });

  app.post("/debug/mail/conversation", async (request) => {
    const body = request.body as { conversation_id?: string; max_messages?: number };
    return outlookWorker.execute(buildDebugToolRequest("read_outlook_conversation", "preview", {
      conversation_id: body.conversation_id ?? "",
      max_messages: body.max_messages ?? 20
    }));
  });

  app.post("/debug/mail/reply", async (request) => {
    const body = request.body as {
      entry_id?: string;
      conversation_id?: string;
      body_text?: string;
      body_html?: string;
      reply_all?: boolean;
    };
    return outlookWorker.execute(buildDebugToolRequest("reply_outlook_mail", "draft", {
      entry_id: body.entry_id ?? "",
      conversation_id: body.conversation_id ?? "",
      body_text: body.body_text ?? "",
      body_html: body.body_html ?? "",
      reply_all: body.reply_all === true
    }));
  });

  app.post("/debug/mail/update-draft", async (request) => {
    const body = request.body as {
      draft_id?: string;
      subject?: string;
      to?: string[];
      cc?: string[];
      body_text?: string;
      body_html?: string;
    };
    return outlookWorker.execute(buildDebugToolRequest("update_outlook_draft", "draft", {
      draft_id: body.draft_id ?? "",
      subject: body.subject,
      to: body.to,
      cc: body.cc,
      body_text: body.body_text,
      body_html: body.body_html
    }));
  });

  app.post("/debug/mail/preview-draft", async (request) => {
    const body = request.body as { draft_id?: string };
    return outlookWorker.execute(buildDebugToolRequest("preview_outlook_draft", "preview", {
      draft_id: body.draft_id ?? ""
    }));
  });

  app.post("/debug/mail/watch", async (request) => {
    const body = request.body as {
      case_id?: string;
      conversation_id?: string;
      expected_from?: string[];
      required_fields?: string[];
      keyword_contains?: string[];
    };
    return outlookWorker.execute(buildDebugToolRequest("watch_email_reply", "preview", {
      case_id: body.case_id ?? "DEBUG-CASE",
      conversation_id: body.conversation_id ?? "",
      expected_from: body.expected_from ?? [],
      required_fields: body.required_fields ?? [],
      keyword_contains: body.keyword_contains ?? []
    }));
  });

  app.post("/debug/mail/await", async (request) => {
    const body = request.body as {
      case_id?: string;
      conversation_id?: string;
      expected_from?: string[];
      required_fields?: string[];
      keyword_contains?: string[];
      watch_directory?: string;
      timeout_seconds?: number;
      poll_interval_ms?: number;
    };
    return outlookWorker.execute(buildDebugToolRequest("await_email_reply", "preview", {
      case_id: body.case_id ?? "DEBUG-CASE",
      conversation_id: body.conversation_id ?? "",
      expected_from: body.expected_from ?? [],
      required_fields: body.required_fields ?? [],
      keyword_contains: body.keyword_contains ?? [],
      watch_directory: body.watch_directory ?? "",
      timeout_seconds: body.timeout_seconds,
      poll_interval_ms: body.poll_interval_ms
    }));
  });

  app.post("/debug/mail/search", async (request) => {
    const body = request.body as { keyword?: string; max_results?: number };
    return outlookWorker.execute(buildDebugToolRequest("search_outlook_mail", "preview", {
      keyword: body.keyword ?? "",
      max_results: body.max_results ?? 10
    }));
  });

  app.post("/debug/mail/search-contacts", async (request) => {
    const body = request.body as { query?: string; max_results?: number };
    return outlookWorker.execute(buildDebugToolRequest("search_outlook_contacts", "preview", {
      query: body.query ?? "",
      max_results: body.max_results ?? 10
    }));
  });

  app.post("/debug/mail/poll-once", async (request) => {
    const body = request.body as { watch_directory?: string };
    const poller = new OutlookReplyPoller(new OutlookComAdapter(), new HttpOutlookReplyEventSink(), {
      watchDirectory: body.watch_directory
    });
    return poller.runOnce();
  });

  app.post("/debug/agent/run", async (request) => {
    const rawBody = request.body as { instruction?: string; context?: Record<string, unknown> };
    const body = decodePayloadStrings(rawBody) as { instruction?: string; context?: Record<string, unknown> };
    const instruction = typeof body.instruction === "string" ? body.instruction : "";
    const context = typeof body.context === "object" && body.context !== null ? body.context : {};
    const plannerRequest = buildDebugPlannerRequest(instruction, context, [
      {
        name: "open_system",
        description: "Open or attach to a web page. You may specify target_url, url_contains, title_contains, or session_id.",
        input_schema: {
          system_id: { type: "string" },
          page_id: { type: "string" },
          target_url: { type: "string" },
          url_contains: { type: "string" },
          title_contains: { type: "string" },
          session_id: { type: "string" },
          open_if_missing: { type: "boolean" }
        }
      },
      {
        name: "read_web_page",
        description: "Read the current page DOM, visible text, semantic blocks, and interactive elements without deciding success yet.",
        input_schema: { system_id: { type: "string" }, session_id: { type: "string" } }
      },
      {
        name: "fill_web_form",
        description: "Enter text or set detected field values on the current page. Use session_id when available.",
        input_schema: { system_id: { type: "string" }, session_id: { type: "string" }, field_values: { type: "object" } }
      },
      {
        name: "click_web_element",
        description: "Click a specific button or clickable control on the active web system. Prefer target_handle from domOutline when available.",
        input_schema: { system_id: { type: "string" }, session_id: { type: "string" }, target_key: { type: "string" }, target_handle: { type: "string" } }
      },
      {
        name: "scroll_web_page",
        description: "Scroll the current page up or down to reveal more content.",
        input_schema: {
          system_id: { type: "string" },
          session_id: { type: "string" },
          direction: { type: "string" },
          amount: { type: "number" }
        }
      },
      {
        name: "navigate_browser_history",
        description: "Go back or forward in the current browser tab history when you need to return to the previous page.",
        input_schema: {
          system_id: { type: "string" },
          session_id: { type: "string" },
          direction: { type: "string" }
        }
      },
      {
        name: "preview_web_submission",
        description: "Preview the current web submission state.",
        input_schema: { system_id: { type: "string" } }
      },
      {
        name: "submit_web_form",
        description: "Click the final submit button on the active web system.",
        input_schema: { system_id: { type: "string" }, expected_button: { type: "string" } }
      },
      {
        name: "draft_outlook_mail",
        description: "Create an Outlook mail draft with recipients and optional subject/body.",
        input_schema: {
          template_id: { type: "string" },
          to: { type: "array" },
          cc: { type: "array" },
          variables: { type: "object" },
          subject: { type: "string" },
          body_text: { type: "string" },
          body_html: { type: "string" }
        }
      },
      {
        name: "send_outlook_mail",
        description: "Send a drafted Outlook mail.",
        input_schema: { draft_id: { type: "string" } }
      },
      {
        name: "read_outlook_mail",
        description: "Read a specific Outlook mail by entry_id or latest message from a conversation_id.",
        input_schema: { entry_id: { type: "string" }, conversation_id: { type: "string" } }
      },
      {
        name: "read_outlook_conversation",
        description: "Read the messages in an Outlook conversation thread.",
        input_schema: { conversation_id: { type: "string" }, max_messages: { type: "number" } }
      },
      {
        name: "reply_outlook_mail",
        description: "Create a reply draft for an Outlook mail or conversation.",
        input_schema: {
          entry_id: { type: "string" },
          conversation_id: { type: "string" },
          body_text: { type: "string" },
          body_html: { type: "string" },
          reply_all: { type: "boolean" }
        }
      },
      {
        name: "update_outlook_draft",
        description: "Update an Outlook draft's subject, recipients, or body.",
        input_schema: {
          draft_id: { type: "string" },
          subject: { type: "string" },
          to: { type: "array" },
          cc: { type: "array" },
          body_text: { type: "string" },
          body_html: { type: "string" }
        }
      },
      {
        name: "preview_outlook_draft",
        description: "Preview an Outlook draft before sending it.",
        input_schema: { draft_id: { type: "string" } }
      },
    {
      name: "watch_email_reply",
      description: "Watch for a matching reply in Outlook.",
      input_schema: {
        case_id: { type: "string" },
        conversation_id: { type: "string" },
        expected_from: { type: "array" },
        required_fields: { type: "array" },
        keyword_contains: { type: "array" }
      }
    },
    {
      name: "await_email_reply",
      description: "Wait for a matching Outlook reply and return it when it arrives.",
      input_schema: {
        case_id: { type: "string" },
        conversation_id: { type: "string" },
        expected_from: { type: "array" },
        required_fields: { type: "array" },
        keyword_contains: { type: "array" },
        timeout_seconds: { type: "number" },
        poll_interval_ms: { type: "number" }
      }
    },
      {
        name: "search_outlook_mail",
        description: "Search Outlook mail by keyword.",
        input_schema: {
          keyword: { type: "string" },
          max_results: { type: "number" }
        }
      },
      {
        name: "search_outlook_contacts",
        description: "Search recent mail participants and the organizational directory by person, team, or email query.",
        input_schema: {
          query: { type: "string" },
          max_results: { type: "number" }
        }
      }
    ]);
    const startedAt = Date.now();
    const timing = {
      total_ms: 0,
      planner_ms: 0,
      tool_ms: 0
    };
    logDebugAgentStart("run", instruction, context);
    try {
      const plannerStartedAt = Date.now();
      const plannerOutput = await debugPlanner.plan(plannerRequest);
      timing.planner_ms = Date.now() - plannerStartedAt;
      const normalizedInput = normalizeDebugToolInput(plannerOutput.next_action.tool, plannerOutput.next_action.input, context, instruction);
      logDebugPlannerDecision("run", 1, plannerOutput, plannerOutput.next_action.tool, normalizedInput, debugPlanner.getTrace());

      const toolStartedAt = Date.now();
      if (isSendBlockedWithoutApproval(plannerOutput.next_action.tool, context)) {
        const errorMessage = "Sending is blocked until context.approved_to_send is true.";
        timing.tool_ms = Date.now() - toolStartedAt;
        timing.total_ms = Date.now() - startedAt;
        logDebugAgentFailure("run", 1, { code: "approval_required", message: errorMessage }, timing);
        return {
          ok: false,
          error_stage: "approval_required",
          error_code: "approval_required",
          error_message: errorMessage,
          timing,
          debug_trace: {
            planner_request: plannerRequest,
            planner_trace: debugPlanner.getTrace(),
            planner_output: plannerOutput,
            normalized_input: normalizedInput
          }
        };
      }
      const toolResult =
        isWebDebugTool(plannerOutput.next_action.tool)
          ? await webWorker.execute(buildDebugToolRequest(plannerOutput.next_action.tool, "preview", normalizedInput))
          : await outlookWorker.execute(buildDebugToolRequest(plannerOutput.next_action.tool, "draft", normalizedInput));
      timing.tool_ms = Date.now() - toolStartedAt;
      timing.total_ms = Date.now() - startedAt;
      logDebugToolResult("run", 1, toolResult, timing);

      const debugTrace = {
        planner_request: plannerRequest,
        planner_trace: debugPlanner.getTrace(),
        planner_output: plannerOutput,
        normalized_input: normalizedInput,
        tool_result: toolResult,
        timing
      };

      return {
        ok: true,
        planner_output: plannerOutput,
        tool_result: toolResult,
        timing,
        debug_trace: debugTrace
      };
    } catch (error) {
      const classifiedError = classifyDebugError(error);
      timing.total_ms = Date.now() - startedAt;
      logDebugAgentFailure("run", 1, classifiedError, timing);
      const debugTrace = {
        planner_request: plannerRequest,
        planner_trace: debugPlanner.getTrace(),
        normalized_input: normalizeDebugToolInput("unknown", {}, context, instruction),
        error_code: classifiedError.code,
        error_message: classifiedError.message,
        timing
      };
      return {
        ok: false,
        error_stage: "debug_agent_run",
        error_code: classifiedError.code,
        error_message: classifiedError.message,
        timing,
        debug_trace: debugTrace,
        llm: {
          enabled: Boolean(llmConfig.baseUrl && llmConfig.apiKey && llmConfig.model),
          source: llmConfig.source,
          base_url: llmConfig.baseUrl,
          model: llmConfig.model,
          config_path: llmConfig.configPath,
          config_error: llmConfig.error
        }
      };
    }
  });

  app.post("/debug/agent/run-loop", async (request) => {
    const rawBody = request.body as { instruction?: string; context?: Record<string, unknown> };
    const body = decodePayloadStrings(rawBody) as { instruction?: string; context?: Record<string, unknown> };
    const instruction = typeof body.instruction === "string" ? body.instruction : "";
    const context = typeof body.context === "object" && body.context !== null ? body.context : {};
    const maxSteps = Number(process.env.DEBUG_AGENT_INTERNAL_MAX_STEPS ?? "24");
    const tools = buildDebugToolSpecs();
    let currentObservation: Record<string, unknown> | undefined;
    let previousObservation: Record<string, unknown> | undefined;
    let lastToolResult: Record<string, unknown> | undefined;
    let globalPlan: Record<string, unknown> | undefined;
    let currentStepPlan: Record<string, unknown> | undefined;
    let lastFailure: Record<string, unknown> | undefined;
    let currentObservationSignature: string | undefined;
    let stagnationCount = 0;
    const steps: Array<Record<string, unknown>> = [];
    const planHistory: Array<Record<string, unknown>> = [];
    const replanHistory: Array<Record<string, unknown>> = [];
    const startedAt = Date.now();
    logDebugAgentStart("run-loop", instruction, context);

    for (let stepIndex = 1; stepIndex <= maxSteps; stepIndex += 1) {
      const loopContext = {
        ...context,
        current_observation: summarizeObservationForPlanner(currentObservation) ?? null,
        previous_observation: summarizePreviousObservationForPlanner(previousObservation) ?? null,
        current_observation_signature: currentObservationSignature ?? null,
        last_tool_result: summarizeToolResultForPlanner(lastToolResult) ?? null,
        mail_evidence: summarizeMailEvidenceForPlanner(steps, lastToolResult) ?? null,
        contact_evidence: summarizeContactEvidenceForPlanner(steps, lastToolResult) ?? null,
        draft_evidence: summarizeDraftEvidenceForPlanner(steps, lastToolResult) ?? null,
        global_plan: globalPlan ?? null,
        current_step_plan: currentStepPlan ?? null,
        last_failure: lastFailure ?? null,
        stagnation_count: stagnationCount,
        replan_history: replanHistory.slice(-3),
        plan_history: planHistory.slice(-3),
        step_history: steps.slice(-4).map((step) => ({
          step: step.step,
          tool: step.tool,
          success: step.success
        }))
      };
      const plannerRequest = buildDebugLoopPlannerRequest(instruction, loopContext, tools);
      const stepTiming = {
        planner_ms: 0,
        tool_ms: 0
      };

      let plannerOutput: PlannerOutput;
      try {
        const plannerStartedAt = Date.now();
        plannerOutput = await debugPlanner.plan(plannerRequest);
        stepTiming.planner_ms = Date.now() - plannerStartedAt;
      } catch (error) {
        const classifiedError = classifyDebugError(error);
        logDebugAgentFailure("run-loop", stepIndex, classifiedError, {
          total_ms: Date.now() - startedAt
        });
        return {
          ok: false,
          completed: false,
          error_stage: "planner_execution",
          error_code: classifiedError.code,
          error_message: classifiedError.message,
          steps,
          timing: {
            total_ms: Date.now() - startedAt
          },
          debug_trace: {
            planner_trace: debugPlanner.getTrace(),
            error_code: classifiedError.code
          }
        };
      }

      globalPlan =
        plannerOutput.global_plan && typeof plannerOutput.global_plan === "object"
          ? (plannerOutput.global_plan as Record<string, unknown>)
          : globalPlan;
      currentStepPlan =
        plannerOutput.step_plan && typeof plannerOutput.step_plan === "object"
          ? (plannerOutput.step_plan as Record<string, unknown>)
          : currentStepPlan;
      planHistory.push({
        step: stepIndex,
        objective: plannerOutput.objective,
        evaluation_previous_goal: plannerOutput.evaluation_previous_goal,
        memory: plannerOutput.memory,
        next_goal: plannerOutput.next_goal,
        global_plan: globalPlan ?? null,
        step_plan: currentStepPlan ?? null
      });

      const normalizedInput = normalizeDebugToolInput(plannerOutput.next_action.tool, plannerOutput.next_action.input, loopContext, instruction);
      logDebugPlannerDecision("run-loop", stepIndex, plannerOutput, plannerOutput.next_action.tool, normalizedInput, debugPlanner.getTrace());

      if (plannerOutput.next_action.tool === "finish_task") {
        logDebugAgentFinish(
          "run-loop",
          stepIndex,
          typeof normalizedInput.summary === "string" ? normalizedInput.summary : "Task completed.",
          { total_ms: Date.now() - startedAt }
        );
        return {
          ok: true,
          completed: true,
          final_response: typeof normalizedInput.summary === "string" ? normalizedInput.summary : "Task completed.",
          final_result: lastToolResult ?? null,
          global_plan: globalPlan ?? null,
          current_step_plan: currentStepPlan ?? null,
          steps,
          timing: {
            total_ms: Date.now() - startedAt
          },
          debug_trace: {
            planner_request: plannerRequest,
            planner_trace: debugPlanner.getTrace(),
            planner_output: plannerOutput,
            normalized_input: normalizedInput
          }
        };
      }

      try {
        const toolStartedAt = Date.now();
        if (isSendBlockedWithoutApproval(plannerOutput.next_action.tool, loopContext)) {
          const blockedMessage = "Sending is blocked until context.approved_to_send is true.";
          stepTiming.tool_ms = Date.now() - toolStartedAt;
          lastFailure = {
            step: stepIndex,
            stage: "approval_required",
            tool: plannerOutput.next_action.tool,
            message: blockedMessage
          };
          replanHistory.push(lastFailure);
          steps.push({
            step: stepIndex,
            tool: plannerOutput.next_action.tool,
            planner_request: plannerRequest,
            planner_trace: debugPlanner.getTrace(),
            planner_output: plannerOutput,
            normalized_input: normalizedInput,
            success: false,
            timing: stepTiming,
            error: blockedMessage
          });
          logDebugAgentFailure("run-loop", stepIndex, { code: "approval_required", message: blockedMessage }, {
            total_ms: Date.now() - startedAt
          });
          continue;
        }
        const toolResult =
          isWebDebugTool(plannerOutput.next_action.tool)
            ? await webWorker.execute(buildDebugToolRequest(plannerOutput.next_action.tool, selectDebugToolMode(plannerOutput.next_action.tool), normalizedInput))
            : await outlookWorker.execute(buildDebugToolRequest(plannerOutput.next_action.tool, selectDebugToolMode(plannerOutput.next_action.tool), normalizedInput));
        stepTiming.tool_ms = Date.now() - toolStartedAt;
        logDebugToolResult("run-loop", stepIndex, toolResult, stepTiming);

        const observationCandidate =
          typeof toolResult.output.observation === "object" && toolResult.output.observation !== null
            ? (toolResult.output.observation as Record<string, unknown>)
            : undefined;
        const previousSignature = currentObservationSignature;
        previousObservation = currentObservation;
        currentObservation = observationCandidate ?? currentObservation;
        currentObservationSignature = currentObservation ? computeObservationSignature(currentObservation) : currentObservationSignature;
        lastToolResult = toolResult.output;

        const observationChanged =
          Boolean(currentObservationSignature) &&
          Boolean(previousSignature) &&
          currentObservationSignature !== previousSignature;
        const navigationLikelyTool =
          plannerOutput.next_action.tool === "open_system" ||
          plannerOutput.next_action.tool === "click_web_element" ||
          plannerOutput.next_action.tool === "submit_web_form";
        const interactionTool =
          navigationLikelyTool ||
          plannerOutput.next_action.tool === "fill_web_form" ||
          plannerOutput.next_action.tool === "scroll_web_page";

        if (interactionTool && currentObservation && previousObservation) {
          stagnationCount = observationChanged ? 0 : stagnationCount + 1;
        } else if (observationChanged) {
          stagnationCount = 0;
        }

        steps.push({
          step: stepIndex,
          tool: plannerOutput.next_action.tool,
          planner_request: plannerRequest,
          planner_trace: debugPlanner.getTrace(),
          planner_output: plannerOutput,
          normalized_input: normalizedInput,
          tool_result: toolResult,
          success: toolResult.success,
          timing: stepTiming,
          observation_changed: observationChanged,
          stagnation_count: stagnationCount
        });

        if (!toolResult.success) {
          lastFailure = {
            step: stepIndex,
            stage: "tool_execution",
            tool: plannerOutput.next_action.tool,
            message: String(toolResult.output.error ?? "Tool execution failed")
          };
          replanHistory.push(lastFailure);
          continue;
        }

        if (plannerOutput.next_action.tool === "watch_email_reply" && plannerOutput.expected_transition === "WAITING_EMAIL") {
          lastFailure = undefined;
          const pendingSummary =
            typeof normalizedInput.conversation_id === "string" && normalizedInput.conversation_id.trim().length > 0
              ? `Waiting for a matching email reply in conversation ${normalizedInput.conversation_id}.`
              : "Waiting for a matching email reply.";
          logDebugAgentFinish("run-loop", stepIndex, pendingSummary, {
            total_ms: Date.now() - startedAt
          });
          return {
            ok: true,
            completed: false,
            pending: true,
            pending_state: "WAITING_EMAIL",
            final_response: pendingSummary,
            final_result: toolResult.output,
            global_plan: globalPlan ?? null,
            current_step_plan: currentStepPlan ?? null,
            steps,
            timing: {
              total_ms: Date.now() - startedAt
            },
            debug_trace: {
              planner_request: plannerRequest,
              planner_trace: debugPlanner.getTrace(),
              planner_output: plannerOutput,
              normalized_input: normalizedInput,
              tool_result: toolResult
            }
          };
        }

        if (navigationLikelyTool && currentObservation && previousObservation && !observationChanged) {
          lastFailure = {
            step: stepIndex,
            stage: "stale_observation",
            tool: plannerOutput.next_action.tool,
            message: "The last navigation-like action did not produce a fresh visible page state. Re-evaluate the current page before acting again."
          };
          replanHistory.push(lastFailure);
          continue;
        }

        lastFailure = undefined;
      } catch (error) {
        lastFailure = {
          step: stepIndex,
          stage: "tool_exception",
          tool: plannerOutput.next_action.tool,
          message: error instanceof Error ? error.message : String(error)
        };
        replanHistory.push(lastFailure);
        steps.push({
          step: stepIndex,
          tool: plannerOutput.next_action.tool,
          planner_request: plannerRequest,
          planner_trace: debugPlanner.getTrace(),
          planner_output: plannerOutput,
          normalized_input: normalizedInput,
          success: false,
          timing: stepTiming,
          error: lastFailure.message
        });
      }
    }

    return {
      ok: false,
      completed: false,
      error_stage: "internal_loop_safety_stop",
      error_message: `Agent loop reached the internal safety limit after ${maxSteps} steps`,
      global_plan: globalPlan ?? null,
      current_step_plan: currentStepPlan ?? null,
      steps,
      timing: {
        total_ms: Date.now() - startedAt
      }
    };
  });

  app.post("/bridge/sessions/register", async (request) => {
    const body = request.body as {
      session_id: string;
      parent_session_id?: string;
      system_id: string;
      title?: string;
      url?: string;
    };
    return browserBridgeCoordinator.registerSession(body);
  });

  app.post("/bridge/sessions/:sessionId/snapshot", async (request) => {
    const params = request.params as { sessionId: string };
    return browserBridgeCoordinator.updateObservation(params.sessionId, request.body);
  });

  app.get("/bridge/sessions/:sessionId/commands", async (request) => {
    const params = request.params as { sessionId: string };
    return browserBridgeCoordinator.pullPendingCommands(params.sessionId);
  });

  app.post("/bridge/sessions/:sessionId/commands/:commandId/result", async (request) => {
    const params = request.params as { sessionId: string; commandId: string };
    const body = request.body as { success: boolean; result?: Record<string, unknown>; error?: string };
    return browserBridgeCoordinator.completeCommand(params.sessionId, params.commandId, body);
  });

  app.post("/cases", async (request, reply) => {
    const body = createCaseInputSchema.parse(request.body);
    const record = resolvedOrchestrator.createCase(body);
    reply.code(201);
    return record;
  });

  app.get("/cases/:caseId", async (request) => {
    const params = request.params as { caseId: string };
    return {
      case: resolvedOrchestrator.getCase(params.caseId),
      approvals: resolvedOrchestrator.listApprovals(params.caseId),
      artifacts: resolvedOrchestrator.listArtifacts(params.caseId),
      events: resolvedOrchestrator.listEvents(params.caseId)
    };
  });

  app.post("/cases/:caseId/advance", async (request) => {
    const params = request.params as { caseId: string };
    return resolvedOrchestrator.advanceCase(params.caseId);
  });

  app.post("/cases/:caseId/events/email", async (request) => {
    const params = request.params as { caseId: string };
    const body = incomingEmailPayloadSchema.parse(request.body);
    return resolvedOrchestrator.ingestIncomingEmail(params.caseId, body);
  });

  app.get("/approvals", async () => {
    return resolvedOrchestrator.listApprovals();
  });

  app.post("/approvals/:approvalId/decision", async (request) => {
    const params = request.params as { approvalId: string };
    const body = approvalDecisionInputSchema.parse(request.body);
    return resolvedOrchestrator.applyApprovalDecision(params.approvalId, body);
  });

  return app;
}

function logDebugAgentStart(mode: "run" | "run-loop", instruction: string, context: Record<string, unknown>): void {
  const systemId = typeof context.system_id === "string" ? context.system_id : "-";
  const sessionId = typeof context.session_id === "string" ? context.session_id : "-";
  console.log(`[agent] ${mode === "run-loop" ? "LOOP" : "RUN"} ${truncateForLog(instruction, 140)}`);
  if (systemId !== "-" || sessionId !== "-") {
    console.log(`[agent] CONTEXT system=${systemId} session=${sessionId}`);
  }
}

function logDebugPlannerDecision(
  mode: "run" | "run-loop",
  step: number,
  plannerOutput: PlannerOutput,
  toolName: string,
  normalizedInput: Record<string, unknown>,
  plannerTrace?: unknown
): void {
  const planSummary = formatPlannerSummary(plannerOutput);
  console.log(`[${step}] GOAL  ${planSummary.primary}`);
  const toolHint = formatToolHint(toolName, normalizedInput);
  console.log(`[${step}] ACT   ${toolName}${toolHint ? ` -> ${toolHint}` : ""}`);
  const plannerIo = formatPlannerIoSummary(plannerTrace);
  if (plannerIo) {
    console.log(`[${step}] IO    ${plannerIo}`);
  }
}

function logDebugToolResult(
  mode: "run" | "run-loop",
  step: number,
  toolResult: { success: boolean; output: Record<string, unknown> },
  timing: { planner_ms?: number; tool_ms?: number; total_ms?: number }
): void {
  const artifactKind = typeof toolResult.output.artifact_kind === "string" ? toolResult.output.artifact_kind : "";
  const observation =
    typeof toolResult.output.observation === "object" && toolResult.output.observation !== null
      ? (toolResult.output.observation as Record<string, unknown>)
      : undefined;
  const title = typeof observation?.title === "string" ? observation.title : undefined;
  const url = typeof observation?.url === "string" ? observation.url : undefined;
  const sessionId =
    typeof toolResult.output.session_id === "string"
      ? toolResult.output.session_id
      : typeof observation?.sessionId === "string"
        ? observation.sessionId
        : undefined;
  const summary =
    typeof toolResult.output.summary === "string"
      ? toolResult.output.summary
      : typeof observation?.summary === "string"
        ? observation.summary
        : undefined;
  const clickTarget =
    typeof toolResult.output.target === "object" && toolResult.output.target !== null
      ? (toolResult.output.target as Record<string, unknown>)
      : undefined;
  const clickTargetSummary =
    clickTarget
      ? formatClickTargetSummary({
          handle: typeof clickTarget.handle === "string" ? clickTarget.handle : undefined,
          key: typeof clickTarget.key === "string" ? clickTarget.key : undefined,
          label: typeof clickTarget.label === "string" ? clickTarget.label : undefined,
          nearbyText: typeof clickTarget.nearbyText === "string" ? clickTarget.nearbyText : undefined,
          domPath: typeof clickTarget.domPath === "string" ? clickTarget.domPath : undefined
        })
      : "";

  const status = toolResult.success ? "OK" : "FAIL";
  const header = clickTargetSummary ? `${status}   ${clickTargetSummary}` : status;
  console.log(`[${step}] ${header}`);

  const pageSummary = [truncateForLog(title, 80), truncateForLog(url, 120)].filter((value) => value && value !== "-").join(" | ");
  const draftSummary = formatDraftResultSummary(toolResult.output);
  const mailSummary = formatMailResultSummary(toolResult.output);

  if (draftSummary) {
    console.log(`[${step}] DRAFT ${draftSummary}`);
  } else if (mailSummary) {
    console.log(`[${step}] MAIL  ${mailSummary}`);
  } else if (pageSummary) {
    console.log(`[${step}] PAGE  ${pageSummary}`);
  }
  if (summary && summary !== "-") {
    console.log(`[${step}] INFO  ${truncateForLog(summary, 140)}`);
  }
  if (sessionId && sessionId !== "-" && artifactKind.startsWith("web")) {
    console.log(`[${step}] SID   ${sessionId}`);
  }
  const totalStepMs = (timing.planner_ms ?? 0) + (timing.tool_ms ?? 0);
  console.log(`[${step}] TIME  llm=${timing.planner_ms ?? 0}ms action=${timing.tool_ms ?? 0}ms total=${totalStepMs}ms`);
}

function formatPlannerIoSummary(plannerTrace: unknown): string {
  if (!plannerTrace || typeof plannerTrace !== "object") {
    return "";
  }

  const trace = plannerTrace as Record<string, unknown>;
  const requestMetrics =
    typeof trace.request_metrics === "object" && trace.request_metrics !== null
      ? (trace.request_metrics as Record<string, unknown>)
      : undefined;
  const responseMetrics =
    typeof trace.response_metrics === "object" && trace.response_metrics !== null
      ? (trace.response_metrics as Record<string, unknown>)
      : undefined;
  const usage =
    responseMetrics && typeof responseMetrics.usage === "object" && responseMetrics.usage !== null
      ? (responseMetrics.usage as Record<string, unknown>)
      : undefined;

  const inputTokens = typeof usage?.input_tokens === "number" ? usage.input_tokens : undefined;
  const outputTokens = typeof usage?.output_tokens === "number" ? usage.output_tokens : undefined;
  const reasoningTokens = typeof usage?.reasoning_tokens === "number" ? usage.reasoning_tokens : undefined;

  if (inputTokens !== undefined || outputTokens !== undefined || reasoningTokens !== undefined) {
    const parts = [
      inputTokens !== undefined ? `tokens_in=${inputTokens}` : undefined,
      outputTokens !== undefined ? `tokens_out=${outputTokens}` : undefined,
      reasoningTokens !== undefined ? `reasoning=${reasoningTokens}` : undefined
    ].filter(Boolean);
    return parts.join(" ");
  }

  const requestChars = typeof requestMetrics?.request_chars === "number" ? requestMetrics.request_chars : undefined;
  const responseChars = typeof responseMetrics?.response_chars === "number" ? responseMetrics.response_chars : undefined;
  if (requestChars !== undefined || responseChars !== undefined) {
    const parts = [
      requestChars !== undefined ? `chars_in=${requestChars}` : undefined,
      responseChars !== undefined ? `chars_out=${responseChars}` : undefined
    ].filter(Boolean);
    return parts.join(" ");
  }

  return "";
}

function logDebugAgentFinish(
  mode: "run" | "run-loop",
  step: number,
  summary: string,
  timing: { total_ms?: number }
): void {
  console.log(`[${step}] DONE  ${truncateForLog(summary, 140)}`);
  console.log(`[${step}] TIME  total=${timing.total_ms ?? 0}ms`);
}

function logDebugAgentFailure(
  mode: "run" | "run-loop",
  step: number,
  error: unknown,
  timing: { total_ms?: number }
): void {
  const classified = isClassifiedDebugError(error) ? error : classifyDebugError(error);
  console.log(`[${step}] FAIL  ${classified.code} ${truncateForLog(classified.message, 180)}`);
  console.log(`[${step}] TIME  total=${timing.total_ms ?? 0}ms`);
}

type ClassifiedDebugError = {
  code: "timeout" | "unauthorized" | "rate_limit" | "network_error" | "provider_error" | "unknown_error";
  message: string;
};

function isClassifiedDebugError(value: unknown): value is ClassifiedDebugError {
  return Boolean(
    value &&
      typeof value === "object" &&
      "code" in value &&
      "message" in value &&
      typeof (value as { code?: unknown }).code === "string" &&
      typeof (value as { message?: unknown }).message === "string"
  );
}

function classifyDebugError(error: unknown): ClassifiedDebugError {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  if (normalized.includes("timed out") || normalized.includes("timeout") || normalized.includes("aborterror")) {
    return { code: "timeout", message };
  }
  if (
    normalized.includes("401") ||
    normalized.includes("403") ||
    normalized.includes("unauthorized") ||
    normalized.includes("forbidden") ||
    normalized.includes("invalid api key") ||
    normalized.includes("authentication")
  ) {
    return { code: "unauthorized", message };
  }
  if (
    normalized.includes("429") ||
    normalized.includes("rate limit") ||
    normalized.includes("too many requests") ||
    normalized.includes("quota")
  ) {
    return { code: "rate_limit", message };
  }
  if (
    normalized.includes("econnrefused") ||
    normalized.includes("enotfound") ||
    normalized.includes("eai_again") ||
    normalized.includes("network") ||
    normalized.includes("socket hang up") ||
    normalized.includes("fetch failed") ||
    normalized.includes("connect")
  ) {
    return { code: "network_error", message };
  }
  if (
    normalized.includes("500") ||
    normalized.includes("502") ||
    normalized.includes("503") ||
    normalized.includes("504") ||
    normalized.includes("bad gateway") ||
    normalized.includes("service unavailable") ||
    normalized.includes("internal server error")
  ) {
    return { code: "provider_error", message };
  }
  return { code: "unknown_error", message };
}

function formatPlannerSummary(plannerOutput: PlannerOutput): { primary: string } {
  let primary = "";

  if (typeof plannerOutput.objective === "string" && plannerOutput.objective.trim().length > 0) {
    primary = truncateForLog(plannerOutput.objective, 100);
  }

  const globalPlan =
    plannerOutput.global_plan && typeof plannerOutput.global_plan === "object"
      ? (plannerOutput.global_plan as Record<string, unknown>)
      : undefined;
  if (globalPlan) {
    const progressSummary = typeof globalPlan.progress_summary === "string" ? globalPlan.progress_summary : "";
    if (progressSummary && !primary) {
      primary = truncateForLog(progressSummary, 100);
    }
  }

  const stepPlan =
    plannerOutput.step_plan && typeof plannerOutput.step_plan === "object"
      ? (plannerOutput.step_plan as Record<string, unknown>)
      : undefined;
  if (stepPlan) {
    const currentGoal = typeof stepPlan.current_goal === "string" ? stepPlan.current_goal : "";
    if (currentGoal) {
      if (!primary) {
        primary = truncateForLog(currentGoal, 100);
      }
    }
  }

  return {
    primary: primary || "Continue the task"
  };
}

function formatDraftResultSummary(output: Record<string, unknown>): string {
  const artifactKind = typeof output.artifact_kind === "string" ? output.artifact_kind : "";
  if (artifactKind !== "mail_draft" && artifactKind !== "mail_draft_preview") {
    return "";
  }
  const subject = typeof output.subject === "string" ? truncateForLog(output.subject, 80) : "-";
  const to = Array.isArray(output.to)
    ? output.to
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .slice(0, 2)
        .map((item) => truncateForLog(item, 80))
        .join("; ")
    : "";
  const cc = Array.isArray(output.cc)
    ? output.cc
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .slice(0, 2)
        .map((item) => truncateForLog(item, 80))
        .join("; ")
    : "";
  const parts = [`subject="${subject}"`];
  if (to) {
    parts.push(`to=${to}`);
  }
  if (cc) {
    parts.push(`cc=${cc}`);
  }
  return parts.join(" | ");
}

function formatMailResultSummary(output: Record<string, unknown>): string {
  const artifactKind = typeof output.artifact_kind === "string" ? output.artifact_kind : "";
  if (artifactKind === "mail_detail") {
    const subject = typeof output.subject === "string" ? truncateForLog(output.subject, 80) : "-";
    const sender = typeof output.sender === "string" ? truncateForLog(output.sender, 80) : "-";
    return `subject="${subject}" | from=${sender}`;
  }
  if (artifactKind === "mail_conversation") {
    const count = typeof output.count === "number" ? output.count : 0;
    const conversationId = typeof output.conversation_id === "string" ? truncateForLog(output.conversation_id, 40) : "-";
    return `conversation=${conversationId} | messages=${count}`;
  }
  if (artifactKind === "contact_search") {
    const contacts = Array.isArray(output.contacts)
      ? output.contacts
          .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
          .slice(0, 2)
          .map((item) => {
            const name = typeof item.name === "string" ? truncateForLog(item.name, 40) : "";
            const email = typeof item.email === "string" ? truncateForLog(item.email, 80) : "";
            return [name, email].filter(Boolean).join(" <") + (name && email ? ">" : "");
          })
          .filter((item) => item.length > 0)
          .join(" | ")
      : "";
    return contacts || "";
  }
  return "";
}

function formatToolHint(toolName: string, input: Record<string, unknown>): string {
  if (toolName === "open_system") {
    const targetUrl = stringForLog(input.target_url);
    const urlContains = stringForLog(input.url_contains);
    const titleContains = stringForLog(input.title_contains);
    return truncateForLog(
      targetUrl !== "-" ? targetUrl : urlContains !== "-" ? urlContains : titleContains,
      60
    );
  }
  if (toolName === "fill_web_form") {
    const fieldValues =
      typeof input.field_values === "object" && input.field_values !== null ? (input.field_values as Record<string, unknown>) : {};
    const fields = Object.keys(fieldValues).slice(0, 3).join(", ");
    return fields || "";
  }
  if (toolName === "read_web_page") {
    return "read";
  }
  if (toolName === "click_web_element") {
    const targetHandle = stringForLog(input.target_handle);
    const targetKey = stringForLog(input.target_key);
    return truncateForLog(targetHandle !== "-" ? `#${targetHandle}` : targetKey, 40);
  }
  if (toolName === "navigate_browser_history") {
    return truncateForLog(stringForLog(input.direction), 20);
  }
  if (toolName === "draft_outlook_mail") {
    return truncateForLog(stringForLog(input.template_id), 40);
  }
  if (toolName === "read_outlook_mail") {
    return truncateForLog(stringForLog(input.entry_id) !== "-" ? stringForLog(input.entry_id) : stringForLog(input.conversation_id), 40);
  }
  if (toolName === "read_outlook_conversation") {
    return truncateForLog(stringForLog(input.conversation_id), 40);
  }
  if (toolName === "reply_outlook_mail") {
    return truncateForLog(stringForLog(input.entry_id) !== "-" ? stringForLog(input.entry_id) : stringForLog(input.conversation_id), 40);
  }
  if (toolName === "update_outlook_draft" || toolName === "preview_outlook_draft") {
    return truncateForLog(stringForLog(input.draft_id), 40);
  }
  if (toolName === "watch_email_reply") {
    const conversationId = stringForLog(input.conversation_id);
    const expectedFrom = Array.isArray(input.expected_from) ? String(input.expected_from[0] ?? "") : "";
    return truncateForLog(conversationId !== "-" ? conversationId : expectedFrom, 40);
  }
  if (toolName === "await_email_reply") {
    const conversationId = stringForLog(input.conversation_id);
    const expectedFrom = Array.isArray(input.expected_from) ? String(input.expected_from[0] ?? "") : "";
    return truncateForLog(conversationId !== "-" ? conversationId : expectedFrom, 40);
  }
  if (toolName === "search_outlook_mail") {
    return truncateForLog(stringForLog(input.keyword), 40);
  }
  if (toolName === "search_outlook_contacts") {
    return truncateForLog(stringForLog(input.query), 40);
  }
  return "";
}

function stringForLog(value: unknown): string {
  return typeof value === "string" && value.trim().length > 0 ? value : "-";
}

function truncateForLog(value: unknown, maxLength: number): string {
  const text = typeof value === "string" ? value : value == null ? "-" : String(value);
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function formatClickTargetSummary(target: {
  handle?: string;
  key?: string;
  label?: string;
  nearbyText?: string;
  domPath?: string;
}): string {
  const parts: string[] = [];
  if (target.label) {
    parts.push(`CLICK "${truncateForLog(target.label, 40)}"`);
  }
  if (target.handle) {
    parts.push(`[#${target.handle}]`);
  }
  if (target.key && (!target.label || normalizeLogToken(target.key) !== normalizeLogToken(target.label))) {
    parts.push(`key ${truncateForLog(target.key, 30)}`);
  }
  if (target.nearbyText) {
    parts.push(`near "${truncateForLog(target.nearbyText, 60)}"`);
  }
  if (target.domPath) {
    parts.push(`path ${truncateForLog(target.domPath, 70)}`);
  }
  return parts.join(" ");
}

function normalizeLogToken(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function buildDebugToolRequest(toolName: string, mode: "draft" | "preview" | "commit", input: Record<string, unknown>) {
  return {
    request_id: `DBG-${crypto.randomUUID()}`,
    case_id: "DEBUG-CASE",
    step_id: `debug_${toolName}`,
    tool_name: toolName,
    mode,
    input
  };
}

function buildDebugToolSpecs() {
  return [
    {
      name: "open_system",
      description: "Open or attach to a page using url/title/session hints.",
      input_schema: {
        system_id: { type: "string" },
        page_id: { type: "string" },
        target_url: { type: "string" },
        url_contains: { type: "string" },
        title_contains: { type: "string" },
        session_id: { type: "string" },
        open_if_missing: { type: "boolean" }
      }
    },
    {
      name: "read_web_page",
      description: "Read the current page DOM, visible text, semantic blocks, and interactive elements without deciding success yet.",
      input_schema: { system_id: { type: "string" }, session_id: { type: "string" } }
    },
    {
      name: "fill_web_form",
      description: "Enter text or set detected field values on the current page.",
      input_schema: { system_id: { type: "string" }, session_id: { type: "string" }, field_values: { type: "object" } }
    },
    {
      name: "click_web_element",
      description: "Click a specific button or clickable control on the active web system. Prefer target_handle from domOutline when available.",
      input_schema: { system_id: { type: "string" }, session_id: { type: "string" }, target_key: { type: "string" }, target_handle: { type: "string" } }
    },
    {
      name: "scroll_web_page",
      description: "Scroll the current page up or down to reveal more content.",
      input_schema: {
        system_id: { type: "string" },
        session_id: { type: "string" },
        direction: { type: "string" },
        amount: { type: "number" }
      }
    },
    {
      name: "navigate_browser_history",
      description: "Go back or forward in the current browser tab history to return to a previous page state or result list.",
      input_schema: {
        system_id: { type: "string" },
        session_id: { type: "string" },
        direction: { type: "string" }
      }
    },
    {
      name: "preview_web_submission",
      description: "Preview the current web submission state.",
      input_schema: { system_id: { type: "string" } }
    },
    {
      name: "submit_web_form",
      description: "Click the final submit button on the active web system.",
      input_schema: { system_id: { type: "string" }, expected_button: { type: "string" } }
    },
    {
      name: "draft_outlook_mail",
      description: "Create an Outlook mail draft with recipients and optional subject/body.",
      input_schema: {
        template_id: { type: "string" },
        to: { type: "array" },
        cc: { type: "array" },
        variables: { type: "object" },
        subject: { type: "string" },
        body_text: { type: "string" },
        body_html: { type: "string" }
      }
    },
    {
      name: "send_outlook_mail",
      description: "Send a drafted Outlook mail.",
      input_schema: { draft_id: { type: "string" } }
    },
    {
      name: "read_outlook_mail",
      description: "Read a specific Outlook mail or latest mail in a conversation.",
      input_schema: { entry_id: { type: "string" }, conversation_id: { type: "string" } }
    },
    {
      name: "read_outlook_conversation",
      description: "Read an Outlook conversation thread.",
      input_schema: { conversation_id: { type: "string" }, max_messages: { type: "number" } }
    },
    {
      name: "reply_outlook_mail",
      description: "Create a reply draft to an Outlook mail or conversation.",
      input_schema: {
        entry_id: { type: "string" },
        conversation_id: { type: "string" },
        body_text: { type: "string" },
        body_html: { type: "string" },
        reply_all: { type: "boolean" }
      }
    },
    {
      name: "update_outlook_draft",
      description: "Update an Outlook draft's recipients, subject, or body.",
      input_schema: {
        draft_id: { type: "string" },
        subject: { type: "string" },
        to: { type: "array" },
        cc: { type: "array" },
        body_text: { type: "string" },
        body_html: { type: "string" }
      }
    },
    {
      name: "preview_outlook_draft",
      description: "Preview an Outlook draft before sending.",
      input_schema: { draft_id: { type: "string" } }
    },
    {
      name: "watch_email_reply",
      description: "Watch for a matching reply in Outlook.",
      input_schema: {
        case_id: { type: "string" },
        conversation_id: { type: "string" },
        expected_from: { type: "array" },
        required_fields: { type: "array" },
        keyword_contains: { type: "array" }
      }
    },
    {
      name: "await_email_reply",
      description: "Wait for a matching Outlook reply and return it when it arrives.",
      input_schema: {
        case_id: { type: "string" },
        conversation_id: { type: "string" },
        expected_from: { type: "array" },
        required_fields: { type: "array" },
        keyword_contains: { type: "array" },
        timeout_seconds: { type: "number" },
        poll_interval_ms: { type: "number" }
      }
    },
    {
      name: "search_outlook_mail",
      description: "Search Outlook mail by keyword.",
      input_schema: {
        keyword: { type: "string" },
        max_results: { type: "number" }
      }
    },
    {
      name: "search_outlook_contacts",
      description: "Search recent mail participants and the organizational directory by person, team, or email query.",
      input_schema: {
        query: { type: "string" },
        max_results: { type: "number" }
      }
    },
    {
      name: "finish_task",
      description: "Finish the current task and return a short summary.",
      input_schema: {
        summary: { type: "string" }
      }
    }
  ];
}

function selectDebugToolMode(toolName: string): "draft" | "preview" | "commit" {
  if (toolName === "submit_web_form" || toolName === "send_outlook_mail") {
    return "commit";
  }
  if (toolName === "fill_web_form" || toolName === "draft_outlook_mail" || toolName === "reply_outlook_mail" || toolName === "update_outlook_draft") {
    return "draft";
  }
  return "preview";
}

function normalizeDebugToolInput(
  toolName: string,
  input: Record<string, unknown>,
  context: Record<string, unknown>,
  instruction: string
): Record<string, unknown> {
  const normalized = { ...input };

  if (isWebDebugTool(toolName)) {
    if (typeof normalized.session_id !== "string" || normalized.session_id.trim().length === 0) {
      normalized.session_id = inferSessionIdFromContext(context);
    }
    if (typeof normalized.system_id !== "string" || normalized.system_id.trim().length === 0) {
      const inferredSystemId = inferSystemIdFromContext(context, instruction);
      normalized.system_id = inferredSystemId ?? "web_generic";
    }
    if (toolName === "open_system" && (typeof normalized.target_url !== "string" || normalized.target_url.trim().length === 0)) {
      const extractedUrl = extractFirstUrlFromText(instruction);
      if (extractedUrl) {
        normalized.target_url = extractedUrl;
      }
    }
    if (
      toolName === "open_system" &&
      (typeof normalized.url_contains !== "string" || normalized.url_contains.trim().length === 0) &&
      typeof normalized.target_url === "string" &&
      normalized.target_url.trim().length > 0
    ) {
      try {
        normalized.url_contains = new URL(normalized.target_url).host;
      } catch {
      }
    }
    if (
      toolName === "open_system" &&
      typeof normalized.target_url === "string" &&
      normalized.target_url.trim().length > 0 &&
      typeof normalized.open_if_missing !== "boolean"
    ) {
      normalized.open_if_missing = true;
    }
    if (toolName === "submit_web_form" && (typeof normalized.expected_button !== "string" || normalized.expected_button.trim().length === 0)) {
      normalized.expected_button = typeof context.expected_button === "string" && context.expected_button.trim().length > 0 ? context.expected_button : "Submit";
    }
    if (toolName === "fill_web_form" && (typeof normalized.field_values !== "object" || normalized.field_values === null)) {
      normalized.field_values = typeof context.field_values === "object" && context.field_values !== null ? context.field_values : {};
    }
    if (toolName === "read_web_page") {
      delete normalized.goal;
      delete normalized.query;
    }
    if (toolName === "click_web_element" && (typeof normalized.target_key !== "string" || normalized.target_key.trim().length === 0)) {
      normalized.target_key = typeof context.target_key === "string" && context.target_key.trim().length > 0 ? context.target_key : "";
    }
    if (toolName === "scroll_web_page") {
      if (typeof normalized.direction !== "string" || normalized.direction.trim().length === 0) {
        normalized.direction = typeof context.direction === "string" ? context.direction : "down";
      }
      if (typeof normalized.amount !== "number") {
        normalized.amount = typeof context.amount === "number" ? context.amount : 0.75;
      }
    }
  }

  if (toolName === "search_outlook_mail") {
    if (typeof normalized.keyword !== "string" || normalized.keyword.trim().length === 0) {
      normalized.keyword = typeof context.keyword === "string" && context.keyword.trim().length > 0 ? context.keyword : instruction;
    }
    if (typeof normalized.max_results !== "number") {
      normalized.max_results = typeof context.max_results === "number" ? context.max_results : 10;
    }
  }

  if (toolName === "search_outlook_contacts") {
    if (typeof normalized.query !== "string" || normalized.query.trim().length === 0) {
      normalized.query =
        typeof context.recipient_query === "string" && context.recipient_query.trim().length > 0
          ? context.recipient_query
          : instruction;
    }
    if (typeof normalized.max_results !== "number") {
      normalized.max_results = typeof context.max_results === "number" ? context.max_results : 10;
    }
  }

  if (toolName === "draft_outlook_mail") {
    if (typeof normalized.template_id !== "string" || normalized.template_id.trim().length === 0) {
      normalized.template_id = typeof context.template_id === "string" && context.template_id.trim().length > 0 ? context.template_id : "general_mail";
    }
    if (!Array.isArray(normalized.to) && Array.isArray(context.to)) {
      normalized.to = context.to;
    }
    if (!Array.isArray(normalized.cc) && Array.isArray(context.cc)) {
      normalized.cc = context.cc;
    }
    if ((typeof normalized.variables !== "object" || normalized.variables === null) && typeof context.variables === "object" && context.variables !== null) {
      normalized.variables = context.variables;
    }
    if (typeof normalized.subject !== "string" && typeof context.subject === "string") {
      normalized.subject = context.subject;
    }
    if (typeof normalized.body_text !== "string" && typeof context.body_text === "string") {
      normalized.body_text = context.body_text;
    }
    if (typeof normalized.body_html !== "string" && typeof context.body_html === "string") {
      normalized.body_html = context.body_html;
    }
    const toValues = Array.isArray(normalized.to) ? normalized.to.filter((value) => typeof value === "string" && value.trim().length > 0) : [];
    if (toValues.length === 0) {
      const contactEvidence =
        typeof context.contact_evidence === "object" && context.contact_evidence !== null
          ? (context.contact_evidence as Record<string, unknown>)
          : undefined;
      const contacts = Array.isArray(contactEvidence?.contacts)
        ? contactEvidence.contacts.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
        : [];
      const contactEmail = contacts
        .map((item) => (typeof item.email === "string" ? item.email.trim() : ""))
        .find((value) => value.length > 0);
      if (contactEmail) {
        normalized.to = [contactEmail];
      }
    }
  }

  if (toolName === "send_outlook_mail") {
    if (typeof normalized.draft_id !== "string" || normalized.draft_id.trim().length === 0) {
      normalized.draft_id = typeof context.draft_id === "string" ? context.draft_id : "";
    }
  }

  if (toolName === "read_outlook_mail") {
    if (typeof normalized.entry_id !== "string") {
      normalized.entry_id = typeof context.entry_id === "string" ? context.entry_id : "";
    }
    if (typeof normalized.conversation_id !== "string") {
      normalized.conversation_id = typeof context.conversation_id === "string" ? context.conversation_id : "";
    }
  }

  if (toolName === "read_outlook_conversation") {
    if (typeof normalized.conversation_id !== "string" || normalized.conversation_id.trim().length === 0) {
      normalized.conversation_id = typeof context.conversation_id === "string" ? context.conversation_id : "";
    }
    if (typeof normalized.max_messages !== "number") {
      normalized.max_messages = typeof context.max_messages === "number" ? context.max_messages : 20;
    }
  }

  if (toolName === "reply_outlook_mail") {
    if (typeof normalized.entry_id !== "string") {
      normalized.entry_id = typeof context.entry_id === "string" ? context.entry_id : "";
    }
    if (typeof normalized.conversation_id !== "string") {
      normalized.conversation_id = typeof context.conversation_id === "string" ? context.conversation_id : "";
    }
    if (typeof normalized.body_text !== "string" && typeof context.body_text === "string") {
      normalized.body_text = context.body_text;
    }
    if (typeof normalized.body_html !== "string" && typeof context.body_html === "string") {
      normalized.body_html = context.body_html;
    }
    if (typeof normalized.reply_all !== "boolean") {
      normalized.reply_all = context.reply_all === true;
    }
  }

  if (toolName === "update_outlook_draft") {
    if (typeof normalized.draft_id !== "string" || normalized.draft_id.trim().length === 0) {
      normalized.draft_id = typeof context.draft_id === "string" ? context.draft_id : "";
    }
    if (typeof normalized.subject !== "string" && typeof context.subject === "string") {
      normalized.subject = context.subject;
    }
    if (!Array.isArray(normalized.to) && Array.isArray(context.to)) {
      normalized.to = context.to;
    }
    if (!Array.isArray(normalized.cc) && Array.isArray(context.cc)) {
      normalized.cc = context.cc;
    }
    if (typeof normalized.body_text !== "string" && typeof context.body_text === "string") {
      normalized.body_text = context.body_text;
    }
    if (typeof normalized.body_html !== "string" && typeof context.body_html === "string") {
      normalized.body_html = context.body_html;
    }
    const draftEvidence =
      typeof context.draft_evidence === "object" && context.draft_evidence !== null
        ? (context.draft_evidence as Record<string, unknown>)
        : undefined;
    const existingTo = Array.isArray(draftEvidence?.to)
      ? draftEvidence.to.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
    const existingCc = Array.isArray(draftEvidence?.cc)
      ? draftEvidence.cc.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
    const currentTo = Array.isArray(normalized.to)
      ? normalized.to.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
    const currentCc = Array.isArray(normalized.cc)
      ? normalized.cc.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
    if (currentTo.length === 0 && existingTo.length > 0) {
      normalized.to = existingTo;
    }
    if (currentCc.length === 0 && existingCc.length > 0) {
      normalized.cc = existingCc;
    }
    const contactEvidence =
      typeof context.contact_evidence === "object" && context.contact_evidence !== null
        ? (context.contact_evidence as Record<string, unknown>)
        : undefined;
    const contacts = Array.isArray(contactEvidence?.contacts)
      ? contactEvidence.contacts.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
      : [];
    const contactEmails = contacts
      .map((item) => (typeof item.email === "string" ? item.email.trim() : ""))
      .filter((value, index, array) => value.length > 0 && array.indexOf(value) === index);
    const nextTo = Array.isArray(normalized.to)
      ? normalized.to.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
    const nextCc = Array.isArray(normalized.cc)
      ? normalized.cc.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
    if (nextTo.length === 0 && contactEmails.length > 0) {
      normalized.to = [contactEmails[0]];
    }
    if (nextCc.length === 0 && contactEmails.length > 1) {
      normalized.cc = [contactEmails[1]];
    }
  }

  if (toolName === "preview_outlook_draft") {
    if (typeof normalized.draft_id !== "string" || normalized.draft_id.trim().length === 0) {
      normalized.draft_id = typeof context.draft_id === "string" ? context.draft_id : "";
    }
  }

  if (toolName === "watch_email_reply") {
    if (typeof normalized.case_id !== "string" || normalized.case_id.trim().length === 0) {
      normalized.case_id = typeof context.case_id === "string" ? context.case_id : "DEBUG-CASE";
    }
    if (typeof normalized.conversation_id !== "string" || normalized.conversation_id.trim().length === 0) {
      normalized.conversation_id = typeof context.conversation_id === "string" ? context.conversation_id : "";
    }
    if (!Array.isArray(normalized.expected_from) && Array.isArray(context.expected_from)) {
      normalized.expected_from = context.expected_from;
    }
    if (!Array.isArray(normalized.required_fields) && Array.isArray(context.required_fields)) {
      normalized.required_fields = context.required_fields;
    }
    if (!Array.isArray(normalized.keyword_contains) && Array.isArray(context.keyword_contains)) {
      normalized.keyword_contains = context.keyword_contains;
    }
  }

  if (toolName === "await_email_reply") {
    if (typeof normalized.case_id !== "string" || normalized.case_id.trim().length === 0) {
      normalized.case_id = typeof context.case_id === "string" ? context.case_id : "DEBUG-CASE";
    }
    if (typeof normalized.conversation_id !== "string" || normalized.conversation_id.trim().length === 0) {
      normalized.conversation_id = typeof context.conversation_id === "string" ? context.conversation_id : "";
    }
    if (!Array.isArray(normalized.expected_from) && Array.isArray(context.expected_from)) {
      normalized.expected_from = context.expected_from;
    }
    if (!Array.isArray(normalized.required_fields) && Array.isArray(context.required_fields)) {
      normalized.required_fields = context.required_fields;
    }
    if (!Array.isArray(normalized.keyword_contains) && Array.isArray(context.keyword_contains)) {
      normalized.keyword_contains = context.keyword_contains;
    }
    if (typeof normalized.timeout_seconds !== "number" && typeof context.timeout_seconds === "number") {
      normalized.timeout_seconds = context.timeout_seconds;
    }
    if (typeof normalized.poll_interval_ms !== "number" && typeof context.poll_interval_ms === "number") {
      normalized.poll_interval_ms = context.poll_interval_ms;
    }
  }

  return normalized;
}

function isWebDebugTool(toolName: string): boolean {
  return (
    toolName === "open_system" ||
    toolName === "read_web_page" ||
    toolName === "navigate_browser_history" ||
    toolName.includes("web")
  );
}

function isSendBlockedWithoutApproval(toolName: string, context: Record<string, unknown>): boolean {
  return toolName === "send_outlook_mail" && context.approved_to_send !== true;
}

function inferSessionIdFromContext(context: Record<string, unknown>): string | undefined {
  if (typeof context.session_id === "string" && context.session_id.trim().length > 0) {
    return context.session_id;
  }
  const currentObservation =
    typeof context.current_observation === "object" && context.current_observation !== null
      ? (context.current_observation as Record<string, unknown>)
      : undefined;
  if (typeof currentObservation?.sessionId === "string" && currentObservation.sessionId.trim().length > 0) {
    return currentObservation.sessionId;
  }
  const lastToolResult =
    typeof context.last_tool_result === "object" && context.last_tool_result !== null
      ? (context.last_tool_result as Record<string, unknown>)
      : undefined;
  if (typeof lastToolResult?.session_id === "string" && lastToolResult.session_id.trim().length > 0) {
    return lastToolResult.session_id;
  }
  return undefined;
}

function inferSystemIdFromContext(context: Record<string, unknown>, instruction: string): string | undefined {
  if (typeof context.system_id === "string" && context.system_id.trim().length > 0) {
    return context.system_id;
  }
  const currentObservation =
    typeof context.current_observation === "object" && context.current_observation !== null
      ? (context.current_observation as Record<string, unknown>)
      : undefined;
  if (typeof currentObservation?.systemId === "string" && currentObservation.systemId.trim().length > 0) {
    return currentObservation.systemId;
  }

  const lastToolResult =
    typeof context.last_tool_result === "object" && context.last_tool_result !== null
      ? (context.last_tool_result as Record<string, unknown>)
      : undefined;
  if (typeof lastToolResult?.system_id === "string" && lastToolResult.system_id.trim().length > 0) {
    return lastToolResult.system_id;
  }
  return undefined;
}

function extractFirstUrlFromText(text: string): string | undefined {
  const match = text.match(/https?:\/\/[^\s"'<>]+/i);
  return match ? match[0] : undefined;
}

function decodePayloadStrings(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => decodePayloadStrings(entry));
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.utf8_base64 === "string") {
    return decodeUtf8Base64(record.utf8_base64);
  }

  const decoded: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (key.endsWith("_base64") && typeof entry === "string") {
      decoded[key.slice(0, -7)] = decodeUtf8Base64(entry);
      continue;
    }
    decoded[key] = decodePayloadStrings(entry);
  }
  return decoded;
}

function decodeUtf8Base64(value: string): string {
  try {
    return Buffer.from(value, "base64").toString("utf8");
  } catch {
    return value;
  }
}

function computeObservationSignature(observation: Record<string, unknown>): string {
  const title = typeof observation.title === "string" ? observation.title : "";
  const url = typeof observation.url === "string" ? observation.url : "";
  const pageText = typeof observation.pageText === "string" ? observation.pageText.slice(0, 300) : "";
  const summary = typeof observation.summary === "string" ? observation.summary.slice(0, 180) : "";
  const domOutline = typeof observation.domOutline === "string" ? observation.domOutline.slice(0, 400) : "";
  return [title, url, summary, pageText, domOutline].join("|");
}

function summarizeObservationForPlanner(observation: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!observation) {
    return undefined;
  }

  const semanticBlocks = Array.isArray(observation.semanticBlocks)
    ? observation.semanticBlocks
        .filter((block): block is Record<string, unknown> => typeof block === "object" && block !== null)
        .slice(0, 10)
        .map((block) => ({
          type: typeof block.type === "string" ? block.type : undefined,
          text: typeof block.text === "string" ? truncateForLog(block.text, 180) : undefined,
          importance: typeof block.importance === "number" ? block.importance : undefined,
          region: typeof block.region === "string" ? block.region : undefined,
          title: typeof block.title === "string" ? truncateForLog(block.title, 120) : undefined
        }))
    : [];

  const interactiveElements = Array.isArray(observation.interactiveElements)
    ? observation.interactiveElements
        .filter((element): element is Record<string, unknown> => typeof element === "object" && element !== null)
        .slice(0, 16)
        .map((element) => ({
          handle: typeof element.handle === "string" ? element.handle : undefined,
          key: typeof element.key === "string" ? element.key : undefined,
          label: typeof element.label === "string" ? truncateForLog(element.label, 120) : undefined,
          value: typeof element.value === "string" ? truncateForLog(element.value, 160) : undefined,
          type: typeof element.type === "string" ? element.type : undefined,
          semanticRole: typeof element.semanticRole === "string" ? element.semanticRole : undefined,
          importance: typeof element.importance === "number" ? element.importance : undefined,
          nearbyText: typeof element.nearbyText === "string" ? truncateForLog(element.nearbyText, 160) : undefined,
          required: typeof element.required === "boolean" ? element.required : undefined
        }))
    : [];

  const visibleTextBlocks = Array.isArray(observation.visibleTextBlocks)
    ? observation.visibleTextBlocks
        .filter((block): block is string => typeof block === "string" && block.trim().length > 0)
        .slice(0, 10)
        .map((block) => truncateForLog(block, 160))
    : [];

  return {
    sessionId: typeof observation.sessionId === "string" ? observation.sessionId : undefined,
    parentSessionId: typeof observation.parentSessionId === "string" ? observation.parentSessionId : undefined,
    systemId: typeof observation.systemId === "string" ? observation.systemId : undefined,
    pageId: typeof observation.pageId === "string" ? observation.pageId : undefined,
    title: typeof observation.title === "string" ? observation.title : undefined,
    url: typeof observation.url === "string" ? observation.url : undefined,
    summary: typeof observation.summary === "string" ? truncateForLog(observation.summary, 220) : undefined,
    pageText: typeof observation.pageText === "string" ? truncateForLog(observation.pageText, 1200) : undefined,
    domOutline: typeof observation.domOutline === "string" ? truncateForLog(observation.domOutline, 1800) : undefined,
    visibleTextBlocks,
    semanticBlocks,
    interactiveElements,
    finalActionButton: typeof observation.finalActionButton === "string" ? observation.finalActionButton : undefined
  };
}

function summarizePreviousObservationForPlanner(observation: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!observation) {
    return undefined;
  }

  return {
    sessionId: typeof observation.sessionId === "string" ? observation.sessionId : undefined,
    systemId: typeof observation.systemId === "string" ? observation.systemId : undefined,
    title: typeof observation.title === "string" ? observation.title : undefined,
    url: typeof observation.url === "string" ? observation.url : undefined,
    summary: typeof observation.summary === "string" ? truncateForLog(observation.summary, 180) : undefined
  };
}

function summarizeToolResultForPlanner(toolResult: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!toolResult) {
    return undefined;
  }

  const summary: Record<string, unknown> = {};
  for (const key of ["artifact_kind", "summary", "system_id", "session_id", "record_id", "draft_id", "preview_id", "click_id", "target_key", "target_handle"]) {
    if (key in toolResult) {
      summary[key] = toolResult[key];
    }
  }

  if (typeof toolResult.title === "string") {
    summary.title = toolResult.title;
  }
  if (typeof toolResult.url === "string") {
    summary.url = toolResult.url;
  }

  if (Array.isArray(toolResult.messages)) {
    summary.messages = toolResult.messages
      .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
      .slice(0, 3)
      .map((item) => ({
        entry_id: typeof item.entry_id === "string" ? item.entry_id : undefined,
        conversation_id: typeof item.conversation_id === "string" ? item.conversation_id : undefined,
        subject: typeof item.subject === "string" ? truncateForLog(item.subject, 120) : undefined,
        sender: typeof item.sender === "string" ? truncateForLog(item.sender, 100) : undefined,
        recipients: typeof item.recipients === "string" ? truncateForLog(item.recipients, 120) : undefined,
        body_snippet: typeof item.body_snippet === "string" ? truncateForLog(item.body_snippet, 180) : undefined,
        folder: typeof item.folder === "string" ? item.folder : undefined,
        store: typeof item.store === "string" ? item.store : undefined
      }));
  }

  if (toolResult.artifact_kind === "mail_detail") {
    summary.mail_detail = {
      entry_id: typeof toolResult.entry_id === "string" ? toolResult.entry_id : undefined,
      conversation_id: typeof toolResult.conversation_id === "string" ? toolResult.conversation_id : undefined,
      subject: typeof toolResult.subject === "string" ? truncateForLog(toolResult.subject, 140) : undefined,
      sender: typeof toolResult.sender === "string" ? truncateForLog(toolResult.sender, 100) : undefined,
      recipients: typeof toolResult.recipients === "string" ? truncateForLog(toolResult.recipients, 140) : undefined,
      folder: typeof toolResult.folder === "string" ? toolResult.folder : undefined,
      store: typeof toolResult.store === "string" ? toolResult.store : undefined,
      body_snippet:
        typeof toolResult.body_snippet === "string"
          ? truncateForLog(toolResult.body_snippet, 260)
          : typeof toolResult.body === "string"
            ? truncateForLog(toolResult.body, 260)
            : undefined
    };
  }

  if (Array.isArray(toolResult.contacts)) {
    summary.contacts = toolResult.contacts
      .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
      .slice(0, 5)
      .map((item) => ({
        name: typeof item.name === "string" ? truncateForLog(item.name, 80) : undefined,
        email: typeof item.email === "string" ? truncateForLog(item.email, 120) : undefined,
        display: typeof item.display === "string" ? truncateForLog(item.display, 140) : undefined,
        source: typeof item.source === "string" ? item.source : undefined,
        list_name: typeof item.list_name === "string" ? truncateForLog(item.list_name, 80) : undefined,
        company: typeof item.company === "string" ? truncateForLog(item.company, 80) : undefined,
        department: typeof item.department === "string" ? truncateForLog(item.department, 80) : undefined,
        job_title: typeof item.job_title === "string" ? truncateForLog(item.job_title, 80) : undefined,
        alias: typeof item.alias === "string" ? truncateForLog(item.alias, 80) : undefined,
        entry_id: typeof item.entry_id === "string" ? item.entry_id : undefined
      }));
  }

  if (toolResult.artifact_kind === "mail_draft" || toolResult.artifact_kind === "mail_draft_preview") {
    summary.draft = {
      draft_id: typeof toolResult.draft_id === "string" ? toolResult.draft_id : undefined,
      subject: typeof toolResult.subject === "string" ? truncateForLog(toolResult.subject, 140) : undefined,
      to: Array.isArray(toolResult.to)
        ? toolResult.to
            .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
            .slice(0, 3)
            .map((item) => truncateForLog(item, 120))
        : undefined,
      cc: Array.isArray(toolResult.cc)
        ? toolResult.cc
            .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
            .slice(0, 3)
            .map((item) => truncateForLog(item, 120))
        : undefined,
      preview_summary: typeof toolResult.preview_summary === "string" ? truncateForLog(toolResult.preview_summary, 180) : undefined
    };
  }

  const clickTarget =
    typeof toolResult.click_target === "object" && toolResult.click_target !== null
      ? (toolResult.click_target as Record<string, unknown>)
      : undefined;
  if (clickTarget) {
    summary.click_target = {
      handle: typeof clickTarget.handle === "string" ? clickTarget.handle : undefined,
      key: typeof clickTarget.key === "string" ? clickTarget.key : undefined,
      label: typeof clickTarget.label === "string" ? truncateForLog(clickTarget.label, 120) : undefined,
      nearbyText: typeof clickTarget.nearbyText === "string" ? truncateForLog(clickTarget.nearbyText, 160) : undefined
    };
  }

  return summary;
}

function summarizeMailEvidenceForPlanner(
  steps: Array<Record<string, unknown>>,
  lastToolResult: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  const candidates: Array<Record<string, unknown>> = [];
  if (lastToolResult) {
    candidates.push(lastToolResult);
  }

  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (step.success !== true) {
      continue;
    }
    const toolResult =
      typeof step.tool_result === "object" && step.tool_result !== null
        ? (step.tool_result as Record<string, unknown>)
        : undefined;
    const output =
      typeof toolResult?.output === "object" && toolResult.output !== null
        ? (toolResult.output as Record<string, unknown>)
        : undefined;
    if (output) {
      candidates.push(output);
    }
  }

  for (const candidate of candidates) {
    const artifactKind = typeof candidate.artifact_kind === "string" ? candidate.artifact_kind : "";
    if (artifactKind === "mail_detail") {
      return {
        artifact_kind: "mail_detail",
        entry_id: typeof candidate.entry_id === "string" ? candidate.entry_id : undefined,
        conversation_id: typeof candidate.conversation_id === "string" ? candidate.conversation_id : undefined,
        subject: typeof candidate.subject === "string" ? truncateForLog(candidate.subject, 140) : undefined,
        sender: typeof candidate.sender === "string" ? truncateForLog(candidate.sender, 100) : undefined,
        recipients: typeof candidate.recipients === "string" ? truncateForLog(candidate.recipients, 140) : undefined,
        body_snippet:
          typeof candidate.body_snippet === "string"
            ? truncateForLog(candidate.body_snippet, 320)
            : typeof candidate.body === "string"
              ? truncateForLog(candidate.body, 320)
              : undefined
      };
    }

    if (artifactKind === "mail_conversation" && Array.isArray(candidate.messages)) {
      return {
        artifact_kind: "mail_conversation",
        conversation_id: typeof candidate.conversation_id === "string" ? candidate.conversation_id : undefined,
        count: typeof candidate.count === "number" ? candidate.count : undefined,
        messages: candidate.messages
          .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
          .slice(0, 3)
          .map((item) => ({
            entry_id: typeof item.entry_id === "string" ? item.entry_id : undefined,
            subject: typeof item.subject === "string" ? truncateForLog(item.subject, 140) : undefined,
            sender: typeof item.sender === "string" ? truncateForLog(item.sender, 100) : undefined,
            body_snippet: typeof item.body_snippet === "string" ? truncateForLog(item.body_snippet, 220) : undefined
          }))
      };
    }
  }

  return undefined;
}

function summarizeContactEvidenceForPlanner(
  steps: Array<Record<string, unknown>>,
  lastToolResult: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  const candidates: Array<Record<string, unknown>> = [];
  if (lastToolResult) {
    candidates.push(lastToolResult);
  }

  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (step.success !== true) {
      continue;
    }
    const toolResult =
      typeof step.tool_result === "object" && step.tool_result !== null
        ? (step.tool_result as Record<string, unknown>)
        : undefined;
    const output =
      typeof toolResult?.output === "object" && toolResult.output !== null
        ? (toolResult.output as Record<string, unknown>)
        : undefined;
    if (output) {
      candidates.push(output);
    }
  }

  const aggregatedContacts: Array<Record<string, unknown>> = [];
  const seenEmails = new Set<string>();

  for (const candidate of candidates) {
    const artifactKind = typeof candidate.artifact_kind === "string" ? candidate.artifact_kind : "";
    if (artifactKind !== "contact_search" || !Array.isArray(candidate.contacts)) {
      continue;
    }

    const contacts = candidate.contacts
      .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
      .map((item) => ({
        query: typeof candidate.query === "string" ? truncateForLog(candidate.query, 80) : undefined,
        name: typeof item.name === "string" ? truncateForLog(item.name, 80) : undefined,
        email: typeof item.email === "string" ? truncateForLog(item.email, 120) : undefined,
        display: typeof item.display === "string" ? truncateForLog(item.display, 140) : undefined,
        source: typeof item.source === "string" ? item.source : undefined,
        list_name: typeof item.list_name === "string" ? truncateForLog(item.list_name, 80) : undefined,
        company: typeof item.company === "string" ? truncateForLog(item.company, 80) : undefined,
        department: typeof item.department === "string" ? truncateForLog(item.department, 80) : undefined,
        job_title: typeof item.job_title === "string" ? truncateForLog(item.job_title, 80) : undefined,
        alias: typeof item.alias === "string" ? truncateForLog(item.alias, 80) : undefined
      }))
      .filter((item) => typeof item.email === "string" && item.email.trim().length > 0);

    for (const contact of contacts) {
      const email = typeof contact.email === "string" ? contact.email.toLowerCase() : "";
      if (!email || seenEmails.has(email)) {
        continue;
      }
      seenEmails.add(email);
      aggregatedContacts.push(contact);
      if (aggregatedContacts.length >= 6) {
        break;
      }
    }

    if (aggregatedContacts.length >= 6) {
      break;
    }
  }

  if (aggregatedContacts.length === 0) {
    return undefined;
  }

  const queries = Array.from(
    new Set(
      aggregatedContacts
        .map((item) => (typeof item.query === "string" ? item.query : ""))
        .filter((value) => value.length > 0)
    )
  ).slice(0, 3);

  return {
    artifact_kind: "contact_search",
    queries,
    contacts: aggregatedContacts.map(({ query, ...contact }) => contact)
  };
}

function summarizeDraftEvidenceForPlanner(
  steps: Array<Record<string, unknown>>,
  lastToolResult: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  const candidates: Array<Record<string, unknown>> = [];
  if (lastToolResult) {
    candidates.push(lastToolResult);
  }

  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (step.success !== true) {
      continue;
    }
    const toolResult =
      typeof step.tool_result === "object" && step.tool_result !== null
        ? (step.tool_result as Record<string, unknown>)
        : undefined;
    const output =
      typeof toolResult?.output === "object" && toolResult.output !== null
        ? (toolResult.output as Record<string, unknown>)
        : undefined;
    if (output) {
      candidates.push(output);
    }
  }

  for (const candidate of candidates) {
    const artifactKind = typeof candidate.artifact_kind === "string" ? candidate.artifact_kind : "";
    if (artifactKind !== "mail_draft" && artifactKind !== "mail_draft_preview") {
      continue;
    }
    return {
      artifact_kind: artifactKind,
      draft_id: typeof candidate.draft_id === "string" ? candidate.draft_id : undefined,
      subject: typeof candidate.subject === "string" ? truncateForLog(candidate.subject, 140) : undefined,
      to: Array.isArray(candidate.to)
        ? candidate.to
            .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
            .slice(0, 3)
            .map((item) => truncateForLog(item, 120))
        : undefined,
      cc: Array.isArray(candidate.cc)
        ? candidate.cc
            .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
            .slice(0, 3)
            .map((item) => truncateForLog(item, 120))
        : undefined,
      preview_summary: typeof candidate.preview_summary === "string" ? truncateForLog(candidate.preview_summary, 180) : undefined
    };
  }

  return undefined;
}
