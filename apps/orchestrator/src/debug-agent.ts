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
    return new JsonDebugPlanner({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
      timeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? "60000")
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

    const result = await withTimeout(
      generateText({
        model: provider.chatModel(request.model ?? this.config.model),
        system,
        prompt
      }),
      this.config.timeoutMs,
      `Debug planner timed out after ${this.config.timeoutMs}ms`
    );

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
      const repairedText = await this.repairPlannerResponse(request, result.text, error);
      this.lastTrace = {
        ...this.lastTrace,
        repair_attempted: true,
        repaired_text: repairedText
      };
      return plannerOutputSchema.parse(parsePlannerJsonText(repairedText));
    }
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
    const repairTimeoutMs = Math.min(this.config.timeoutMs, 20000);
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
    "Your job is to form a short global plan when needed, pick the immediate step plan, and choose exactly one next action tool.",
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
    "You must explicitly maintain two planning levels:",
    "1. global_plan: the end-to-end task plan and success criteria.",
    "2. step_plan: the immediate sub-goal for the current turn.",
    "If the current plan is no longer valid because the page changed, the action failed, or the result is insufficient, update the plan and replan.",
    "Do not use fixed site-specific sequences. Base decisions on the current observation, semantic blocks, visible text, interactive elements, and last failure.",
    "Use only one tool per turn. The executor will run that tool and return to you.",
    "Before acting, reason through these checkpoints when relevant: confirm whether a browser session already exists, confirm whether the currently attached page already matches the needed site or tab, confirm whether the page identity is correct by checking title/url/semantic blocks/visible text, confirm whether the target input or clickable element is visible, confirm whether the most important visible content is already enough to answer the goal, and confirm whether the result already satisfies the goal before taking another action.",
    "When choosing where to click or type, prefer high-importance interactive elements that are grounded by nearby visible text and semantic blocks. Ignore utility controls unless the instruction explicitly asks for them.",
    "Tool semantics:",
    "- open_system: attach to an existing session or open a target URL. Use it for session attach, site access, tab attach, or URL navigation.",
    "- fill_web_form: enter text or set field values directly when the observation already exposes a semantic field key or clear input target.",
    "- click_web_element: click links, buttons, tabs, result cards, menu entries, and ordinary clickable elements.",
    "- scroll_web_page: reveal hidden content when the needed target is not visible yet.",
    "- follow_web_navigation: follow same-tab or child-tab navigation after a page-changing action.",
    "- extract_web_result: read the current page and judge whether the goal is satisfied.",
    "- finish_task: only when the goal is truly satisfied and you can summarize the answer.",
    "Your step_plan should be rich enough to show intended attach/open, page verification, interaction, and result verification steps, even though you may execute only one tool now.",
    "The JSON must follow this shape:",
    JSON.stringify(buildPlannerResponseContract())
  ].join(" ");
}

function buildPlannerResponseContract(): Record<string, unknown> {
  return {
    objective: "Immediate goal for this turn",
    rationale: "Why this next action is correct right now",
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
