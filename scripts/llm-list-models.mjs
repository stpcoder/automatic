import { fetchJson, parseCliArgs, resolveLlmConfig, trimTrailingSlash } from "./llm-api-common.mjs";

const args = parseCliArgs(process.argv.slice(2));
const config = resolveLlmConfig(process.cwd());
const baseUrl = trimTrailingSlash(args.baseUrl ?? config.baseUrl);
const apiKey = args.apiKey ?? config.apiKey;
const jsonMode = String(args.json ?? "false").toLowerCase() === "true";

const startedAt = Date.now();
const result = await fetchJson(`${baseUrl}/models`, {
  method: "GET",
  headers: {
    Authorization: `Bearer ${apiKey}`
  }
});
const elapsed = Date.now() - startedAt;

if (!result.ok) {
  console.error(`[FAIL] GET /models status=${result.status} time=${elapsed}ms`);
  console.error(result.text);
  process.exit(1);
}

const models = Array.isArray(result.json?.data) ? result.json.data : [];
if (jsonMode) {
  console.log(
    JSON.stringify(
      {
        ok: true,
        elapsed_ms: elapsed,
        count: models.length,
        models: models.map((model) => ({
          id: typeof model?.id === "string" ? model.id : "",
          owned_by: typeof model?.owned_by === "string" ? model.owned_by : ""
        }))
      },
      null,
      2
    )
  );
  process.exit(0);
}

console.log(`[OK] GET /models time=${elapsed}ms count=${models.length}`);
for (const model of models) {
  const id = typeof model?.id === "string" ? model.id : "";
  const ownedBy = typeof model?.owned_by === "string" ? model.owned_by : "";
  console.log(`${id}${ownedBy ? ` | ${ownedBy}` : ""}`);
}
