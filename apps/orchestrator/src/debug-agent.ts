import { generateText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

import {
  plannerOutputSchema,
  type PlannerClient,
  type PlannerOutput,
  type PlannerRequest
} from "../../../packages/contracts/src/index.js";
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

  if (config.baseUrl && config.apiKey && config.model) {
    const timeoutMs = Number(process.env.LLM_TIMEOUT_MS ?? "90000");
    const repairTimeoutMs = Number(process.env.LLM_JSON_REPAIR_TIMEOUT_MS ?? "45000");
    return new JsonDebugPlanner({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
      timeoutMs,
      repairTimeoutMs
    });
  }

  return new UnavailableDebugPlanner(config.error);
}

export function buildDebugPlannerRequest(
  instruction: string,
  context: Record<string, unknown>,
  tools: DebugAgentToolSpec[]
): PlannerRequest {
  return {
    messages: [
      {
        role: "system",
        content: buildSingleTurnSystemPrompt()
      },
      {
        role: "user",
        content: JSON.stringify({
          instruction,
          context,
          available_tools: buildPlannerToolIndex(tools)
        })
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
        content: buildLoopSystemPrompt()
      },
      {
        role: "user",
        content: JSON.stringify({
          instruction,
          context,
          available_tools: buildPlannerToolIndex(tools)
        })
      }
    ],
    tools
  };
}

function buildPlannerToolIndex(tools: DebugAgentToolSpec[]): Array<Record<string, unknown>> {
  return tools.map((tool) => ({
    name: tool.name,
    input_keys: Object.keys(tool.input_schema ?? {})
  }));
}

class JsonDebugPlanner implements DebugPlannerClient {
  private lastTrace: Record<string, unknown> | undefined;

  constructor(
    private readonly config: {
      baseUrl: string;
      apiKey: string;
      model: string;
      timeoutMs: number;
      repairTimeoutMs: number;
    }
  ) {}

  async plan(request: PlannerRequest): Promise<PlannerOutput> {
    const provider = createOpenAICompatible({
      name: "skhynix-debug-planner",
      baseURL: this.config.baseUrl,
      apiKey: this.config.apiKey
    });

    const system = request.messages.find((message) => message.role === "system")?.content;
    const prompt = [...request.messages]
      .filter((message) => message.role !== "system")
      .map((message) => `${message.role.toUpperCase()}:\n${message.content}`)
      .join("\n\n");

    const result = await this.generatePlannerText(provider, request.model ?? this.config.model, system, prompt);
    const usage = extractPlannerUsage(result);
    const requestChars = (system?.length ?? 0) + prompt.length;
    const responseChars = typeof result.text === "string" ? result.text.length : 0;

    this.lastTrace = {
      source: "llm_json_planner",
      request_messages: request.messages,
      request_tools: request.tools,
      raw_text: result.text,
      request_metrics: {
        request_chars: requestChars
      },
      response_metrics: {
        response_chars: responseChars,
        usage
      }
    };

    if (!result.text || result.text.trim().length === 0) {
      throw new Error("Debug planner returned empty content");
    }

    try {
      return plannerOutputSchema.parse(normalizePlannerOutputForSchema(parsePlannerJsonText(result.text)));
    } catch (error) {
      logPlannerRepairAttempt(error, result.text);
      let repairedText: string;
      try {
        repairedText = await this.repairPlannerResponse(request, result.text, error);
      } catch (repairError) {
        logPlannerRepairFailure(repairError);
        throw repairError;
      }
      this.lastTrace = {
        ...this.lastTrace,
        repair_attempted: true,
        repaired_text: repairedText
      };
      try {
        return plannerOutputSchema.parse(normalizePlannerOutputForSchema(parsePlannerJsonText(repairedText)));
      } catch (repairParseError) {
        logPlannerRepairOutputFailure(repairParseError, repairedText);
        throw repairParseError;
      }
    }
  }

  private async generatePlannerText(
    provider: ReturnType<typeof createOpenAICompatible>,
    modelName: string,
    system: string | undefined,
    prompt: string
  ) {
    const attempts: Array<{ attempt: number; raw_text: string }> = [];

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const attemptPrompt =
        attempt === 1
          ? prompt
          : `${prompt}\n\nIMPORTANT: Your previous response was empty. Return exactly one valid JSON object and nothing else.`;
      const result = await withTimeout(
        generateText({
          model: provider.chatModel(modelName),
          system,
          prompt: attemptPrompt
        }),
        this.config.timeoutMs,
        `Debug planner timed out after ${this.config.timeoutMs}ms`
      );
      attempts.push({ attempt, raw_text: result.text ?? "" });
      if (result.text && result.text.trim().length > 0) {
        this.lastTrace = {
          ...this.lastTrace,
          attempts
        };
        return result;
      }
    }

    this.lastTrace = {
      ...this.lastTrace,
      attempts
    };
    return { text: "" };
  }

  getTrace(): Record<string, unknown> | undefined {
    return this.lastTrace;
  }

  private async repairPlannerResponse(
    request: PlannerRequest,
    rawText: string,
    cause: unknown
  ): Promise<string> {
    const provider = createOpenAICompatible({
      name: "skhynix-debug-planner",
      baseURL: this.config.baseUrl,
      apiKey: this.config.apiKey
    });
    const repairTimeoutMs = Math.max(1000, Math.min(this.config.timeoutMs, this.config.repairTimeoutMs));
    const repairPrompt = [
      "Rewrite the malformed planner response into one valid JSON object.",
      "Return JSON only. No prose. No markdown fences.",
      "The JSON must follow this contract:",
      JSON.stringify(buildPlannerResponseContract()),
      "Original malformed response:",
      rawText,
      "Parser error:",
      cause instanceof Error ? cause.message : String(cause)
    ].join("\n\n");

    const repairResult = await withTimeout(
      generateText({
        model: provider.chatModel(request.model ?? this.config.model),
        system:
          "You repair malformed planner JSON. Output exactly one valid JSON object that matches the requested contract.",
        prompt: repairPrompt
      }),
      repairTimeoutMs,
      `Debug planner JSON repair timed out after ${repairTimeoutMs}ms`
    );

    if (!repairResult.text || repairResult.text.trim().length === 0) {
      throw new Error("Debug planner JSON repair returned empty content");
    }

    return repairResult.text;
  }
}

function logPlannerRepairAttempt(error: unknown, rawText: string): void {
  const message = error instanceof Error ? error.message : String(error);
  console.log(`[planner] JSON parse failed: ${message}`);
  console.log("[planner] RAW BEGIN");
  console.log(rawText);
  console.log("[planner] RAW END");
  console.log("[planner] RETRY JSON repair");
}

function logPlannerRepairFailure(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.log(`[planner] JSON repair failed: ${message}`);
}

function logPlannerRepairOutputFailure(error: unknown, repairedText: string): void {
  const message = error instanceof Error ? error.message : String(error);
  console.log(`[planner] JSON repair output parse failed: ${message}`);
  console.log("[planner] REPAIRED RAW BEGIN");
  console.log(repairedText);
  console.log("[planner] REPAIRED RAW END");
}

function truncateForPlannerLog(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

class UnavailableDebugPlanner implements DebugPlannerClient {
  private lastTrace: Record<string, unknown> | undefined;

  constructor(private readonly configError?: string) {}

  async plan(request: PlannerRequest): Promise<PlannerOutput> {
    this.lastTrace = {
      source: "unavailable_debug_planner",
      reason: this.configError ?? "missing_llm_configuration",
      request_messages: request.messages,
      request_tools: request.tools
    };
    throw new Error("LLM planner unavailable. Configure opencode.ai/config.json with a valid model, baseURL, and apiKey.");
  }

  getTrace(): Record<string, unknown> | undefined {
    return this.lastTrace;
  }
}

function buildSingleTurnSystemPrompt(): string {
  return [
    "You are a planning agent. Read the user's instruction and context, then return exactly one JSON object.",
    "Do not emit prose outside JSON. Do not rely on fixed site-specific workflows or hidden heuristics.",
    "Your job is to evaluate the previous state, update memory, choose the next goal, form a short global plan when needed, pick the immediate step plan, and choose exactly one next action tool.",
    "The next_action must move the task forward in one atomic step.",
    "Use the provided available_tools only.",
    "Mail tool semantics:",
    "- search_outlook_contacts: search Outlook contacts and organizational directory when the instruction names a person, team, or distribution group but does not provide a concrete email address yet.",
    "- search_outlook_mail: search mailboxes and return message list candidates with real entry_id and conversation_id values.",
    "- read_outlook_mail: read one concrete mail after search, by entry_id or conversation_id. Always copy the exact entry_id or conversation_id returned by search_outlook_mail. Never invent placeholders like search_result_first.",
    "- read_outlook_conversation: read the mail thread when context from multiple messages matters.",
    "- draft_outlook_mail: create a brand new mail draft. When you already know the recipients, subject, or body, provide them directly. Use update_outlook_draft only when you need to revise the draft after learning more.",
    "- reply_outlook_mail: create a reply draft in the existing thread.",
    "- update_outlook_draft: revise draft recipients, subject, or body. to and cc may contain one or more individual addresses or group/distribution addresses.",
    "- preview_outlook_draft: inspect the current draft before asking for approval or sending.",
    "- send_outlook_mail: send only when the user explicitly approved sending or context.approved_to_send is true.",
    "- watch_email_reply: register a reply watcher after sending when the task requires waiting for a reply across a persisted case workflow. Use conversation_id when known, expected_from for sender filtering, and keyword_contains for subject/body keyword filtering.",
    "- await_email_reply: block and wait until a matching reply arrives, then return the matched reply content to continue the current agent loop. Use this for prompt-driven tasks that must wait in-line for a reply.",
    "When no page is attached yet and the instruction references a URL or page to inspect, use open_system first.",
    "When the goal is satisfied, use finish_task with a short summary.",
    "expected_transition must be one of: READY, RUNNING, DRAFT_READY, APPROVAL_REQUIRED, WAITING_EMAIL, WAITING_CHAT, WAITING_HUMAN, WAITING_SYSTEM, COMPLETED, FAILED, ESCALATED.",
    "The JSON must follow this shape:",
    JSON.stringify(buildPlannerResponseContract())
  ].join(" ");
}

function buildLoopSystemPrompt(): string {
  return [
    "You are a multi-turn browser and mail planning agent.",
    "At every turn, you receive the original instruction, the current observation, the last tool result, the global plan so far, the current step plan, the plan history, and any last failure.",
    "Return exactly one JSON object and no surrounding prose.",
    "Your response must explicitly contain: evaluation_previous_goal, memory, next_goal, global_plan, step_plan, and next_action.",
    "evaluation_previous_goal should say whether the previous step succeeded, failed, or was insufficient.",
    "memory should contain short durable facts learned so far that matter for later steps.",
    "next_goal should state the immediate next milestone before the chosen action.",
    "You must explicitly maintain two planning levels:",
    "1. global_plan: the end-to-end task plan and success criteria.",
    "2. step_plan: the immediate sub-goal for the current turn.",
    "If the current plan is no longer valid because the page changed, the action failed, or the result is insufficient, update the plan and replan.",
    "Do not use fixed site-specific sequences. Base decisions on the current observation, semantic blocks, visible text, domOutline, interactive elements, and last failure.",
    "Use only one tool per turn. The executor will run that tool and return to you.",
    "Before acting, reason through these checkpoints when relevant: confirm whether a browser session already exists, confirm whether the currently attached page already matches the needed site or tab, confirm whether the page identity is correct by checking title/url/semantic blocks/visible text, confirm whether the target input or clickable element is visible, confirm whether the most important visible content is already enough to answer the goal, and confirm whether the result already satisfies the goal before taking another action.",
    "When choosing where to click or type, inspect domOutline first because it preserves DOM reading order and nearby text. Then use interactive elements, semantic blocks, and visible text to confirm the target. Ignore utility controls unless the instruction explicitly asks for them.",
    "Tool semantics:",
    "- open_system: attach to an existing session or open a target URL. Use it for session attach, site access, tab attach, or URL navigation.",
    "- read_web_page: read the current visible DOM, semantic blocks, visible text, and interactive elements without deciding final success yet. Use this on intermediate pages like result lists or when you need to inspect before choosing a click target.",
    "- fill_web_form: enter text or set field values directly when the observation already exposes a semantic field key or clear input target.",
    "- click_web_element: click links, buttons, tabs, result cards, menu entries, and ordinary clickable elements. Prefer target_handle from domOutline when a numbered handle is visible there.",
    "- scroll_web_page: reveal hidden content when the needed target is not visible yet.",
    "- navigate_browser_history: move back or forward in the current browser tab history when you reached the wrong page and need to return to the previous results or page state.",
    "- search_outlook_contacts: search Outlook contacts and organizational directory when you need to resolve a recipient by person name, team name, or group name before drafting or updating a mail.",
    "- search_outlook_mail: search Outlook mailboxes and return candidate messages to inspect further, including real entry_id and conversation_id values.",
    "- read_outlook_mail: read one specific mail in detail after search. Always copy the exact entry_id or conversation_id returned by search_outlook_mail. Never invent placeholders like search_result_first.",
    "- read_outlook_conversation: read a whole mail thread when you need context across replies.",
    "- draft_outlook_mail: create a new mail draft. When you already know the recipients, subject, or body, provide them directly. Use update_outlook_draft only when you need to revise the draft later. to and cc may contain one or more individual addresses or group/distribution addresses.",
    "- reply_outlook_mail: create a reply draft tied to an existing message or conversation.",
    "- update_outlook_draft: revise a draft after you learn new information or get user feedback. to and cc may contain one or more individual addresses or group/distribution addresses.",
    "- preview_outlook_draft: inspect the exact draft content before asking for approval or sending.",
    "- send_outlook_mail: send only when the user explicitly asked to send now or context.approved_to_send is true.",
    "- watch_email_reply: register a watcher after sending when you must resume later when a reply arrives in a persisted case workflow. Use conversation_id when known, expected_from for sender filtering, and keyword_contains for subject/body keyword filtering.",
    "- await_email_reply: block and wait until a matching reply arrives, then return the reply as the current step result. Use this when the current prompt-driven agent should stop progressing until the reply is received.",
    "- finish_task: only when the goal is truly satisfied and you can summarize the result from the visible page, the read mail content, or the current draft state.",
    "For mail tasks, resolve unknown recipients first with search_outlook_contacts when needed. Then prefer search_outlook_mail -> read_outlook_mail/read_outlook_conversation -> draft/reply -> preview_outlook_draft -> finish_task for approval, and only then send_outlook_mail after explicit approval. After sending, use await_email_reply when the current agent should wait in-line for a reply, or watch_email_reply when a persisted workflow should resume later via external event.",
    "expected_transition must be one of: READY, RUNNING, DRAFT_READY, APPROVAL_REQUIRED, WAITING_EMAIL, WAITING_CHAT, WAITING_HUMAN, WAITING_SYSTEM, COMPLETED, FAILED, ESCALATED.",
    "Your step_plan should be rich enough to show intended attach/open, page verification, interaction, and result verification steps, even though you may execute only one tool now.",
    "The JSON must follow this shape:",
    JSON.stringify(buildPlannerResponseContract())
  ].join(" ");
}

function buildPlannerResponseContract(): Record<string, unknown> {
  return {
    objective: "Immediate goal for this turn",
    rationale: "Why this next action is correct right now",
    evaluation_previous_goal: "Short evaluation of the previous action or current state",
    memory: ["Short durable facts learned so far"],
    next_goal: "Immediate milestone to reach after this planning step",
    global_plan: {
      goal: "Overall task goal",
      success_criteria: ["What proves the task is complete"],
      assumptions: ["Optional assumptions"],
      steps: [
        {
          step_id: "short_step_id",
          title: "Short step title",
          description: "What this step is meant to achieve",
          completion_signals: ["How to know the step is complete"]
        }
      ],
      current_step_id: "short_step_id",
      progress_summary: "Current progress in one short sentence"
    },
    step_plan: {
      step_id: "short_step_id",
      current_goal: "Immediate sub-goal for this turn",
      action_plan: ["2-4 short bullets describing the next local plan"],
      completion_signals: ["What the tool result should show next"],
      replan_if: ["What should trigger replanning"]
    },
    next_action: {
      tool: "one_available_tool_name",
      input: {}
    },
    requires_approval: false,
    expected_transition: "RUNNING"
  };
}

export function parsePlannerJsonText(raw: string): unknown {
  const normalized = normalizePlannerResponseText(raw);

  try {
    return JSON.parse(normalized);
  } catch (primaryError) {
    const firstBrace = normalized.indexOf("{");
    const lastBrace = normalized.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const sliced = normalized.slice(firstBrace, lastBrace + 1);
      try {
        return JSON.parse(sliced);
      } catch (slicedError) {
        throw new Error(buildPlannerJsonParseError(normalized, primaryError, sliced, slicedError));
      }
    }
    throw new Error(buildPlannerJsonParseError(normalized, primaryError));
  }
}

function normalizePlannerResponseText(raw: string): string {
  const trimmed = raw.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const unfenced = fencedMatch ? fencedMatch[1] : trimmed;
  return unfenced
    .replace(/[\u201c\u201d]/g, "\"")
    .replace(/[\u2018\u2019]/g, "'")
    .trim();
}

export function normalizePlannerOutputForSchema(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }

  const output = { ...(value as Record<string, unknown>) };
  const expectedTransition = normalizeExpectedTransition(output.expected_transition);
  if (expectedTransition) {
    output.expected_transition = expectedTransition;
  }
  return output;
}

function normalizeExpectedTransition(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toUpperCase().replace(/[\s-]+/g, "_");
  const aliasMap: Record<string, string> = {
    SUCCEED: "COMPLETED",
    SUCCEEDED: "COMPLETED",
    SUCCESS: "COMPLETED",
    DONE: "COMPLETED",
    FINISHED: "COMPLETED",
    COMPLETE: "COMPLETED",
    ERROR: "FAILED"
  };

  return aliasMap[normalized] ?? normalized;
}

function extractPlannerUsage(result: unknown): Record<string, number | undefined> | undefined {
  if (!result || typeof result !== "object" || !("usage" in result)) {
    return undefined;
  }

  const usage = (result as { usage?: unknown }).usage;
  if (!usage || typeof usage !== "object") {
    return undefined;
  }

  const usageRecord = usage as Record<string, unknown>;
  const inputTokens =
    typeof usageRecord.inputTokens === "number"
      ? usageRecord.inputTokens
      : typeof usageRecord.promptTokens === "number"
        ? usageRecord.promptTokens
        : undefined;
  const outputTokens =
    typeof usageRecord.outputTokens === "number"
      ? usageRecord.outputTokens
      : typeof usageRecord.completionTokens === "number"
        ? usageRecord.completionTokens
        : undefined;
  const reasoningTokens =
    typeof usageRecord.reasoningTokens === "number"
      ? usageRecord.reasoningTokens
      : typeof usageRecord.outputTokenDetails === "object" && usageRecord.outputTokenDetails !== null
        ? typeof (usageRecord.outputTokenDetails as Record<string, unknown>).reasoningTokens === "number"
          ? ((usageRecord.outputTokenDetails as Record<string, unknown>).reasoningTokens as number)
          : undefined
        : undefined;

  if (inputTokens === undefined && outputTokens === undefined && reasoningTokens === undefined) {
    return undefined;
  }

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    reasoning_tokens: reasoningTokens
  };
}

function parseJsonSafely(raw: string): unknown {
  try {
    return parsePlannerJsonText(raw);
  } catch {
    throw new Error("Unable to parse JSON from planner response");
  }
}

function buildPlannerJsonParseError(
  rawText: string,
  primaryError: unknown,
  slicedText?: string,
  slicedError?: unknown
): string {
  const parts = [
    `Unable to parse JSON from planner response.`,
    describeJsonParseFailure("raw", primaryError, rawText)
  ];

  if (slicedText && slicedError) {
    parts.push(describeJsonParseFailure("brace-sliced", slicedError, slicedText));
  }

  return parts.join(" ");
}

function describeJsonParseFailure(label: string, error: unknown, text: string): string {
  const baseMessage = error instanceof Error ? error.message : String(error);
  const positionMatch = baseMessage.match(/position\s+(\d+)/i);
  const position = positionMatch ? Number(positionMatch[1]) : undefined;

  if (position === undefined || Number.isNaN(position)) {
    return `[${label}] ${baseMessage}`;
  }

  const { line, column } = getLineAndColumn(text, position);
  const snippet = buildErrorSnippet(text, position);
  return `[${label}] ${baseMessage} at line ${line}, column ${column}. Around error: ${snippet}`;
}

function getLineAndColumn(text: string, position: number): { line: number; column: number } {
  let line = 1;
  let column = 1;

  for (let index = 0; index < Math.min(position, text.length); index += 1) {
    if (text[index] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }

  return { line, column };
}

function buildErrorSnippet(text: string, position: number): string {
  const start = Math.max(0, position - 80);
  const end = Math.min(text.length, position + 80);
  const snippet = text.slice(start, end).replace(/\n/g, "\\n");
  const caretOffset = Math.max(0, Math.min(position - start, snippet.length));
  return `${snippet} <<<HERE>>> ${" ".repeat(caretOffset)}`;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
      })
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}
