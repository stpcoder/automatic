import Fastify, { type FastifyInstance } from "fastify";

import { browserBridgeCoordinator } from "../../../packages/browser-bridge/src/index.js";
import { approvalDecisionInputSchema, createCaseInputSchema, incomingEmailPayloadSchema } from "../../../packages/contracts/src/index.js";
import { OutlookWorker } from "../../../workers/outlook-worker/src/index.js";
import { OutlookComAdapter } from "../../../workers/outlook-worker/src/outlook-com-adapter.js";
import { HttpOutlookReplyEventSink, OutlookReplyPoller } from "../../../workers/outlook-worker/src/reply-poller.js";
import { buildBookmarkletBridgeScript } from "../../../workers/web-worker/src/bookmarklet-script.js";
import { getWebSystemDefinition, listWebSystemDefinitions } from "../../../workers/web-worker/src/system-definitions.js";
import { WebWorker } from "../../../workers/web-worker/src/index.js";
import { buildDebugLoopPlannerRequest, buildDebugPlannerRequest, createDebugPlanner } from "./debug-agent.js";
import { resolveLlmConfig } from "./llm-config.js";
import { OrchestratorService } from "./orchestrator.js";
import { renderApprovalsPage, renderCaseDetailPage } from "./ui.js";

export async function createApp(orchestrator?: OrchestratorService): Promise<FastifyInstance> {
  const resolvedOrchestrator = orchestrator ?? (await OrchestratorService.createDefault());
  const app = Fastify({ logger: false });
  const defaultPort = process.env.ORCHESTRATOR_PORT ?? "43117";
  const defaultHost = `127.0.0.1:${defaultPort}`;
  const webWorker = new WebWorker();
  const outlookWorker = new OutlookWorker();
  const debugPlanner = createDebugPlanner();
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

  app.get("/bridge/bookmarklet", async (request) => {
    const query = request.query as { systemId?: string };
    const systemId = query.systemId ?? "security_portal";
    const host = request.headers.host ?? defaultHost;
    const script = buildBookmarkletBridgeScript(`http://${host}`, getWebSystemDefinition(systemId));
    return {
      system_id: systemId,
      bookmarklet: `javascript:${encodeURIComponent(script)}`,
      install_instructions: "Create a normal Chrome bookmark and paste the bookmarklet value into the URL field."
    };
  });

  app.get("/bridge/bookmarklet.js", async (request, reply) => {
    const query = request.query as { systemId?: string };
    const systemId = query.systemId ?? "security_portal";
    const host = request.headers.host ?? defaultHost;
    const script = buildBookmarkletBridgeScript(`http://${host}`, getWebSystemDefinition(systemId));
    reply.header("content-type", "application/javascript; charset=utf-8");
    return script;
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
    const body = request.body as { system_id?: string; session_id?: string; field_values?: Record<string, unknown> };
    return webWorker.execute(buildDebugToolRequest("fill_web_form", "draft", {
      system_id: body.system_id ?? "security_portal",
      session_id: body.session_id,
      field_values: body.field_values ?? {}
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

  app.post("/debug/web/extract", async (request) => {
    const body = request.body as { system_id?: string; session_id?: string; goal?: string; query?: string };
    return webWorker.execute(buildDebugToolRequest("extract_web_result", "preview", {
      system_id: body.system_id ?? "security_portal",
      session_id: body.session_id,
      goal: body.goal ?? "",
      query: body.query ?? ""
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
    const body = request.body as { instruction?: string; context?: Record<string, unknown> };
    const instruction = typeof body.instruction === "string" ? body.instruction : "";
    const context = typeof body.context === "object" && body.context !== null ? body.context : {};
    const plannerRequest = buildDebugPlannerRequest(instruction, context, [
      {
        name: "open_system",
        description: "Open a known web system and observe it.",
        input_schema: { system_id: { type: "string" }, page_id: { type: "string" } }
      },
      {
        name: "fill_web_form",
        description: "Fill known fields on the active web system.",
        input_schema: { system_id: { type: "string" }, field_values: { type: "object" } }
      },
      {
        name: "click_web_element",
        description: "Click a specific button or clickable control on the active web system.",
        input_schema: { system_id: { type: "string" }, session_id: { type: "string" }, target_key: { type: "string" } }
      },
      {
        name: "follow_web_navigation",
        description: "Follow same-tab or new-tab navigation after a click and observe the resulting page.",
        input_schema: { system_id: { type: "string" }, session_id: { type: "string" } }
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
        name: "extract_web_result",
        description: "Read the updated page result and determine whether the goal has been satisfied.",
        input_schema: { system_id: { type: "string" }, goal: { type: "string" }, query: { type: "string" } }
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
      logDebugPlannerDecision("run", 1, plannerOutput.next_action.tool, normalizedInput);

      const toolStartedAt = Date.now();
      const toolResult =
        plannerOutput.next_action.tool.includes("web") || plannerOutput.next_action.tool === "open_system"
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
      timing.total_ms = Date.now() - startedAt;
      logDebugAgentFailure("run", 1, error, timing);
      const debugTrace = {
        planner_request: plannerRequest,
        planner_trace: debugPlanner.getTrace(),
        normalized_input: normalizeDebugToolInput("unknown", {}, context, instruction),
        error_message: error instanceof Error ? error.message : String(error),
        timing
      };
      return {
        ok: false,
        error_stage: "debug_agent_run",
        error_message: error instanceof Error ? error.message : String(error),
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
    const body = request.body as { instruction?: string; context?: Record<string, unknown>; max_steps?: number };
    const instruction = typeof body.instruction === "string" ? body.instruction : "";
    const context = typeof body.context === "object" && body.context !== null ? body.context : {};
    const maxSteps = typeof body.max_steps === "number" && body.max_steps > 0 ? Math.min(body.max_steps, 12) : 6;
    const tools = buildDebugToolSpecs();
    let currentObservation: Record<string, unknown> | undefined;
    let lastToolResult: Record<string, unknown> | undefined;
    const steps: Array<Record<string, unknown>> = [];
    const startedAt = Date.now();
    logDebugAgentStart("run-loop", instruction, context);

    for (let stepIndex = 1; stepIndex <= maxSteps; stepIndex += 1) {
      const loopContext = {
        ...context,
        current_observation: currentObservation ?? null,
        last_tool_result: lastToolResult ?? null,
        step_history: steps.map((step) => ({
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

      try {
        const plannerStartedAt = Date.now();
        const plannerOutput = await debugPlanner.plan(plannerRequest);
        stepTiming.planner_ms = Date.now() - plannerStartedAt;
        const normalizedInput = normalizeDebugToolInput(plannerOutput.next_action.tool, plannerOutput.next_action.input, loopContext, instruction);
        logDebugPlannerDecision("run-loop", stepIndex, plannerOutput.next_action.tool, normalizedInput);

        if (plannerOutput.next_action.tool === "finish_task") {
          logDebugAgentFinish(
            "run-loop",
            stepIndex,
            typeof normalizedInput.summary === "string" ? normalizedInput.summary : "Task completed.",
            { total_ms: Date.now() - startedAt }
          );
          const response = {
            ok: true,
            completed: true,
            final_response: typeof normalizedInput.summary === "string" ? normalizedInput.summary : "Task completed.",
            final_result: lastToolResult ?? null,
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
          return response;
        }

        const toolStartedAt = Date.now();
        const toolResult =
          plannerOutput.next_action.tool.includes("web") || plannerOutput.next_action.tool === "open_system"
            ? await webWorker.execute(buildDebugToolRequest(plannerOutput.next_action.tool, selectDebugToolMode(plannerOutput.next_action.tool), normalizedInput))
            : await outlookWorker.execute(buildDebugToolRequest(plannerOutput.next_action.tool, selectDebugToolMode(plannerOutput.next_action.tool), normalizedInput));
        stepTiming.tool_ms = Date.now() - toolStartedAt;
        logDebugToolResult("run-loop", stepIndex, toolResult, stepTiming);

        const observationCandidate =
          typeof toolResult.output.observation === "object" && toolResult.output.observation !== null
            ? (toolResult.output.observation as Record<string, unknown>)
            : undefined;
        currentObservation = observationCandidate ?? currentObservation;
        lastToolResult = toolResult.output;

        steps.push({
          step: stepIndex,
          tool: plannerOutput.next_action.tool,
          planner_request: plannerRequest,
          planner_trace: debugPlanner.getTrace(),
          planner_output: plannerOutput,
          normalized_input: normalizedInput,
          tool_result: toolResult,
          success: toolResult.success,
          timing: stepTiming
        });

        if (!toolResult.success) {
          logDebugAgentFailure("run-loop", stepIndex, String(toolResult.output.error ?? "Tool execution failed"), {
            total_ms: Date.now() - startedAt
          });
          return {
            ok: false,
            completed: false,
            error_stage: "tool_execution",
            error_message: String(toolResult.output.error ?? "Tool execution failed"),
            steps,
            timing: {
              total_ms: Date.now() - startedAt
            }
          };
        }
      } catch (error) {
        logDebugAgentFailure("run-loop", stepIndex, error, {
          total_ms: Date.now() - startedAt
        });
        return {
          ok: false,
          completed: false,
          error_stage: "debug_agent_run_loop",
          error_message: error instanceof Error ? error.message : String(error),
          steps,
          timing: {
            total_ms: Date.now() - startedAt
          },
          debug_trace: {
            planner_trace: debugPlanner.getTrace()
          }
        };
      }
    }

    return {
      ok: false,
      completed: false,
      error_stage: "max_steps_exceeded",
      error_message: `Agent loop exceeded ${maxSteps} steps`,
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
  console.log(`[debug-agent:${mode}] instruction="${truncateForLog(instruction, 140)}" system=${systemId} session=${sessionId}`);
}

function logDebugPlannerDecision(
  mode: "run" | "run-loop",
  step: number,
  toolName: string,
  normalizedInput: Record<string, unknown>
): void {
  console.log(
    `[debug-agent:${mode}] step=${step} tool=${toolName} target=${formatToolTarget(toolName, normalizedInput)}`
  );
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

  console.log(
    `[debug-agent:${mode}] step=${step} result=${toolResult.success ? "ok" : "fail"} session=${sessionId ?? "-"} title="${truncateForLog(title, 80)}" url="${truncateForLog(url, 120)}" summary="${truncateForLog(summary, 120)}" planner_ms=${timing.planner_ms ?? 0} tool_ms=${timing.tool_ms ?? 0}`
  );
}

function logDebugAgentFinish(
  mode: "run" | "run-loop",
  step: number,
  summary: string,
  timing: { total_ms?: number }
): void {
  console.log(
    `[debug-agent:${mode}] step=${step} finish summary="${truncateForLog(summary, 140)}" total_ms=${timing.total_ms ?? 0}`
  );
}

function logDebugAgentFailure(
  mode: "run" | "run-loop",
  step: number,
  error: unknown,
  timing: { total_ms?: number }
): void {
  const message = error instanceof Error ? error.message : String(error);
  console.log(
    `[debug-agent:${mode}] step=${step} error="${truncateForLog(message, 180)}" total_ms=${timing.total_ms ?? 0}`
  );
}

function formatToolTarget(toolName: string, input: Record<string, unknown>): string {
  if (toolName === "open_system") {
    return `system=${stringForLog(input.system_id)} page=${stringForLog(input.page_id)}`;
  }
  if (toolName === "fill_web_form") {
    const fieldValues =
      typeof input.field_values === "object" && input.field_values !== null ? (input.field_values as Record<string, unknown>) : {};
    return `system=${stringForLog(input.system_id)} session=${stringForLog(input.session_id)} fields=${Object.keys(fieldValues).join(",") || "-"}`;
  }
  if (toolName === "click_web_element") {
    return `system=${stringForLog(input.system_id)} session=${stringForLog(input.session_id)} target=${stringForLog(input.target_key)}`;
  }
  if (toolName === "follow_web_navigation") {
    return `system=${stringForLog(input.system_id)} session=${stringForLog(input.session_id)}`;
  }
  if (toolName === "extract_web_result") {
    return `system=${stringForLog(input.system_id)} session=${stringForLog(input.session_id)} query=${truncateForLog(stringForLog(input.query), 60)}`;
  }
  if (toolName === "draft_outlook_mail") {
    const to = Array.isArray(input.to) ? input.to.join(",") : "-";
    return `to=${truncateForLog(to, 80)} template=${stringForLog(input.template_id)}`;
  }
  if (toolName === "search_outlook_mail") {
    return `keyword=${truncateForLog(stringForLog(input.keyword), 80)}`;
  }
  return `input=${truncateForLog(JSON.stringify(input), 120)}`;
}

function stringForLog(value: unknown): string {
  return typeof value === "string" && value.trim().length > 0 ? value : "-";
}

function truncateForLog(value: unknown, maxLength: number): string {
  const text = typeof value === "string" ? value : value == null ? "-" : String(value);
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
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
      description: "Open a known web system and observe it.",
      input_schema: { system_id: { type: "string" }, page_id: { type: "string" } }
    },
    {
      name: "fill_web_form",
      description: "Fill known fields on the active web system.",
      input_schema: { system_id: { type: "string" }, field_values: { type: "object" } }
    },
    {
      name: "click_web_element",
      description: "Click a specific button or clickable control on the active web system.",
      input_schema: { system_id: { type: "string" }, session_id: { type: "string" }, target_key: { type: "string" } }
    },
    {
      name: "follow_web_navigation",
      description: "Follow same-tab or new-tab navigation after a click and observe the resulting page.",
      input_schema: { system_id: { type: "string" }, session_id: { type: "string" } }
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
      name: "extract_web_result",
      description: "Read the updated page result and determine whether the goal has been satisfied.",
      input_schema: { system_id: { type: "string" }, goal: { type: "string" }, query: { type: "string" } }
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

  if (toolName === "open_system" || toolName.includes("web")) {
    if (typeof normalized.session_id !== "string" || normalized.session_id.trim().length === 0) {
      normalized.session_id = inferSessionIdFromContext(context);
    }
    if (typeof normalized.system_id !== "string" || normalized.system_id.trim().length === 0) {
      normalized.system_id = inferSystemIdFromContext(context, instruction);
    }
    if (toolName === "submit_web_form" && (typeof normalized.expected_button !== "string" || normalized.expected_button.trim().length === 0)) {
      normalized.expected_button =
        typeof context.expected_button === "string" && context.expected_button.trim().length > 0
          ? context.expected_button
          : inferExpectedButtonFromSystem(String(normalized.system_id));
    }
    if (toolName === "fill_web_form" && (typeof normalized.field_values !== "object" || normalized.field_values === null)) {
      normalized.field_values = typeof context.field_values === "object" && context.field_values !== null ? context.field_values : {};
    }
    if (toolName === "click_web_element" && (typeof normalized.target_key !== "string" || normalized.target_key.trim().length === 0)) {
      normalized.target_key =
        typeof context.target_key === "string" && context.target_key.trim().length > 0
          ? context.target_key
          : inferExpectedButtonFromSystem(String(normalized.system_id));
    }
    if (toolName === "extract_web_result") {
      if (typeof normalized.goal !== "string" || normalized.goal.trim().length === 0) {
        normalized.goal = instruction;
      }
      if (typeof normalized.query !== "string" || normalized.query.trim().length === 0) {
        const fieldValues =
          typeof context.field_values === "object" && context.field_values !== null ? (context.field_values as Record<string, unknown>) : {};
        normalized.query = typeof fieldValues.query === "string" ? fieldValues.query : "";
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

function inferSystemIdFromContext(context: Record<string, unknown>, instruction: string): string {
  if (typeof context.system_id === "string" && context.system_id.trim().length > 0) {
    return context.system_id;
  }

  const normalized = instruction.toLowerCase();
  if (normalized.includes("naver") || normalized.includes("네이버") || normalized.includes("stock") || normalized.includes("주가")) {
    return "naver_search";
  }
  if (normalized.includes("security") || normalized.includes("보안")) {
    return "security_portal";
  }
  if (normalized.includes("dhl")) {
    return "dhl";
  }
  if (normalized.includes("cube") || normalized.includes("메신저") || normalized.includes("chat")) {
    return "cube";
  }
  return "security_portal";
}

function inferExpectedButtonFromSystem(systemId: string): string {
  if (systemId === "naver_search") {
    return "search";
  }
  if (systemId === "security_portal") {
    return "등록";
  }
  if (systemId === "cube") {
    return "Send";
  }
  return "Submit";
}
