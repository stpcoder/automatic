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
          "Choose exactly one tool to satisfy the user's instruction. Prefer open_system, fill_web_form, click_web_element, follow_web_navigation, preview_web_submission, submit_web_form, extract_web_result, draft_outlook_mail, send_outlook_mail, watch_email_reply. Return one tool call only."
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
          "You are an agent loop. Choose exactly one next action. Use open_system to access the target page, then use fill_web_form, click_web_element, follow_web_navigation, preview_web_submission, submit_web_form, extract_web_result, draft_outlook_mail, send_outlook_mail, watch_email_reply, or search_outlook_mail as needed. After a meaningful page transition or new tab opening, call follow_web_navigation before extracting results. Prefer click_web_element for ordinary page interactions like search buttons, tabs, and links. Reserve submit_web_form for actual final commits. When the goal is completed, call finish_task with a short summary. Prefer deterministic progress based on current_observation, last_tool_result, and step_history."
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
    const systemId = inferSystemId(instruction, context);
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

    if (includesAny(instruction, ["open", "열어", "접속"])) {
      const output = buildOutput("Open target system", "open_system", {
        system_id: systemId
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
      const output = buildOutput("Click target page element", "click_web_element", {
        system_id: systemId,
        target_key: inferClickTarget(systemId, instruction, context)
      });
      this.lastTrace = buildHeuristicTrace(request, output);
      return output;
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
        expected_button: typeof context.expected_button === "string" ? context.expected_button : inferExpectedButton(systemId)
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

    if (typeof context.system_id === "string" || includesAny(instruction, ["security", "보안", "dhl", "cube", "메신저", "chat"])) {
      const output = buildOutput("Open target system by default", "open_system", {
        system_id: systemId
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

  if (selectedTools.includes("search_outlook_mail")) {
    return buildFinishOutput(`Mail search completed for keyword ${String(context.keyword ?? "").trim() || "query"}.`);
  }

  if (selectedTools.includes("draft_outlook_mail") && !includesAny(normalizedInstruction, ["send", "발송", "보내"])) {
    return buildFinishOutput("Mail draft completed.");
  }

  if (selectedTools.includes("send_outlook_mail")) {
    return buildFinishOutput("Mail send completed.");
  }

  if ((typeof context.system_id === "string" || systemId === "naver_search") && !selectedTools.includes("open_system")) {
    return buildOutput("Open target system", "open_system", {
      system_id: systemId
    });
  }

  if (systemId === "naver_stock" && selectedTools.includes("open_system") && !selectedTools.includes("extract_web_result")) {
    return buildOutput("Read stock result from current page", "extract_web_result", {
      system_id: systemId,
      goal: instruction,
      query: ""
    });
  }

  if (interactiveElements.length > 0 && Object.keys(fieldValues).length > 0 && !selectedTools.includes("fill_web_form")) {
    return buildOutput("Fill target form", "fill_web_form", {
      system_id: systemId,
      field_values: fieldValues
    });
  }

  if (
    selectedTools.includes("fill_web_form") &&
    !selectedTools.includes("click_web_element") &&
    systemId === "naver_search"
  ) {
    return buildOutput("Click search button", "click_web_element", {
      system_id: systemId,
      target_key: inferClickTarget(systemId, instruction, context)
    });
  }

  if (
    selectedTools.includes("fill_web_form") &&
    !selectedTools.includes("submit_web_form") &&
    !selectedTools.includes("click_web_element") &&
    includesAny(normalizedInstruction, ["submit", "제출", "register", "등록", "save", "저장"])
  ) {
    return buildOutput("Submit target form", "submit_web_form", {
      system_id: systemId,
      expected_button: typeof context.expected_button === "string" ? context.expected_button : inferExpectedButton(systemId)
    });
  }

  if (selectedTools.includes("click_web_element") && !selectedTools.includes("follow_web_navigation")) {
    return buildOutput("Follow the navigation caused by the click", "follow_web_navigation", {
      system_id: systemId,
      session_id:
        typeof currentObservation.sessionId === "string"
          ? currentObservation.sessionId
          : typeof lastToolResult.session_id === "string"
            ? lastToolResult.session_id
            : typeof context.session_id === "string"
              ? context.session_id
              : undefined
    });
  }

  if ((selectedTools.includes("submit_web_form") || selectedTools.includes("follow_web_navigation")) && !selectedTools.includes("extract_web_result")) {
    return buildOutput("Read result from the updated page", "extract_web_result", {
      system_id: systemId,
      session_id:
        typeof currentObservation.sessionId === "string"
          ? currentObservation.sessionId
          : typeof lastToolResult.session_id === "string"
            ? lastToolResult.session_id
            : typeof context.session_id === "string"
              ? context.session_id
              : undefined,
      goal: instruction,
      query: typeof fieldValues.query === "string" ? fieldValues.query : ""
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

  if (selectedTools.includes("open_system") && interactiveElements.length > 0 && Object.keys(fieldValues).length === 0) {
    return buildFinishOutput("System opened and observation captured.");
  }

  return null;
}

function inferSystemId(instruction: string, context: Record<string, unknown>): string {
  if (typeof context.system_id === "string") {
    return context.system_id;
  }
  if (includesAny(instruction, ["security", "보안"])) {
    return "security_portal";
  }
  if (includesAny(instruction, ["naver", "네이버", "stock", "주가"])) {
    if (includesAny(instruction, ["current page", "현재 페이지", "finance", "시세"])) {
      return "naver_stock";
    }
    return typeof context.system_id === "string" ? context.system_id : "naver_search";
  }
  if (includesAny(instruction, ["dhl"])) {
    return "dhl";
  }
  if (includesAny(instruction, ["cube", "메신저", "chat"])) {
    return "cube";
  }
  return "security_portal";
}

function inferExpectedButton(systemId: string): string {
  if (systemId === "security_portal") {
    return "등록";
  }
  if (systemId === "cube") {
    return "Send";
  }
  return "Submit";
}

function inferClickTarget(systemId: string, instruction: string, context: Record<string, unknown>): string {
  if (typeof context.target_key === "string" && context.target_key.trim().length > 0) {
    return context.target_key;
  }
  if (systemId === "naver_search") {
    return "search";
  }
  if (includesAny(instruction, ["send", "전송"])) {
    return "send";
  }
  if (includesAny(instruction, ["search", "검색"])) {
    return "search";
  }
  return "submit";
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
