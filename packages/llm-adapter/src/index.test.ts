import test from "node:test";
import assert from "node:assert/strict";

import { AISDKOpenAICompatiblePlannerClient, LegacyOpenAICompatiblePlannerClient } from "./index.js";

test("legacy llm adapter parses tool call responses", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  function: {
                    name: "draft_outlook_mail",
                    arguments: JSON.stringify({
                      template_id: "request_customs_number"
                    })
                  }
                }
              ]
            }
          }
        ]
      }),
      { status: 200 }
    );

  try {
    const client = new LegacyOpenAICompatiblePlannerClient({
      baseUrl: "http://internal-llm.local/v1",
      apiKey: "test",
      model: "qwen"
    });

    const result = await client.plan({
      messages: [{ role: "user", content: "Plan the next step" }],
      tools: [
        {
          name: "draft_outlook_mail",
          description: "Draft mail",
          input_schema: {}
        }
      ]
    });

    assert.equal(result.next_action.tool, "draft_outlook_mail");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ai sdk llm adapter parses tool call responses", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        id: "chatcmpl-test",
        object: "chat.completion",
        created: 0,
        model: "zai-org/GLM-4.7",
        choices: [
          {
            index: 0,
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
              content: "",
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "draft_outlook_mail",
                    arguments: JSON.stringify({
                      template_id: "request_customs_number"
                    })
                  }
                }
              ]
            }
          }
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15
        }
      }),
      { status: 200 }
    );

  try {
    const client = new AISDKOpenAICompatiblePlannerClient({
      baseUrl: "https://common.llm.skhynix.com/v1",
      apiKey: "test",
      model: "zai-org/GLM-4.7"
    });

    const result = await client.plan({
      messages: [{ role: "user", content: "Plan the next step" }],
      tools: [
        {
          name: "draft_outlook_mail",
          description: "Draft mail",
          input_schema: {}
        }
      ]
    });

    assert.equal(result.next_action.tool, "draft_outlook_mail");
    assert.equal(result.next_action.input.template_id, "request_customs_number");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
