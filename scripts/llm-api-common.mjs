import fs from "node:fs";
import path from "node:path";

export function resolveLlmConfig(cwd = process.cwd()) {
  const envBaseUrl = process.env.LLM_BASE_URL;
  const envApiKey = process.env.LLM_API_KEY;
  const envModel = process.env.LLM_MODEL;

  if (envBaseUrl && envApiKey && envModel) {
    return {
      baseUrl: envBaseUrl,
      apiKey: envApiKey,
      model: envModel,
      source: "env"
    };
  }

  const configPath = path.resolve(cwd, "opencode.ai", "config.json");
  if (!fs.existsSync(configPath)) {
    throw new Error(`Missing LLM config at ${configPath}. Run 'npm run win:llm:init' or set LLM_BASE_URL, LLM_API_KEY, and LLM_MODEL.`);
  }

  const raw = fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/, "").trim();
  const parsed = JSON.parse(raw);
  const provider = parsed?.provider ?? parsed?.providers;

  const candidate = Array.isArray(provider)
    ? provider[0]
    : provider?.options
      ? provider
      : provider && typeof provider === "object"
        ? Object.values(provider).find((entry) => entry && typeof entry === "object" && entry.options)
        : null;

  const options = candidate?.options ?? parsed?.llm ?? {};
  const baseUrl = String(options.baseURL ?? options.base_url ?? "").trim();
  const apiKey = String(options.apiKey ?? options.api_key ?? "").trim();

  let model = String(parsed?.llm?.model ?? candidate?.model ?? candidate?.name ?? "").trim();
  if (!model && candidate?.models && typeof candidate.models === "object") {
    const first = Object.values(candidate.models)[0];
    model = String(first?.name ?? Object.keys(candidate.models)[0] ?? "").trim();
  }

  if (!baseUrl || !apiKey || !model) {
    throw new Error(`Unable to resolve baseUrl/apiKey/model from ${configPath}. Run 'npm run win:llm:init' or set LLM_BASE_URL, LLM_API_KEY, and LLM_MODEL.`);
  }

  return {
    baseUrl,
    apiKey,
    model,
    source: "file",
    configPath
  };
}

export function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

export async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  return { ok: response.ok, status: response.status, text, json: parsed };
}

export function parseCliArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      result[key] = "true";
      continue;
    }
    result[key] = next;
    index += 1;
  }
  return result;
}
