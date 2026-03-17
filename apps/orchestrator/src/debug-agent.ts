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
          response_contract: buildPlannerResponseContract(),
          available_tools: tools
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
          response_contract: buildPlannerResponseContract(),
          available_tools: tools
        })
      }
    ],
    tools
  };
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

    this.lastTrace = {
      source: "llm_json_planner",
      request_messages: request.messages,
      request_tools: request.tools,
      raw_text: result.text
    };

    if (!result.text || result.text.trim().length === 0) {
      throw new Error("Debug planner returned empty content");
    }

    try {
      return plannerOutputSchema.parse(parsePlannerJsonText(result.text));
    } catch (error) {
      logPlannerRepairAttempt(error, result.text);
      const repairedText = await this.repairPlannerResponse(request, result.text, error);
      this.lastTrace = {
        ...this.lastTrace,
        repair_attempted: true,
        repaired_text: repairedText
      };
      return plannerOutputSchema.parse(parsePlannerJsonText(repairedText));
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
  const preview = truncateForPlannerLog(normalizeWhitespace(rawText), 220);
  console.log(`[planner] JSON parse failed: ${truncateForPlannerLog(message, 180)}`);
  if (preview.length > 0) {
    console.log(`[planner] RAW  ${preview}`);
  }
  console.log("[planner] RETRY JSON repair");
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
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
    "When no page is attached yet and the instruction references a URL or page to inspect, use open_system first.",
    "When the goal is satisfied, use finish_task with a short summary.",
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
    "- finish_task: only when the goal is truly satisfied and you can summarize the answer from what is visible on the current page.",
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
  } catch {
    const firstBrace = normalized.indexOf("{");
    const lastBrace = normalized.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(normalized.slice(firstBrace, lastBrace + 1));
    }
    throw new Error("Unable to parse JSON from planner response");
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

function parseJsonSafely(raw: string): unknown {
  try {
    return parsePlannerJsonText(raw);
  } catch {
    throw new Error("Unable to parse JSON from planner response");
  }
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
