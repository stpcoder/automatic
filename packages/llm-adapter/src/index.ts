import { plannerOutputSchema, type PlannerClient, type PlannerOutput, type PlannerRequest } from "../../contracts/src/index.js";

export interface LegacyChatCompletionConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  path?: string;
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
  constructor(private readonly config: LegacyChatCompletionConfig) {}

  async plan(request: PlannerRequest): Promise<PlannerOutput> {
    const response = await fetch(`${this.config.baseUrl}${this.config.path ?? "/chat/completions"}`, {
      method: "POST",
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
