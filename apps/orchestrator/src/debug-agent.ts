import {
  type PlannerClient,
  type PlannerOutput,
  type PlannerRequest
} from "../../../packages/contracts/src/index.js";
import { AISDKOpenAICompatiblePlannerClient } from "../../../packages/llm-adapter/src/index.js";
import { resolveLlmConfig } from "./llm-config.js";

export interface DebugAgentToolSpec {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface DebugPlannerClient extends PlannerClient {
  getTrace(): unknown;
}

export function createDebugPlanner(): DebugPlannerClient {
  const config = resolveLlmConfig();
  const heuristicPlanner = createHeuristicDebugPlanner();

  if (config.baseUrl && config.apiKey && config.model) {
    return createFallbackDebugPlanner(
      new AISDKOpenAICompatiblePlannerClient({
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.model,
        timeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? "20000")
      }),
      heuristicPlanner
    );
  }

  return heuristicPlanner;
}

export function createHeuristicDebugPlanner(): DebugPlannerClient {
  return new HeuristicDebugPlanner();
}

export function createFallbackDebugPlanner(primary: DebugPlannerClient, fallback: DebugPlannerClient): DebugPlannerClient {
  return new FallbackDebugPlanner(primary, fallback);
}

export function buildDebugPlannerRequest(instruction: string, context: Record<string, unknown>, tools: DebugAgentToolSpec[]): PlannerRequest {
  return {
    messages: [
      {
        role: "system",
        content:
          "Choose exactly one tool to satisfy the user's instruction. Prefer open_system, fill_web_form, click_web_element, follow_web_navigation, preview_web_submission, submit_web_form, extract_web_result, draft_outlook_mail, send_outlook_mail, watch_email_reply. Use only the provided context and do not assume any site-specific fixed workflow. Return one tool call only."
      },
      {
        role: "user",
        content: JSON.stringify({ instruction, context })
      }
    ],
    tools
  };
}

export function buildDebugLoopPlannerRequest(
  instruction: string,
  context: Record<string, unknown>,
  tools: DebugAgentToolSpec[]
): PlannerRequest {
  return {
    messages: [
      {
        role: "system",
        content:
          "You are an agent loop. Choose exactly one next action. Use only the current observation, the last tool result, the step history, and the available tools. Do not rely on site-specific fixed sequences or site-name keyword shortcuts. First open or attach to a page when there is no current observation. Then inspect interactive elements and visible text to decide whether to type, click, follow navigation, preview, submit, or extract results. Prefer click_web_element for ordinary page interactions like links, tabs, search buttons, and menu entries. Use follow_web_navigation only after an action that can change the page or open a new tab. Reserve submit_web_form for final commits. When the goal is satisfied, call finish_task with a short summary."
      },
      {
        role: "user",
        content: JSON.stringify({ instruction, context })
      }
    ],
    tools
  };
}

class HeuristicDebugPlanner implements DebugPlannerClient {
  private lastTrace: Record<string, unknown> | undefined;

  async plan(request: PlannerRequest): Promise<PlannerOutput> {
    const userContent = [...request.messages].reverse().find((message) => message.role === "user")?.content ?? "{}";
    const parsed = parseDebugPayload(userContent);
    const instruction = normalize(parsed.instruction);
    const context = parsed.context ?? {};
    const systemId = inferSystemId(context);
    const stepHistory = Array.isArray(context.step_history) ? context.step_history.map(asRecord) : [];
    const currentObservation = asRecord(context.current_observation);
    const selectedTools = stepHistory
      .map((step) => (typeof step.tool === "string" ? step.tool : ""))
      .filter((value) => value.length > 0);

    if (selectedTools.length > 0) {
      const loopOutput = planLoopContinuation(instruction, context, systemId, currentObservation, selectedTools);
      if (loopOutput) {
        this.lastTrace = buildHeuristicTrace(request, loopOutput);
        return loopOutput;
      }
    }

    if (shouldOpenWebContext(context, currentObservation) || includesAny(instruction, ["open", "열어", "접속"])) {
      const output = buildOutput("Open target system", "open_system", {
        system_id: systemId,
        target_url: typeof context.target_url === "string" ? context.target_url : undefined,
        url_contains: typeof context.url_contains === "string" ? context.url_contains : undefined,
        title_contains: typeof context.title_contains === "string" ? context.title_contains : undefined,
        session_id: typeof context.session_id === "string" ? context.session_id : undefined,
        open_if_missing: context.open_if_missing === true
      });
      this.lastTrace = buildHeuristicTrace(request, output);
      return output;
    }

    if (includesAny(instruction, ["fill", "채워", "입력"])) {
      const output = buildOutput("Fill target form", "fill_web_form", {
        system_id: systemId,
        field_values: asRecord(context.field_values)
      });
      this.lastTrace = buildHeuristicTrace(request, output);
      return output;
    }

    if (includesAny(instruction, ["click", "press", "누르", "클릭", "search", "검색"])) {
      const targetKey = inferClickTarget(instruction, context);
      if (targetKey) {
        const output = buildOutput("Click target page element", "click_web_element", {
          system_id: systemId,
          target_key: targetKey
        });
        this.lastTrace = buildHeuristicTrace(request, output);
        return output;
      }
    }

    if (includesAny(instruction, ["preview", "미리보기", "검토"])) {
      const output = buildOutput("Preview target submission", "preview_web_submission", {
        system_id: systemId
      });
      this.lastTrace = buildHeuristicTrace(request, output);
      return output;
    }

    if (includesAny(instruction, ["submit", "제출", "등록", "저장"])) {
      const output = buildOutput("Submit target form", "submit_web_form", {
        system_id: systemId,
        expected_button: typeof context.expected_button === "string" ? context.expected_button : "Submit"
      });
      this.lastTrace = buildHeuristicTrace(request, output);
      return output;
    }

    if (includesAny(instruction, ["draft mail", "mail draft", "메일 초안", "메일 작성", "email draft"])) {
      const output = buildOutput("Draft mail", "draft_outlook_mail", {
        template_id: typeof context.template_id === "string" ? context.template_id : "debug_template",
        to: asStringArray(context.to),
        cc: asStringArray(context.cc),
        variables: asRecord(context.variables)
      });
      this.lastTrace = buildHeuristicTrace(request, output);
      return output;
    }

    if (includesAny(instruction, ["send mail", "메일 발송", "메일 보내", "email send"])) {
      const output = buildOutput("Send drafted mail", "send_outlook_mail", {
        draft_id: typeof context.draft_id === "string" ? context.draft_id : ""
      });
      this.lastTrace = buildHeuristicTrace(request, output);
      return output;
    }

    if (includesAny(instruction, ["watch reply", "reply watch", "회신 대기", "회신 감시"])) {
      const output = buildOutput("Register reply watch", "watch_email_reply", {
        case_id: typeof context.case_id === "string" ? context.case_id : "DEBUG-CASE",
        conversation_id: typeof context.conversation_id === "string" ? context.conversation_id : "",
        expected_from: asStringArray(context.expected_from),
        required_fields: asStringArray(context.required_fields)
      });
      this.lastTrace = buildHeuristicTrace(request, output);
      return output;
    }

    if (
      includesAny(instruction, ["search mail", "mail search", "메일 검색", "메일 조회", "mail lookup"]) ||
      (includesAny(instruction, ["조회"]) && includesAny(instruction, ["mail", "email", "outlook", "메일"]))
    ) {
      const output = buildOutput("Search Outlook mail", "search_outlook_mail", {
        keyword: typeof context.keyword === "string" ? context.keyword : parsed.instruction,
        max_results: typeof context.max_results === "number" ? context.max_results : 10
      });
      this.lastTrace = buildHeuristicTrace(request, output);
      return output;
    }

    if (includesAny(instruction, ["extract", "read result", "결과 읽", "결과 확인"])) {
      const output = buildOutput("Extract result from current page", "extract_web_result", {
        system_id: systemId,
        goal: parsed.instruction,
        query: typeof asRecord(context.field_values).query === "string" ? String(asRecord(context.field_values).query) : ""
      });
      this.lastTrace = buildHeuristicTrace(request, output);
      return output;
    }

    if (shouldOpenWebContext(context, currentObservation)) {
      const output = buildOutput("Open target system by default", "open_system", {
        system_id: systemId,
        target_url: typeof context.target_url === "string" ? context.target_url : undefined,
        url_contains: typeof context.url_contains === "string" ? context.url_contains : undefined,
        title_contains: typeof context.title_contains === "string" ? context.title_contains : undefined,
        session_id: typeof context.session_id === "string" ? context.session_id : undefined,
        open_if_missing: context.open_if_missing === true
      });
      this.lastTrace = buildHeuristicTrace(request, output);
      return output;
    }

    throw new Error("No actionable tool inferred from instruction");
  }

  getTrace(): Record<string, unknown> | undefined {
    return this.lastTrace;
  }
}

class FallbackDebugPlanner implements DebugPlannerClient {
  private lastTrace: Record<string, unknown> | undefined;

  constructor(
    private readonly primary: DebugPlannerClient,
    private readonly fallback: DebugPlannerClient
  ) {}

  async plan(request: PlannerRequest): Promise<PlannerOutput> {
    try {
      const output = await this.primary.plan(request);
      this.lastTrace = {
        source: "primary",
        trace: this.primary.getTrace()
      };
      return output;
    } catch (error) {
      if (!shouldFallbackToHeuristic(error)) {
        throw error;
      }
      const output = await this.fallback.plan(request);
      this.lastTrace = {
        source: "fallback",
        primary_error: error instanceof Error ? error.message : String(error),
        trace: this.fallback.getTrace()
      };
      return output;
    }
  }

  getTrace(): Record<string, unknown> | undefined {
    return this.lastTrace;
  }
}

function parseDebugPayload(raw: string): { instruction: string; context: Record<string, unknown> } {
  try {
    const parsed = JSON.parse(raw) as { instruction?: unknown; context?: unknown };
    return {
      instruction: typeof parsed.instruction === "string" ? parsed.instruction : "",
      context: asRecord(parsed.context)
    };
  } catch {
    return {
      instruction: raw,
      context: {}
    };
  }
}

function buildOutput(objective: string, tool: string, input: Record<string, unknown>): PlannerOutput {
  return {
    objective,
    rationale: "Selected by debug planner",
    next_action: {
      tool,
      input
    },
    requires_approval: false,
    expected_transition: "RUNNING"
  };
}

function buildFinishOutput(summary: string): PlannerOutput {
  return {
    objective: "Complete the current task",
    rationale: "Task goal appears satisfied",
    next_action: {
      tool: "finish_task",
      input: {
        summary
      }
    },
    requires_approval: false,
    expected_transition: "COMPLETED"
  };
}

function normalize(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function includesAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((entry) => String(entry)) : [];
}

function observationMeaningfullyChanged(
  previousObservation: Record<string, unknown>,
  currentObservation: Record<string, unknown>
): boolean {
  if (Object.keys(previousObservation).length === 0 || Object.keys(currentObservation).length === 0) {
    return false;
  }

  const previousUrl = typeof previousObservation.url === "string" ? previousObservation.url : "";
  const currentUrl = typeof currentObservation.url === "string" ? currentObservation.url : "";
  if (previousUrl && currentUrl && previousUrl !== currentUrl) {
    return true;
  }

  const previousTitle = typeof previousObservation.title === "string" ? previousObservation.title : "";
  const currentTitle = typeof currentObservation.title === "string" ? currentObservation.title : "";
  if (previousTitle && currentTitle && previousTitle !== currentTitle) {
    return true;
  }

  const previousSummary = typeof previousObservation.summary === "string" ? previousObservation.summary : "";
  const currentSummary = typeof currentObservation.summary === "string" ? currentObservation.summary : "";
  if (previousSummary && currentSummary && previousSummary !== currentSummary) {
    return true;
  }

  const previousPageText = typeof previousObservation.pageText === "string" ? previousObservation.pageText : "";
  const currentPageText = typeof currentObservation.pageText === "string" ? currentObservation.pageText : "";
  return Boolean(previousPageText && currentPageText && previousPageText !== currentPageText);
}

function planLoopContinuation(
  instruction: string,
  context: Record<string, unknown>,
  systemId: string,
  currentObservation: Record<string, unknown>,
  selectedTools: string[]
): PlannerOutput | null {
  const normalizedInstruction = normalize(instruction);
  const fieldValues = asRecord(context.field_values);
  const interactiveElements = Array.isArray(currentObservation.interactiveElements)
    ? currentObservation.interactiveElements.map(asRecord)
    : [];
  const lastToolResult = asRecord(context.last_tool_result);
  const lastSelectedTool = selectedTools[selectedTools.length - 1] ?? "";
  const currentSessionId =
    typeof currentObservation.sessionId === "string"
      ? currentObservation.sessionId
      : typeof lastToolResult.session_id === "string"
        ? lastToolResult.session_id
        : typeof context.session_id === "string"
          ? context.session_id
          : undefined;
  const currentPageText = typeof currentObservation.pageText === "string" ? currentObservation.pageText : "";
  const currentVisibleTextBlocks = Array.isArray(currentObservation.visibleTextBlocks)
    ? currentObservation.visibleTextBlocks.map((value) => String(value))
    : [];
  const previousObservation = asRecord(context.previous_observation);

  if (selectedTools.includes("search_outlook_mail")) {
    return buildFinishOutput(`Mail search completed for keyword ${String(context.keyword ?? "").trim() || "query"}.`);
  }

  if (selectedTools.includes("draft_outlook_mail") && !includesAny(normalizedInstruction, ["send", "발송", "보내"])) {
    return buildFinishOutput("Mail draft completed.");
  }

  if (selectedTools.includes("send_outlook_mail")) {
    return buildFinishOutput("Mail send completed.");
  }

  if (
    Object.keys(currentObservation).length === 0 &&
    shouldOpenWebContext(context, currentObservation) &&
    !selectedTools.includes("open_system")
  ) {
    return buildOutput("Open target system", "open_system", {
      system_id: systemId,
      target_url: typeof context.target_url === "string" ? context.target_url : undefined,
      url_contains: typeof context.url_contains === "string" ? context.url_contains : undefined,
      title_contains: typeof context.title_contains === "string" ? context.title_contains : undefined,
      session_id: typeof context.session_id === "string" ? context.session_id : undefined,
      open_if_missing: context.open_if_missing === true
    });
  }

  const missingFieldValues = collectMissingFieldValues(interactiveElements, fieldValues);
  if (missingFieldValues && Object.keys(missingFieldValues).length > 0) {
    return buildOutput("Fill target form", "fill_web_form", {
      system_id: systemId,
      session_id: currentSessionId,
      field_values: missingFieldValues
    });
  }

  if (selectedTools.includes("extract_web_result")) {
    const goalSatisfied = lastToolResult.goal_satisfied === true;
    const summary =
      typeof lastToolResult.summary === "string" && lastToolResult.summary.trim().length > 0
        ? lastToolResult.summary
        : "Web result extraction completed.";
    return buildFinishOutput(goalSatisfied ? summary : `${summary} Goal could not be fully confirmed.`);
  }

  if (lastSelectedTool === "follow_web_navigation") {
    return buildOutput("Read result from the updated page", "extract_web_result", {
      system_id: systemId,
      session_id: currentSessionId,
      goal: instruction,
        query: typeof fieldValues.query === "string" ? fieldValues.query : ""
    });
  }

  if (
    (lastSelectedTool === "click_web_element" || lastSelectedTool === "submit_web_form") &&
    observationMeaningfullyChanged(previousObservation, currentObservation)
  ) {
    return buildOutput("Read result from the updated page", "extract_web_result", {
      system_id: systemId,
      session_id: currentSessionId,
      goal: instruction,
        query: typeof fieldValues.query === "string" ? fieldValues.query : ""
    });
  }

  const clickableTarget = inferClickableTarget(interactiveElements, instruction, context);
  if (clickableTarget && lastSelectedTool !== "click_web_element") {
    return buildOutput("Click target page element", "click_web_element", {
      system_id: systemId,
      session_id: currentSessionId,
      target_key: clickableTarget
    });
  }

  if (
    lastSelectedTool !== "submit_web_form" &&
    includesAny(normalizedInstruction, ["submit", "제출", "register", "등록", "save", "저장"])
  ) {
    return buildOutput("Submit target form", "submit_web_form", {
      system_id: systemId,
      expected_button: typeof context.expected_button === "string" ? context.expected_button : "Submit"
    });
  }

  if (
    (lastSelectedTool === "click_web_element" || lastSelectedTool === "submit_web_form") &&
    currentSessionId &&
    selectedTools[selectedTools.length - 1] !== "follow_web_navigation"
  ) {
    return buildOutput("Follow the navigation caused by the click", "follow_web_navigation", {
      system_id: systemId,
      session_id: currentSessionId
    });
  }

  if (
    !selectedTools.includes("extract_web_result") &&
    (currentPageText.length > 0 || currentVisibleTextBlocks.length > 0)
  ) {
    return buildOutput("Read result from the updated page", "extract_web_result", {
      system_id: systemId,
      session_id: currentSessionId,
      goal: instruction,
      query: typeof fieldValues.query === "string" ? fieldValues.query : ""
    });
  }

  if (selectedTools.includes("open_system") && interactiveElements.length > 0 && Object.keys(fieldValues).length === 0) {
    return buildFinishOutput("System opened and observation captured.");
  }

  return null;
}

function inferSystemId(context: Record<string, unknown>): string {
  if (typeof context.system_id === "string") {
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
  return "web_generic";
}

function inferClickTarget(instruction: string, context: Record<string, unknown>): string | null {
  if (typeof context.target_key === "string" && context.target_key.trim().length > 0) {
    return context.target_key;
  }
  if (includesAny(instruction, ["send", "전송"])) {
    return "send";
  }
  if (includesAny(instruction, ["submit", "등록", "제출", "저장"])) {
    return "submit";
  }
  return null;
}

function collectMissingFieldValues(
  interactiveElements: Record<string, unknown>[],
  desiredFieldValues: Record<string, unknown>
): Record<string, unknown> | null {
  if (Object.keys(desiredFieldValues).length === 0) {
    return null;
  }

  const missing: Record<string, unknown> = {};
  for (const [key, desiredValue] of Object.entries(desiredFieldValues)) {
    const matched = interactiveElements.find((element) => {
      const elementKey = typeof element.key === "string" ? normalize(element.key) : "";
      const elementLabel = typeof element.label === "string" ? normalize(element.label) : "";
      const normalizedKey = normalize(key);
      return elementKey === normalizedKey || elementLabel === normalizedKey;
    });
    if (!matched) {
      continue;
    }

    const currentValue = typeof matched.value === "string" ? matched.value.trim() : "";
    if (String(desiredValue).trim() !== currentValue) {
      missing[key] = desiredValue;
    }
  }

  return Object.keys(missing).length > 0 ? missing : null;
}

function inferClickableTarget(
  interactiveElements: Record<string, unknown>[],
  instruction: string,
  context: Record<string, unknown>
): string | null {
  if (typeof context.target_key === "string" && context.target_key.trim().length > 0) {
    return context.target_key;
  }

  const clickableElements = interactiveElements.filter((element) => {
    const type = typeof element.type === "string" ? element.type : "";
    const action = typeof element.action === "string" ? element.action : "";
    return type === "button" || type === "link" || action === "click";
  });
  if (clickableElements.length === 0) {
    return null;
  }

  const normalizedInstruction = normalize(instruction);
  const preferredTokens = extractInstructionTokens(normalizedInstruction);
  const scored = clickableElements
    .map((element) => {
      const key = typeof element.key === "string" ? element.key : "";
      const label = typeof element.label === "string" ? element.label : "";
      const haystack = `${normalize(key)} ${normalize(label)}`.trim();
      const score = preferredTokens.reduce((total, token) => (haystack.includes(token) ? total + 1 : total), 0);
      return {
        key,
        score,
        label: normalize(label)
      };
    })
    .sort((left, right) => right.score - left.score);

  if (scored[0]?.score > 0) {
    return scored[0].key;
  }

  const sensibleDefault = scored.find((element) =>
    ["search", "submit", "send", "next", "open", "검색", "조회", "확인", "등록", "저장", "전송"].some((token) =>
      element.label.includes(token) || normalize(element.key).includes(token)
    )
  );
  return sensibleDefault?.key ?? null;
}

function extractInstructionTokens(normalizedInstruction: string): string[] {
  return Array.from(
    new Set(
      normalizedInstruction
        .split(/[\s,./:_-]+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2)
    )
  );
}

function shouldOpenWebContext(context: Record<string, unknown>, currentObservation: Record<string, unknown>): boolean {
  if (Object.keys(currentObservation).length > 0) {
    return false;
  }
  return Boolean(
    (typeof context.system_id === "string" && context.system_id.trim().length > 0) ||
      (typeof context.session_id === "string" && context.session_id.trim().length > 0) ||
      (typeof context.target_url === "string" && context.target_url.trim().length > 0) ||
      (typeof context.url_contains === "string" && context.url_contains.trim().length > 0) ||
      (typeof context.title_contains === "string" && context.title_contains.trim().length > 0) ||
      context.open_if_missing === true ||
      (typeof context.field_values === "object" && context.field_values !== null)
  );
}

function shouldFallbackToHeuristic(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes("unable to parse json") ||
    message.includes("returned no tool call") ||
    message.includes("no tool") ||
    message.includes("returned empty content") ||
    message.includes("timed out") ||
    message.includes("status 4") ||
    message.includes("status 5") ||
    message.includes("unauthorized")
  );
}

function buildHeuristicTrace(request: PlannerRequest, output: PlannerOutput): Record<string, unknown> {
  return {
    source: "heuristic",
    request_messages: request.messages,
    request_tools: request.tools,
    planner_output: output
  };
}
