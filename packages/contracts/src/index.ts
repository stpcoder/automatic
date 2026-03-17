import { z } from "zod";

export const toolModeSchema = z.enum(["draft", "preview", "commit"]);
export type ToolMode = z.infer<typeof toolModeSchema>;

export const caseStateSchema = z.enum([
  "READY",
  "RUNNING",
  "DRAFT_READY",
  "APPROVAL_REQUIRED",
  "WAITING_EMAIL",
  "WAITING_CHAT",
  "WAITING_HUMAN",
  "WAITING_SYSTEM",
  "COMPLETED",
  "FAILED",
  "ESCALATED"
]);
export type CaseState = z.infer<typeof caseStateSchema>;

export const eventTypeSchema = z.enum([
  "incoming_email",
  "incoming_chat",
  "web_status_changed",
  "approval_granted",
  "approval_rejected",
  "human_task_confirmed",
  "deadline_passed",
  "manual_resume"
]);
export type EventType = z.infer<typeof eventTypeSchema>;

export const expectationStatusSchema = z.enum(["waiting", "fulfilled", "expired", "cancelled"]);
export type ExpectationStatus = z.infer<typeof expectationStatusSchema>;

export const approvalStatusSchema = z.enum(["pending", "approved", "rejected", "revision_requested"]);
export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;

export const workflowWaitingSchema = z.object({
  type: z.enum(["email_reply", "chat_reply", "human_confirmation", "system_update"]),
  expected_from: z.array(z.string()).optional(),
  required_fields: z.array(z.string()).default([]),
  remind_after_minutes: z.number().int().positive(),
  escalate_after_minutes: z.number().int().positive()
});
export type WorkflowWaiting = z.infer<typeof workflowWaitingSchema>;

export const workflowStepSchema = z.object({
  step_id: z.string(),
  goal: z.string(),
  required_inputs: z.array(z.string()).default([]),
  checklist: z.array(z.string()).default([]),
  allowed_tools: z.array(z.string()).default([]),
  approval_policy: z
    .object({
      required_before: z.array(z.string()).default([])
    })
    .optional(),
  waiting: workflowWaitingSchema.optional()
});
export type WorkflowStep = z.infer<typeof workflowStepSchema>;

export const workflowDefinitionSchema = z.object({
  workflow: z.object({
    workflow_id: z.string(),
    trigger: z.array(z.string()).default([]),
    steps: z.array(workflowStepSchema)
  })
});
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;

export const expectationMatcherSchema = z.object({
  expected_from: z.array(z.string()).default([]),
  conversation_id: z.string().optional(),
  required_fields: z.array(z.string()).default([]),
  keyword_contains: z.array(z.string()).default([])
});
export type ExpectationMatcher = z.infer<typeof expectationMatcherSchema>;

export const expectationSchema = z.object({
  expectation_id: z.string(),
  case_id: z.string(),
  step_id: z.string(),
  type: workflowWaitingSchema.shape.type,
  status: expectationStatusSchema,
  matcher: expectationMatcherSchema,
  remind_at: z.string(),
  escalate_at: z.string()
});
export type Expectation = z.infer<typeof expectationSchema>;

export const approvalPreviewSchema = z.object({
  action_type: z.string(),
  summary: z.string(),
  payload: z.record(z.string(), z.unknown())
});
export type ApprovalPreview = z.infer<typeof approvalPreviewSchema>;

export const approvalSchema = z.object({
  approval_id: z.string(),
  case_id: z.string(),
  step_id: z.string(),
  action_type: z.string(),
  status: approvalStatusSchema,
  preview: approvalPreviewSchema,
  checklist: z.array(z.string()).default([]),
  requested_at: z.string(),
  decided_at: z.string().optional(),
  decided_by: z.string().optional()
});
export type Approval = z.infer<typeof approvalSchema>;

export const artifactSchema = z.object({
  artifact_id: z.string(),
  case_id: z.string(),
  step_id: z.string(),
  kind: z.string(),
  external_id: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).default({})
});
export type Artifact = z.infer<typeof artifactSchema>;

export const caseFactValueSchema = z.unknown();

export const caseRecordSchema = z.object({
  case_id: z.string(),
  workflow_id: z.string(),
  state: caseStateSchema,
  current_step_id: z.string(),
  facts: z.record(z.string(), caseFactValueSchema),
  completed_steps: z.array(z.string()).default([]),
  created_at: z.string(),
  updated_at: z.string()
});
export type CaseRecord = z.infer<typeof caseRecordSchema>;

export const caseEventSchema = z.object({
  event_id: z.string(),
  case_id: z.string(),
  event_type: eventTypeSchema,
  payload: z.record(z.string(), z.unknown()),
  source: z.string(),
  created_at: z.string()
});
export type CaseEvent = z.infer<typeof caseEventSchema>;

export const plannerMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string()
});
export type PlannerMessage = z.infer<typeof plannerMessageSchema>;

export const plannerRequestSchema = z.object({
  model: z.string().optional(),
  messages: z.array(plannerMessageSchema),
  tools: z
    .array(
      z.object({
        name: z.string(),
        description: z.string(),
        input_schema: z.record(z.string(), z.unknown()).default({})
      })
    )
    .default([])
});
export type PlannerRequest = z.infer<typeof plannerRequestSchema>;

export const plannerActionSchema = z.object({
  tool: z.string(),
  input: z.record(z.string(), z.unknown()).default({})
});
export type PlannerAction = z.infer<typeof plannerActionSchema>;

export const plannerGlobalPlanStepSchema = z.object({
  step_id: z.string(),
  title: z.string(),
  description: z.string().default(""),
  completion_signals: z.array(z.string()).default([])
});
export type PlannerGlobalPlanStep = z.infer<typeof plannerGlobalPlanStepSchema>;

export const plannerGlobalPlanSchema = z.object({
  goal: z.string(),
  success_criteria: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([]),
  steps: z.array(plannerGlobalPlanStepSchema).default([]),
  current_step_id: z.string().optional(),
  progress_summary: z.string().default("")
});
export type PlannerGlobalPlan = z.infer<typeof plannerGlobalPlanSchema>;

export const plannerStepPlanSchema = z.object({
  step_id: z.string().optional(),
  current_goal: z.string(),
  action_plan: z.array(z.string()).default([]),
  completion_signals: z.array(z.string()).default([]),
  replan_if: z.array(z.string()).default([])
});
export type PlannerStepPlan = z.infer<typeof plannerStepPlanSchema>;

export const plannerOutputSchema = z.object({
  objective: z.string(),
  rationale: z.string(),
  evaluation_previous_goal: z.string().default(""),
  memory: z.array(z.string()).default([]),
  next_goal: z.string().default(""),
  next_action: plannerActionSchema,
  requires_approval: z.boolean(),
  expected_transition: caseStateSchema,
  global_plan: plannerGlobalPlanSchema.optional(),
  step_plan: plannerStepPlanSchema.optional()
});
export type PlannerOutput = z.infer<typeof plannerOutputSchema>;

export const toolRequestSchema = z.object({
  request_id: z.string(),
  case_id: z.string(),
  step_id: z.string(),
  tool_name: z.string(),
  mode: toolModeSchema,
  input: z.record(z.string(), z.unknown()).default({})
});
export type ToolRequest = z.infer<typeof toolRequestSchema>;

export const toolResultSchema = z.object({
  request_id: z.string(),
  success: z.boolean(),
  output: z.record(z.string(), z.unknown()).default({}),
  memory_patch: z.record(z.string(), z.unknown()).default({}),
  emitted_events: z.array(caseEventSchema).default([])
});
export type ToolResult = z.infer<typeof toolResultSchema>;

export const createCaseInputSchema = z.object({
  workflow_id: z.string(),
  facts: z.record(z.string(), caseFactValueSchema).default({})
});
export type CreateCaseInput = z.infer<typeof createCaseInputSchema>;

export const approvalDecisionInputSchema = z.object({
  decision: z.enum(["approve", "reject", "request_revision"]),
  actor: z.string()
});
export type ApprovalDecisionInput = z.infer<typeof approvalDecisionInputSchema>;

export const incomingEmailPayloadSchema = z.object({
  sender: z.string(),
  subject: z.string(),
  conversation_id: z.string().optional(),
  body: z.string().optional(),
  extracted_fields: z.record(z.string(), z.unknown()).default({})
});
export type IncomingEmailPayload = z.infer<typeof incomingEmailPayloadSchema>;

export const observationSchema = z.object({
  channel: z.string(),
  summary: z.string(),
  payload: z.record(z.string(), z.unknown()).default({})
});
export type Observation = z.infer<typeof observationSchema>;

export interface ToolExecutor {
  execute(request: ToolRequest): Promise<ToolResult>;
}

export interface PlannerClient {
  plan(request: PlannerRequest): Promise<PlannerOutput>;
}
