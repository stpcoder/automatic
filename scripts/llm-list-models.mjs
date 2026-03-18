import { fetchJson, parseCliArgs, resolveLlmConfig, trimTrailingSlash } from "./llm-api-common.mjs";

function normalizeModelsPayload(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (Array.isArray(payload?.data)) {
    return payload.data;
  }
  if (Array.isArray(payload?.models)) {
    return payload.models;
  }
  if (payload && typeof payload === "object") {
    const values = Object.values(payload);
    if (values.every((entry) => entry && typeof entry === "object")) {
      return values.map((entry, index) => ({
        id: typeof entry.id === "string" ? entry.id : typeof Object.keys(payload)[index] === "string" ? Object.keys(payload)[index] : "",
        ...entry
      }));
    }
  }
  return [];
}

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

const models = normalizeModelsPayload(result.json);
if (jsonMode) {
  console.log(
    JSON.stringify(
      {
        ok: true,
        elapsed_ms: elapsed,
        count: models.length,
        raw: result.json ?? result.text,
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
if (models.length === 0) {
  console.log("[INFO] raw /models response:");
  console.log(typeof result.json === "object" && result.json !== null ? JSON.stringify(result.json, null, 2) : result.text);
}
for (const model of models) {
  const id = typeof model?.id === "string" ? model.id : "";
  const ownedBy = typeof model?.owned_by === "string" ? model.owned_by : "";
  console.log(`${id}${ownedBy ? ` | ${ownedBy}` : ""}`);
}
