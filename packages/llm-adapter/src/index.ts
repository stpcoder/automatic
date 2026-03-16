import { generateText, tool } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";

import { plannerOutputSchema, type PlannerClient, type PlannerOutput, type PlannerRequest } from "../../contracts/src/index.js";

export interface LegacyChatCompletionConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  path?: string;
  timeoutMs?: number;
}

export interface PlannerDebugTrace {
  client: "legacy_openai_compatible" | "ai_sdk_openai_compatible";
  model: string;
  request_messages?: unknown;
  request_tools?: unknown;
  raw_response?: unknown;
  raw_text?: string;
  tool_calls?: unknown;
}

interface LegacyChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
  }>;
}

export class LegacyOpenAICompatiblePlannerClient implements PlannerClient {
  private lastTrace: PlannerDebugTrace | undefined;

  constructor(private readonly config: LegacyChatCompletionConfig) {}

  async plan(request: PlannerRequest): Promise<PlannerOutput> {
    const signal = AbortSignal.timeout(this.config.timeoutMs ?? 20_000);
    const response = await fetch(`${this.config.baseUrl}${this.config.path ?? "/chat/completions"}`, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`
      },
      body: JSON.stringify({
        model: request.model ?? this.config.model,
        messages: request.messages,
        tools: request.tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: {
              type: "object",
              properties: tool.input_schema
            }
          }
        })),
        tool_choice: "auto"
      })
    });

    if (!response.ok) {
      throw new Error(`Legacy planner request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as LegacyChatCompletionResponse;
    this.lastTrace = {
      client: "legacy_openai_compatible",
      model: request.model ?? this.config.model,
      request_messages: request.messages,
      request_tools: request.tools,
      raw_response: payload
    };
    const choice = payload.choices?.[0]?.message;
    if (!choice) {
      throw new Error("Legacy planner returned no choices");
    }

    const toolCall = choice.tool_calls?.[0];
    if (toolCall?.function?.name) {
      return plannerOutputSchema.parse({
        objective: "LLM generated tool action",
        rationale: "Parsed from legacy tool_call response",
        next_action: {
          tool: toolCall.function.name,
          input: parseJsonSafely(toolCall.function.arguments ?? "{}")
        },
        requires_approval: false,
        expected_transition: "RUNNING"
      });
    }

    const content = choice.content;
    if (!content) {
      throw new Error("Legacy planner returned empty content");
    }

    return plannerOutputSchema.parse(parseJsonSafely(content));
  }

  getLastTrace(): PlannerDebugTrace | undefined {
    return this.lastTrace;
  }

  getTrace(): PlannerDebugTrace | undefined {
    return this.lastTrace;
  }
}

export class AISDKOpenAICompatiblePlannerClient implements PlannerClient {
  private lastTrace: PlannerDebugTrace | undefined;

  constructor(private readonly config: LegacyChatCompletionConfig) {}

  async plan(request: PlannerRequest): Promise<PlannerOutput> {
    const provider = createOpenAICompatible({
      name: "skhynix-llm",
      baseURL: this.config.baseUrl,
      apiKey: this.config.apiKey
    });
    const system = request.messages.find((message) => message.role === "system")?.content;
    const prompt = [...request.messages].reverse().find((message) => message.role === "user")?.content ?? "";

    const result = await withTimeout(
      generateText({
        model: provider.chatModel(request.model ?? this.config.model),
        system,
        prompt,
        toolChoice: "auto",
        tools: Object.fromEntries(
          request.tools.map((toolDefinition) => [
            toolDefinition.name,
            tool({
              description: toolDefinition.description,
              inputSchema: z.object({}).passthrough()
            })
          ])
        )
      }),
      this.config.timeoutMs ?? 20_000,
      `AI SDK planner timed out after ${this.config.timeoutMs ?? 20_000}ms`
    );
    this.lastTrace = {
      client: "ai_sdk_openai_compatible",
      model: request.model ?? this.config.model,
      request_messages: request.messages,
      request_tools: request.tools,
      raw_text: result.text,
      tool_calls: result.toolCalls
    };

    const toolCall = result.toolCalls[0];
    if (toolCall?.toolName) {
      return plannerOutputSchema.parse({
        objective: "LLM generated tool action",
        rationale: "Parsed from AI SDK tool call response",
        next_action: {
          tool: toolCall.toolName,
          input: typeof toolCall.input === "object" && toolCall.input !== null ? toolCall.input : {}
        },
        requires_approval: false,
        expected_transition: "RUNNING"
      });
    }

    if (!result.text) {
      throw new Error("AI SDK planner returned no tool call and no text");
    }

    return plannerOutputSchema.parse(parseJsonSafely(result.text));
  }

  getLastTrace(): PlannerDebugTrace | undefined {
    return this.lastTrace;
  }

  getTrace(): PlannerDebugTrace | undefined {
    return this.lastTrace;
  }
}

export class StubPlannerClient implements PlannerClient {
  constructor(private readonly output: PlannerOutput) {}

  async plan(): Promise<PlannerOutput> {
    return this.output;
  }
}

function parseJsonSafely(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    const firstBrace = raw.indexOf("{");
    const lastBrace = raw.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(raw.slice(firstBrace, lastBrace + 1));
    }
    throw new Error("Unable to parse JSON from legacy LLM response");
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
