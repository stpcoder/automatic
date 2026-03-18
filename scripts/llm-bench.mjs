import { fetchJson, parseCliArgs, resolveLlmConfig, trimTrailingSlash } from "./llm-api-common.mjs";

function buildPrompt(targetChars, seed) {
  const prefix = `${seed}\n\n`;
  if (prefix.length >= targetChars) {
    return prefix.slice(0, targetChars);
  }
  const filler = "Benchmark filler text for latency measurement. ";
  const repeats = Math.ceil((targetChars - prefix.length) / filler.length);
  return (prefix + filler.repeat(repeats)).slice(0, targetChars);
}

const args = parseCliArgs(process.argv.slice(2));
const config = resolveLlmConfig(process.cwd());
const baseUrl = trimTrailingSlash(args.baseUrl ?? config.baseUrl);
const apiKey = args.apiKey ?? config.apiKey;
const model = args.model ?? config.model;
const sizes = String(args.sizes ?? "500,1000,2000,4000,8000")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value) && value > 0);
const maxOutputTokens = Number(args.maxOutputTokens ?? "64");
const seedPrompt =
  args.prompt ??
  "Return one short sentence saying the benchmark request was received. Do not explain anything else.";

console.log(`base_url=${baseUrl}`);
console.log(`model=${model}`);
console.log(`sizes=${sizes.join(",")}`);

for (const size of sizes) {
  const prompt = buildPrompt(size, seedPrompt);
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
  const elapsed = Date.now() - startedAt;

  if (!result.ok) {
    console.log(`[FAIL] chars_in=${prompt.length} time=${elapsed}ms status=${result.status}`);
    console.log(result.text);
    continue;
  }

  const usage = result.json?.usage ?? {};
  const promptTokens = usage.prompt_tokens ?? usage.input_tokens ?? "-";
  const completionTokens = usage.completion_tokens ?? usage.output_tokens ?? "-";
  const reasoningTokens =
    usage.reasoning_tokens ?? usage?.output_token_details?.reasoning_tokens ?? "-";
  const responseText =
    result.json?.choices?.[0]?.message?.content ??
    result.json?.choices?.[0]?.text ??
    "";
  const responseChars = typeof responseText === "string" ? responseText.length : 0;

  console.log(
    `[OK] chars_in=${prompt.length} chars_out=${responseChars} time=${elapsed}ms tokens_in=${promptTokens} tokens_out=${completionTokens} reasoning=${reasoningTokens}`
  );
}

