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

  app.post("/debug/mail/watch", async (request) => {
    const body = request.body as {
      case_id?: string;
      conversation_id?: string;
      expected_from?: string[];
      required_fields?: string[];
    };
    return outlookWorker.execute(buildDebugToolRequest("watch_email_reply", "preview", {
      case_id: body.case_id ?? "DEBUG-CASE",
      conversation_id: body.conversation_id ?? "",
      expected_from: body.expected_from ?? [],
      required_fields: body.required_fields ?? []
    }));
  });

  app.post("/debug/mail/search", async (request) => {
    const body = request.body as { keyword?: string; max_results?: number };
    return outlookWorker.execute(buildDebugToolRequest("search_outlook_mail", "preview", {
      keyword: body.keyword ?? "",
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
        description: "Create an Outlook mail draft.",
        input_schema: { template_id: { type: "string" }, to: { type: "array" }, cc: { type: "array" }, variables: { type: "object" } }
      },
      {
        name: "send_outlook_mail",
        description: "Send a drafted Outlook mail.",
        input_schema: { draft_id: { type: "string" } }
      },
      {
        name: "watch_email_reply",
        description: "Watch for a matching reply in Outlook.",
        input_schema: {
          case_id: { type: "string" },
          conversation_id: { type: "string" },
          expected_from: { type: "array" },
          required_fields: { type: "array" }
        }
      },
      {
        name: "search_outlook_mail",
        description: "Search Outlook mail by keyword.",
        input_schema: {
          keyword: { type: "string" },
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
      logDebugPlannerDecision("run", 1, plannerOutput, plannerOutput.next_action.tool, normalizedInput);

      const toolStartedAt = Date.now();
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
        previous_observation: summarizeObservationForPlanner(previousObservation) ?? null,
        current_observation_signature: currentObservationSignature ?? null,
        last_tool_result: summarizeToolResultForPlanner(lastToolResult) ?? null,
        global_plan: globalPlan ?? null,
        current_step_plan: currentStepPlan ?? null,
        last_failure: lastFailure ?? null,
        stagnation_count: stagnationCount,
        replan_history: replanHistory.slice(-6),
        plan_history: planHistory.slice(-6),
        step_history: steps.slice(-8).map((step) => ({
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
          rationale: plannerOutput.rationale,
          evaluation_previous_goal: plannerOutput.evaluation_previous_goal,
          memory: plannerOutput.memory,
          next_goal: plannerOutput.next_goal,
          global_plan: globalPlan ?? null,
          step_plan: currentStepPlan ?? null
      });

      const normalizedInput = normalizeDebugToolInput(plannerOutput.next_action.tool, plannerOutput.next_action.input, loopContext, instruction);
      logDebugPlannerDecision("run-loop", stepIndex, plannerOutput, plannerOutput.next_action.tool, normalizedInput);

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
  normalizedInput: Record<string, unknown>
): void {
  const planSummary = formatPlannerSummary(plannerOutput);
  if (planSummary.primary) {
    console.log(`[${step}] PLAN  ${planSummary.primary}`);
  }
  for (const detail of planSummary.details) {
    console.log(`[${step}] NOTE  ${detail}`);
  }
  const toolHint = formatToolHint(toolName, normalizedInput);
  console.log(`[${step}] TOOL  ${toolName}${toolHint ? ` -> ${toolHint}` : ""}`);
}

function logDebugToolResult(
  mode: "run" | "run-loop",
  step: number,
  toolResult: { success: boolean; output: Record<string, unknown> },
  timing: { planner_ms?: number; tool_ms?: number; total_ms?: number }
): void {
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
  const pageSummary = [truncateForLog(title, 80), truncateForLog(url, 120)].filter((value) => value && value !== "-").join(" | ");
  console.log(`[${step}] ${status}${clickTargetSummary ? ` ${clickTargetSummary}` : ""}`);
  if (pageSummary) {
    console.log(`[${step}] PAGE  ${pageSummary}`);
  }
  if (summary && summary !== "-") {
    console.log(`[${step}] INFO  ${truncateForLog(summary, 140)}`);
  }
  if (sessionId && sessionId !== "-") {
    console.log(`[${step}] SESSION ${sessionId}`);
  }
  console.log(`[${step}] TIME  llm_api=${timing.planner_ms ?? 0}ms action=${timing.tool_ms ?? 0}ms`);
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

function formatPlannerSummary(plannerOutput: PlannerOutput): { primary: string; details: string[] } {
  const details: string[] = [];
  let primary = "";

  if (typeof plannerOutput.objective === "string" && plannerOutput.objective.trim().length > 0) {
    primary = truncateForLog(plannerOutput.objective, 100);
  }
  if (
    typeof plannerOutput.evaluation_previous_goal === "string" &&
    plannerOutput.evaluation_previous_goal.trim().length > 0
  ) {
    details.push(`Eval: ${truncateForLog(plannerOutput.evaluation_previous_goal, 100)}`);
  }
  if (typeof plannerOutput.next_goal === "string" && plannerOutput.next_goal.trim().length > 0) {
    details.push(`Next: ${truncateForLog(plannerOutput.next_goal, 100)}`);
  }
  if (Array.isArray(plannerOutput.memory) && plannerOutput.memory.length > 0) {
    const memorySummary = plannerOutput.memory
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .slice(0, 2)
      .join(" | ");
    if (memorySummary) {
      details.push(`Memory: ${truncateForLog(memorySummary, 110)}`);
    }
  }

  const globalPlan =
    plannerOutput.global_plan && typeof plannerOutput.global_plan === "object"
      ? (plannerOutput.global_plan as Record<string, unknown>)
      : undefined;
  if (globalPlan) {
    const currentStepId = typeof globalPlan.current_step_id === "string" ? globalPlan.current_step_id : "";
    const progressSummary = typeof globalPlan.progress_summary === "string" ? globalPlan.progress_summary : "";
    if (currentStepId) {
      details.push(`Current step: ${currentStepId}`);
    }
    if (progressSummary) {
      details.push(`Progress: ${truncateForLog(progressSummary, 100)}`);
    }
  }

  const stepPlan =
    plannerOutput.step_plan && typeof plannerOutput.step_plan === "object"
      ? (plannerOutput.step_plan as Record<string, unknown>)
      : undefined;
  if (stepPlan) {
    const currentGoal = typeof stepPlan.current_goal === "string" ? stepPlan.current_goal : "";
    const actionPlan = Array.isArray(stepPlan.action_plan)
      ? stepPlan.action_plan
          .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
          .slice(0, 2)
      : [];
    if (currentGoal) {
      if (!primary) {
        primary = truncateForLog(currentGoal, 100);
      } else {
        details.push(`Step goal: ${truncateForLog(currentGoal, 100)}`);
      }
    }
    if (actionPlan.length > 0) {
      details.push(`Actions: ${truncateForLog(actionPlan.join(" | "), 120)}`);
    }
  }

  if (typeof plannerOutput.rationale === "string" && plannerOutput.rationale.trim().length > 0) {
    details.push(`Why: ${truncateForLog(plannerOutput.rationale, 110)}`);
  }

  return {
    primary: primary || "Continue the task",
    details
  };
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
  if (toolName === "search_outlook_mail") {
    return truncateForLog(stringForLog(input.keyword), 40);
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
      description: "Create an Outlook mail draft.",
      input_schema: { template_id: { type: "string" }, to: { type: "array" }, cc: { type: "array" }, variables: { type: "object" } }
    },
    {
      name: "send_outlook_mail",
      description: "Send a drafted Outlook mail.",
      input_schema: { draft_id: { type: "string" } }
    },
    {
      name: "watch_email_reply",
      description: "Watch for a matching reply in Outlook.",
      input_schema: {
        case_id: { type: "string" },
        conversation_id: { type: "string" },
        expected_from: { type: "array" },
        required_fields: { type: "array" }
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
  if (toolName === "fill_web_form" || toolName === "draft_outlook_mail") {
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

  const observation =
    typeof toolResult.observation === "object" && toolResult.observation !== null
      ? (toolResult.observation as Record<string, unknown>)
      : undefined;
  if (observation) {
    summary.observation = summarizeObservationForPlanner(observation);
  }

  return summary;
}
