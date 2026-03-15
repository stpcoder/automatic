import Fastify from "fastify";

import { approvalDecisionInputSchema, createCaseInputSchema, incomingEmailPayloadSchema } from "../../../packages/contracts/src/index.js";
import { OrchestratorService } from "./orchestrator.js";

const app = Fastify({ logger: true });
const orchestrator = await OrchestratorService.createDefault();

app.get("/health", async () => ({ ok: true }));

app.post("/cases", async (request, reply) => {
  const body = createCaseInputSchema.parse(request.body);
  const record = orchestrator.createCase(body);
  reply.code(201);
  return record;
});

app.get("/cases/:caseId", async (request) => {
  const params = request.params as { caseId: string };
  return {
    case: orchestrator.getCase(params.caseId),
    approvals: orchestrator.listApprovals(params.caseId),
    artifacts: orchestrator.listArtifacts(params.caseId),
    events: orchestrator.listEvents(params.caseId)
  };
});

app.post("/cases/:caseId/advance", async (request) => {
  const params = request.params as { caseId: string };
  return orchestrator.advanceCase(params.caseId);
});

app.post("/cases/:caseId/events/email", async (request) => {
  const params = request.params as { caseId: string };
  const body = incomingEmailPayloadSchema.parse(request.body);
  return orchestrator.ingestIncomingEmail(params.caseId, body);
});

app.get("/approvals", async () => {
  return orchestrator.listApprovals();
});

app.post("/approvals/:approvalId/decision", async (request) => {
  const params = request.params as { approvalId: string };
  const body = approvalDecisionInputSchema.parse(request.body);
  return orchestrator.applyApprovalDecision(params.approvalId, body);
});

await app.listen({ host: "0.0.0.0", port: 3000 });
