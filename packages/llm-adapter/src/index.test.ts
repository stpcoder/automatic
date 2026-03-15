import test from "node:test";
import assert from "node:assert/strict";

import { LegacyOpenAICompatiblePlannerClient } from "./index.js";

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
