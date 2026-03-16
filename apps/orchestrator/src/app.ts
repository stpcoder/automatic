import Fastify, { type FastifyInstance } from "fastify";

import { browserBridgeCoordinator } from "../../../packages/browser-bridge/src/index.js";
import { approvalDecisionInputSchema, createCaseInputSchema, incomingEmailPayloadSchema } from "../../../packages/contracts/src/index.js";
import { buildBookmarkletBridgeScript } from "../../../workers/web-worker/src/bookmarklet-script.js";
import { getWebSystemDefinition } from "../../../workers/web-worker/src/system-definitions.js";
import { OrchestratorService } from "./orchestrator.js";
import { renderApprovalsPage, renderCaseDetailPage } from "./ui.js";

export async function createApp(orchestrator?: OrchestratorService): Promise<FastifyInstance> {
  const resolvedOrchestrator = orchestrator ?? (await OrchestratorService.createDefault());
  const app = Fastify({ logger: false });
  const defaultPort = process.env.ORCHESTRATOR_PORT ?? "43117";
  const defaultHost = `127.0.0.1:${defaultPort}`;

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
