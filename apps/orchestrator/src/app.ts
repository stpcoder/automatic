import Fastify, { type FastifyInstance } from "fastify";

import { browserBridgeCoordinator } from "../../../packages/browser-bridge/src/index.js";
import { approvalDecisionInputSchema, createCaseInputSchema, incomingEmailPayloadSchema } from "../../../packages/contracts/src/index.js";
import { OutlookWorker } from "../../../workers/outlook-worker/src/index.js";
import { OutlookComAdapter } from "../../../workers/outlook-worker/src/outlook-com-adapter.js";
import { HttpOutlookReplyEventSink, OutlookReplyPoller } from "../../../workers/outlook-worker/src/reply-poller.js";
import { buildBookmarkletBridgeScript } from "../../../workers/web-worker/src/bookmarklet-script.js";
import { getWebSystemDefinition } from "../../../workers/web-worker/src/system-definitions.js";
import { WebWorker } from "../../../workers/web-worker/src/index.js";
import { buildDebugPlannerRequest, createDebugPlanner } from "./debug-agent.js";
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
    const body = request.body as { system_id?: string; field_values?: Record<string, unknown> };
    return webWorker.execute(buildDebugToolRequest("fill_web_form", "draft", {
      system_id: body.system_id ?? "security_portal",
      field_values: body.field_values ?? {}
    }));
  });

  app.post("/debug/web/preview", async (request) => {
    const body = request.body as { system_id?: string };
    return webWorker.execute(buildDebugToolRequest("preview_web_submission", "preview", {
      system_id: body.system_id ?? "security_portal"
    }));
  });

  app.post("/debug/web/submit", async (request) => {
    const body = request.body as { system_id?: string; expected_button?: string };
    return webWorker.execute(buildDebugToolRequest("submit_web_form", "commit", {
      system_id: body.system_id ?? "security_portal",
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
    try {
      const plannerStartedAt = Date.now();
      const plannerOutput = await debugPlanner.plan(plannerRequest);
      timing.planner_ms = Date.now() - plannerStartedAt;

      const toolStartedAt = Date.now();
      const toolResult =
        plannerOutput.next_action.tool.includes("web") || plannerOutput.next_action.tool === "open_system"
          ? await webWorker.execute(buildDebugToolRequest(plannerOutput.next_action.tool, "preview", plannerOutput.next_action.input))
          : await outlookWorker.execute(buildDebugToolRequest(plannerOutput.next_action.tool, "draft", plannerOutput.next_action.input));
      timing.tool_ms = Date.now() - toolStartedAt;
      timing.total_ms = Date.now() - startedAt;

      const debugTrace = {
        planner_request: plannerRequest,
        planner_trace: debugPlanner.getTrace(),
        planner_output: plannerOutput,
        tool_result: toolResult,
        timing
      };
      console.log("[debug-agent-run]", JSON.stringify(debugTrace, null, 2));

      return {
        ok: true,
        planner_output: plannerOutput,
        tool_result: toolResult,
        timing,
        debug_trace: debugTrace
      };
    } catch (error) {
      timing.total_ms = Date.now() - startedAt;
      const debugTrace = {
        planner_request: plannerRequest,
        planner_trace: debugPlanner.getTrace(),
        error_message: error instanceof Error ? error.message : String(error),
        timing
      };
      console.error("[debug-agent-run]", JSON.stringify(debugTrace, null, 2));
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

  app.post("/bridge/sessions/register", async (request) => {
    const body = request.body as { session_id: string; system_id: string; title?: string; url?: string };
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
