import { fetchJson, parseCliArgs, resolveLlmConfig, trimTrailingSlash } from "./llm-api-common.mjs";

function buildPrompt(targetTokenCount) {
  const prefix = "Return one short sentence acknowledging the request.\n\n";
  const chunk = "benchmark token ";
  return prefix + chunk.repeat(Math.max(1, targetTokenCount));
}

function readUsage(json) {
  const usage = json?.usage ?? {};
  const inputTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0);
  const outputTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? 0);
  const reasoningTokens = Number(usage.reasoning_tokens ?? usage?.output_token_details?.reasoning_tokens ?? 0);
  return {
    inputTokens,
    outputTokens,
    reasoningTokens
  };
}

function formatMsPerToken(elapsedMs, tokenCount) {
  if (!tokenCount || !Number.isFinite(tokenCount) || tokenCount <= 0) {
    return "-";
  }
  return (elapsedMs / tokenCount).toFixed(3);
}

const args = parseCliArgs(process.argv.slice(2));
const config = resolveLlmConfig(process.cwd());
const baseUrl = trimTrailingSlash(args.baseUrl ?? config.baseUrl);
const apiKey = args.apiKey ?? config.apiKey;
const sizes = String(args.sizes ?? "2000,4000,6000,8000")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value) && value > 0);
const models = String(args.models ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter((value) => value.length > 0);
const maxOutputTokens = Number(args.maxOutputTokens ?? "64");

if (models.length === 0) {
  console.error("No models provided. Pass --models modelA,modelB");
  process.exit(1);
}

console.log(`base_url=${baseUrl}`);
console.log(`sizes=${sizes.join(",")}`);
console.log(`max_output_tokens=${maxOutputTokens}`);

for (const model of models) {
  console.log(`\n=== ${model} ===`);
  for (const targetTokens of sizes) {
    const prompt = buildPrompt(targetTokens);
    const body = {
      model,
      messages: [
        {
          role: "user",
          content: prompt
        }
      ],
      max_tokens: maxOutputTokens,
      temperature: 0
    };

    const startedAt = Date.now();
    const result = await fetchJson(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });
    const elapsedMs = Date.now() - startedAt;

    if (!result.ok) {
      console.log(`[FAIL] target_in=${targetTokens} time=${elapsedMs}ms status=${result.status}`);
      console.log(result.text);
      continue;
    }

    const usage = readUsage(result.json);
    const totalTokens = usage.inputTokens + usage.outputTokens;
    console.log(
      [
        `[OK] target_in=${targetTokens}`,
        `actual_in=${usage.inputTokens || "-"}`,
        `out=${usage.outputTokens || "-"}`,
        `reasoning=${usage.reasoningTokens || 0}`,
        `time=${elapsedMs}ms`,
        `ms_per_in=${formatMsPerToken(elapsedMs, usage.inputTokens)}`,
        `ms_per_total=${formatMsPerToken(elapsedMs, totalTokens)}`
      ].join(" | ")
    );
  }
}

