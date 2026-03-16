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

export function createDebugPlanner(): PlannerClient {
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

export function createHeuristicDebugPlanner(): PlannerClient {
  return new HeuristicDebugPlanner();
}

export function createFallbackDebugPlanner(primary: PlannerClient, fallback: PlannerClient): PlannerClient {
  return new FallbackDebugPlanner(primary, fallback);
}

export function buildDebugPlannerRequest(instruction: string, context: Record<string, unknown>, tools: DebugAgentToolSpec[]): PlannerRequest {
  return {
    messages: [
      {
        role: "system",
        content:
          "Choose exactly one tool to satisfy the user's instruction. Prefer open_system, fill_web_form, preview_web_submission, submit_web_form, draft_outlook_mail, send_outlook_mail, watch_email_reply. Return one tool call only."
      },
      {
        role: "user",
        content: JSON.stringify({ instruction, context })
      }
    ],
    tools
  };
}

class HeuristicDebugPlanner implements PlannerClient {
  async plan(request: PlannerRequest): Promise<PlannerOutput> {
    const userContent = [...request.messages].reverse().find((message) => message.role === "user")?.content ?? "{}";
    const parsed = parseDebugPayload(userContent);
    const instruction = normalize(parsed.instruction);
    const context = parsed.context ?? {};
    const systemId = inferSystemId(instruction, context);

    if (includesAny(instruction, ["open", "열어", "접속"])) {
      return buildOutput("Open target system", "open_system", {
        system_id: systemId
      });
    }

    if (includesAny(instruction, ["fill", "채워", "입력"])) {
      return buildOutput("Fill target form", "fill_web_form", {
        system_id: systemId,
        field_values: asRecord(context.field_values)
      });
    }

    if (includesAny(instruction, ["preview", "미리보기", "검토"])) {
      return buildOutput("Preview target submission", "preview_web_submission", {
        system_id: systemId
      });
    }

    if (includesAny(instruction, ["submit", "제출", "등록", "저장"])) {
      return buildOutput("Submit target form", "submit_web_form", {
        system_id: systemId,
        expected_button: typeof context.expected_button === "string" ? context.expected_button : inferExpectedButton(systemId)
      });
    }

    if (includesAny(instruction, ["draft mail", "mail draft", "메일 초안", "메일 작성", "email draft"])) {
      return buildOutput("Draft mail", "draft_outlook_mail", {
        template_id: typeof context.template_id === "string" ? context.template_id : "debug_template",
        to: asStringArray(context.to),
        cc: asStringArray(context.cc),
        variables: asRecord(context.variables)
      });
    }

    if (includesAny(instruction, ["send mail", "메일 발송", "메일 보내", "email send"])) {
      return buildOutput("Send drafted mail", "send_outlook_mail", {
        draft_id: typeof context.draft_id === "string" ? context.draft_id : ""
      });
    }

    if (includesAny(instruction, ["watch reply", "reply watch", "회신 대기", "회신 감시"])) {
      return buildOutput("Register reply watch", "watch_email_reply", {
        case_id: typeof context.case_id === "string" ? context.case_id : "DEBUG-CASE",
        conversation_id: typeof context.conversation_id === "string" ? context.conversation_id : "",
        expected_from: asStringArray(context.expected_from),
        required_fields: asStringArray(context.required_fields)
      });
    }

    if (includesAny(instruction, ["search mail", "mail search", "메일 검색", "메일 조회", "mail lookup", "조회"])) {
      return buildOutput("Search Outlook mail", "search_outlook_mail", {
        keyword: typeof context.keyword === "string" ? context.keyword : parsed.instruction,
        max_results: typeof context.max_results === "number" ? context.max_results : 10
      });
    }

    if (typeof context.system_id === "string" || includesAny(instruction, ["security", "보안", "dhl", "cube", "메신저", "chat"])) {
      return buildOutput("Open target system by default", "open_system", {
        system_id: systemId
      });
    }

    throw new Error("No actionable tool inferred from instruction");
  }
}

class FallbackDebugPlanner implements PlannerClient {
  constructor(
    private readonly primary: PlannerClient,
    private readonly fallback: PlannerClient
  ) {}

  async plan(request: PlannerRequest): Promise<PlannerOutput> {
    try {
      return await this.primary.plan(request);
    } catch (error) {
      if (!shouldFallbackToHeuristic(error)) {
        throw error;
      }
      return this.fallback.plan(request);
    }
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

function inferSystemId(instruction: string, context: Record<string, unknown>): string {
  if (typeof context.system_id === "string") {
    return context.system_id;
  }
  if (includesAny(instruction, ["security", "보안"])) {
    return "security_portal";
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

function shouldFallbackToHeuristic(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes("unable to parse json") ||
    message.includes("returned no tool call") ||
    message.includes("returned empty content") ||
    message.includes("timed out") ||
    message.includes("status 4") ||
    message.includes("status 5") ||
    message.includes("unauthorized")
  );
}
