import path from "node:path";

import {
  approvalDecisionInputSchema,
  approvalSchema,
  artifactSchema,
  caseEventSchema,
  caseRecordSchema,
  createCaseInputSchema,
  incomingEmailPayloadSchema,
  type Approval,
  type ApprovalDecisionInput,
  type Artifact,
  type CaseEvent,
  type CaseState,
  type CaseRecord,
  type Expectation,
  type IncomingEmailPayload,
  type PlannerClient,
  type ToolExecutor,
  type ToolRequest,
  workflowStepSchema
} from "../../../packages/contracts/src/index.js";
import { WorkflowRegistry } from "../../../packages/workflow-registry/src/index.js";
import { SqliteStore } from "./sqlite-store.js";
import { type CaseStore, InMemoryStore } from "./store.js";
import { CompositeToolExecutor } from "./tool-executors.js";

interface OrchestratorOptions {
  registry: WorkflowRegistry;
  toolExecutor: ToolExecutor;
  planner?: PlannerClient;
}

interface AdvanceResult {
  caseRecord: CaseRecord;
  action: string;
  approval?: Approval;
  expectation?: Expectation;
}

export class OrchestratorService {
  constructor(private readonly store: CaseStore, private readonly options: OrchestratorOptions) {}

  static async createDefault(exampleDir = path.resolve(process.cwd(), "examples")): Promise<OrchestratorService> {
    const registry = await WorkflowRegistry.fromExampleDirectory(exampleDir);
    const store = process.env.ORCHESTRATOR_STORE === "sqlite" || process.env.ORCHESTRATOR_DB_PATH
      ? new SqliteStore(path.resolve(process.env.ORCHESTRATOR_DB_PATH ?? path.join(process.cwd(), "data", "orchestrator.sqlite")))
      : new InMemoryStore();
    return new OrchestratorService(store, {
      registry,
      toolExecutor: new CompositeToolExecutor()
    });
  }

  createCase(input: unknown): CaseRecord {
    const parsed = createCaseInputSchema.parse(input);
    const workflow = this.options.registry.getWorkflow(parsed.workflow_id);
    const now = new Date().toISOString();
    const record = caseRecordSchema.parse({
      case_id: `CASE-${crypto.randomUUID()}`,
      workflow_id: parsed.workflow_id,
      state: "READY",
      current_step_id: workflow.steps[0]?.step_id,
      facts: parsed.facts,
      completed_steps: [],
      created_at: now,
      updated_at: now
    });
    this.store.saveCase(record);
    return record;
  }

  getCase(caseId: string): CaseRecord {
    const record = this.store.getCase(caseId);
    if (!record) {
      throw new Error(`Case ${caseId} not found`);
    }
    return record;
  }

  listApprovals(caseId?: string): Approval[] {
    return this.store.listApprovals(caseId);
  }

  listEvents(caseId: string): CaseEvent[] {
    return this.store.listEventsForCase(caseId);
  }

  listArtifacts(caseId: string): Artifact[] {
    return this.store.listArtifacts(caseId);
  }

  async advanceCase(caseId: string): Promise<AdvanceResult> {
    let current = this.getCase(caseId);
    for (let iteration = 0; iteration < 10; iteration += 1) {
      if (current.state === "APPROVAL_REQUIRED") {
        return { caseRecord: current, action: "awaiting_approval" };
      }
      if (current.state.startsWith("WAITING_")) {
        return { caseRecord: current, action: "awaiting_event" };
      }
      if (current.state === "COMPLETED") {
        return { caseRecord: current, action: "already_completed" };
      }

      const step = workflowStepSchema.parse(this.options.registry.getStep(current.workflow_id, current.current_step_id));
      this.assertRequiredFacts(step.required_inputs, current.facts, step.step_id);

      const draftTool = step.allowed_tools.find((tool) => tool.startsWith("draft_") || tool === "fill_web_form");
      const commitTool = step.allowed_tools.find((tool) => step.approval_policy?.required_before.includes(tool));

      if (draftTool) {
        const artifacts = this.store.listArtifactsForStep(caseId, step.step_id);
        const existingDraft = artifacts.find((artifact) => artifact.kind === this.mapArtifactKind(draftTool));
        if (!existingDraft) {
          const result = await this.runTool(current, step.step_id, draftTool, this.defaultInputForTool(current, step.step_id, draftTool));
          const artifact = this.captureArtifact(current, step.step_id, result.output, this.mapArtifactKind(draftTool));
          this.store.addArtifact(artifact);
          const nextState = commitTool ? "DRAFT_READY" : "RUNNING";
          current = this.updateCase(current, { state: nextState });
          return { caseRecord: current, action: `drafted:${draftTool}` };
        }
      }

      if (commitTool) {
        const approvals = this.store.listApprovalsForStep(caseId, step.step_id);
        const approved = approvals.find((approval) => approval.status === "approved" && approval.action_type === commitTool);
        const sentArtifactExists = this.store.listArtifactsForStep(caseId, step.step_id).some((artifact) => artifact.kind === this.mapArtifactKind(commitTool));

        if (!approved) {
          const existingApproval = approvals.find((approval) => approval.status === "pending" && approval.action_type === commitTool);
          const approval = existingApproval ?? this.createApproval(current, step.step_id, commitTool, step.checklist);
          if (!existingApproval) {
            this.store.addApproval(approval);
          }
          current = this.updateCase(current, { state: "APPROVAL_REQUIRED" });
          return { caseRecord: current, action: `approval_requested:${commitTool}`, approval };
        }

        if (!sentArtifactExists) {
          const result = await this.runTool(current, step.step_id, commitTool, this.defaultInputForTool(current, step.step_id, commitTool));
          const artifact = this.captureArtifact(current, step.step_id, result.output, this.mapArtifactKind(commitTool));
          this.store.addArtifact(artifact);

          if (step.waiting) {
            const watchTool = step.allowed_tools.find((tool) => tool.startsWith("watch_"));
            if (watchTool) {
              await this.runTool(current, step.step_id, watchTool, this.defaultInputForTool(current, step.step_id, watchTool));
            }
            const expectation = this.createExpectation(current, step.step_id, step.waiting, artifact.metadata.conversation_id as string | undefined);
            this.store.addExpectation(expectation);
            current = this.updateCase(current, { state: this.waitingStateFor(step.waiting.type) });
            return { caseRecord: current, action: `waiting:${step.waiting.type}`, expectation };
          }
        }
      }

      const completion = this.completeStepAndMove(current, step.step_id);
      current = completion.caseRecord;
      if (current.state !== "READY") {
        return completion;
      }
    }

    throw new Error(`Advance loop exceeded safety limit for case ${caseId}`);
  }

  applyApprovalDecision(approvalId: string, input: unknown): Approval {
    const decision = approvalDecisionInputSchema.parse(input);
    const approval = this.store.getApproval(approvalId);
    if (!approval) {
      throw new Error(`Approval ${approvalId} not found`);
    }

    const updated = approvalSchema.parse({
      ...approval,
      status: this.mapDecisionToStatus(decision),
      decided_by: decision.actor,
      decided_at: new Date().toISOString()
    });
    this.store.addApproval(updated);

    const record = this.getCase(updated.case_id);
    const state = updated.status === "approved" ? "READY" : "FAILED";
    this.updateCase(record, { state });

    this.store.addEvent(
      caseEventSchema.parse({
        event_id: crypto.randomUUID(),
        case_id: updated.case_id,
        event_type: updated.status === "approved" ? "approval_granted" : "approval_rejected",
        payload: { approval_id: approvalId, action_type: updated.action_type },
        source: "approval-ui",
        created_at: new Date().toISOString()
      })
    );

    return updated;
  }

  ingestIncomingEmail(caseId: string, payload: unknown): AdvanceResult {
    const parsed = incomingEmailPayloadSchema.parse(payload);
    const record = this.getCase(caseId);
    const event = caseEventSchema.parse({
      event_id: crypto.randomUUID(),
      case_id: caseId,
      event_type: "incoming_email",
      payload: parsed,
      source: "outlook-worker",
      created_at: new Date().toISOString()
    });
    this.store.addEvent(event);

    const expectation = this.store
      .listExpectationsForCase(caseId)
      .find((candidate) => candidate.status === "waiting" && this.matchesIncomingEmail(candidate, parsed));

    if (!expectation) {
      return { caseRecord: record, action: "email_ignored" };
    }

    const mergedFacts = { ...record.facts, ...parsed.extracted_fields } as CaseRecord["facts"];
    const updatedExpectation = {
      ...expectation,
      status: "fulfilled" as const
    };
    this.store.addExpectation(updatedExpectation);

    const completed = this.completeStepAndMove(record, expectation.step_id);
    const updatedCase = this.updateCase(completed.caseRecord, { facts: mergedFacts, state: "READY" });
    return { caseRecord: updatedCase, action: "email_matched", expectation: updatedExpectation };
  }

  private completeStepAndMove(record: CaseRecord, stepId: string): AdvanceResult {
    const nextStep = this.options.registry.getNextStep(record.workflow_id, stepId);
    const completedSteps = [...new Set([...record.completed_steps, stepId])];
    const nextState = nextStep ? "READY" : "COMPLETED";
    const updated = this.updateCase(record, {
      completed_steps: completedSteps,
      current_step_id: nextStep?.step_id ?? stepId,
      state: nextState
    });
    return { caseRecord: updated, action: nextStep ? `advanced:${nextStep.step_id}` : "completed" };
  }

  private assertRequiredFacts(requiredInputs: string[], facts: CaseRecord["facts"], stepId: string): void {
    const missing = requiredInputs.filter((input) => facts[input] === undefined || facts[input] === null || facts[input] === "");
    if (missing.length > 0) {
      throw new Error(`Missing required facts for step ${stepId}: ${missing.join(", ")}`);
    }
  }

  private async runTool(record: CaseRecord, stepId: string, toolName: string, input: Record<string, unknown>): Promise<{ output: Record<string, unknown> }> {
    const request: ToolRequest = {
      request_id: `TR-${crypto.randomUUID()}`,
      case_id: record.case_id,
      step_id: stepId,
      tool_name: toolName,
      mode: this.modeForTool(toolName),
      input
    };
    const result = await this.options.toolExecutor.execute(request);
    if (!result.success) {
      throw new Error(`Tool ${toolName} failed`);
    }
    for (const event of result.emitted_events) {
      this.store.addEvent(event);
    }
    return { output: result.output };
  }

  private createApproval(record: CaseRecord, stepId: string, actionType: string, checklist: string[]): Approval {
    const previewArtifact = this.store.listArtifactsForStep(record.case_id, stepId).slice(-1)[0];
    return approvalSchema.parse({
      approval_id: `APP-${crypto.randomUUID()}`,
      case_id: record.case_id,
      step_id: stepId,
      action_type: actionType,
      status: "pending",
      preview: {
        action_type: actionType,
        summary: `Approval required for ${actionType}`,
        payload: previewArtifact?.metadata ?? {}
      },
      checklist,
      requested_at: new Date().toISOString()
    });
  }

  private createExpectation(record: CaseRecord, stepId: string, waiting: NonNullable<ReturnType<typeof workflowStepSchema.parse>["waiting"]>, conversationId?: string): Expectation {
    const now = Date.now();
    return {
      expectation_id: `EXP-${crypto.randomUUID()}`,
      case_id: record.case_id,
      step_id: stepId,
      type: waiting.type,
      status: "waiting",
      matcher: {
        expected_from: (waiting.expected_from ?? []).map((value) => this.interpolateValue(value, record.facts)),
        conversation_id: conversationId,
        required_fields: waiting.required_fields
      },
      remind_at: new Date(now + waiting.remind_after_minutes * 60_000).toISOString(),
      escalate_at: new Date(now + waiting.escalate_after_minutes * 60_000).toISOString()
    };
  }

  private captureArtifact(record: CaseRecord, stepId: string, output: Record<string, unknown>, fallbackKind: string): Artifact {
    return artifactSchema.parse({
      artifact_id: `ART-${crypto.randomUUID()}`,
      case_id: record.case_id,
      step_id: stepId,
      kind: typeof output.artifact_kind === "string" ? output.artifact_kind : fallbackKind,
      external_id: typeof output.draft_id === "string" ? output.draft_id : typeof output.message_id === "string" ? output.message_id : typeof output.record_id === "string" ? output.record_id : undefined,
      metadata: output
    });
  }

  private updateCase(record: CaseRecord, patch: Partial<CaseRecord>): CaseRecord {
    const updated = caseRecordSchema.parse({
      ...record,
      ...patch,
      updated_at: new Date().toISOString()
    });
    this.store.saveCase(updated);
    return updated;
  }

  private matchesIncomingEmail(expectation: Expectation, payload: IncomingEmailPayload): boolean {
    const senderMatches =
      expectation.matcher.expected_from.length === 0 || expectation.matcher.expected_from.includes(payload.sender);
    const conversationMatches =
      !expectation.matcher.conversation_id || expectation.matcher.conversation_id === payload.conversation_id;
    const requiredFieldsPresent = expectation.matcher.required_fields.every((field) => payload.extracted_fields[field] !== undefined);
    return senderMatches && conversationMatches && requiredFieldsPresent;
  }

  private mapDecisionToStatus(input: ApprovalDecisionInput): Approval["status"] {
    switch (input.decision) {
      case "approve":
        return "approved";
      case "reject":
        return "rejected";
      case "request_revision":
        return "revision_requested";
    }
  }

  private waitingStateFor(type: Expectation["type"]): CaseState {
    switch (type) {
      case "email_reply":
        return "WAITING_EMAIL";
      case "chat_reply":
        return "WAITING_CHAT";
      case "human_confirmation":
        return "WAITING_HUMAN";
      case "system_update":
        return "WAITING_SYSTEM";
    }
  }

  private modeForTool(toolName: string): ToolRequest["mode"] {
    if (toolName.startsWith("draft_") || toolName === "fill_web_form") {
      return "draft";
    }
    if (toolName.startsWith("submit_") || toolName.startsWith("send_") || toolName.startsWith("create_")) {
      return "commit";
    }
    return "preview";
  }

  private mapArtifactKind(toolName: string): string {
    if (toolName.includes("outlook_mail")) {
      return toolName.startsWith("draft_") ? "mail_draft" : "sent_mail";
    }
    if (toolName.includes("web_form")) {
      return toolName.startsWith("submit_") ? "web_submission" : "web_draft";
    }
    if (toolName === "preview_web_submission") {
      return "web_preview";
    }
    return toolName;
  }

  private defaultInputForTool(record: CaseRecord, stepId: string, toolName: string): Record<string, unknown> {
    switch (toolName) {
      case "draft_outlook_mail":
        return {
          template_id: stepId === "request_customs_number" ? "request_customs_number" : "notify_security_request",
          to: [record.facts.vendor_email].filter(Boolean),
          cc: [],
          variables: record.facts
        };
      case "send_outlook_mail": {
        const draft = this.store.listArtifactsForStep(record.case_id, stepId).find((artifact) => artifact.kind === "mail_draft");
        return { draft_id: draft?.external_id };
      }
      case "watch_email_reply": {
        const sent = this.store.listArtifactsForStep(record.case_id, stepId).find((artifact) => artifact.kind === "sent_mail");
        return {
          case_id: record.case_id,
          expected_from: [record.facts.vendor_email].filter(Boolean),
          conversation_id: sent?.metadata.conversation_id,
          required_fields: ["customs_number"],
          remind_after_minutes: 1440,
          escalate_after_minutes: 2880
        };
      }
      case "fill_web_form":
        return {
          system_id: stepId === "register_security_portal" ? "security_portal" : "dhl",
          field_values: record.facts
        };
      case "preview_web_submission":
        return {
          system_id: stepId === "register_security_portal" ? "security_portal" : "dhl"
        };
      case "submit_web_form":
        return {
          system_id: stepId === "register_security_portal" ? "security_portal" : "dhl",
          expected_button: stepId === "register_security_portal" ? "등록" : "Submit"
        };
      default:
        return {};
    }
  }

  private interpolateValue(template: string, facts: CaseRecord["facts"]): string {
    return template.replace(/\{([^}]+)\}/g, (_match, key) => String(facts[key] ?? ""));
  }
}
