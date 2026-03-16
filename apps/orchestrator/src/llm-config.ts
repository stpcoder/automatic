import fs from "node:fs";
import path from "node:path";

export interface ResolvedLlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  source: "env" | "file" | "none";
  configPath?: string;
  error?: string;
}

type JsonRecord = Record<string, unknown>;

export function resolveLlmConfig(cwd = process.cwd()): ResolvedLlmConfig {
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
    return {
      baseUrl: "",
      apiKey: "",
      model: "",
      source: "none",
      configPath
    };
  }

  try {
    const raw = fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/, "").trim();
    const parsed = JSON.parse(raw) as unknown;
    const resolved = extractLlmConfig(parsed);
    return {
      ...resolved,
      source: "file",
      configPath
    };
  } catch (error) {
    return {
      baseUrl: "",
      apiKey: "",
      model: "",
      source: "none",
      configPath,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function extractLlmConfig(value: unknown): Omit<ResolvedLlmConfig, "source" | "configPath" | "error"> {
  const root = asRecord(value);

  const fromLlm = extractFromLlmBlock(root.llm);
  if (fromLlm) {
    return fromLlm;
  }

  const providerCandidates = [
    ...collectProviderCandidates(root.provider),
    ...collectProviderCandidates(root.providers)
  ];

  for (const candidate of providerCandidates) {
    const resolved = extractFromProviderBlock(candidate);
    if (resolved) {
      return resolved;
    }
  }

  throw new Error("Unable to resolve LLM config from opencode.ai/config.json");
}

function extractFromLlmBlock(value: unknown): Omit<ResolvedLlmConfig, "source" | "configPath" | "error"> | null {
  const block = asRecord(value);
  const baseUrl = readString(block.base_url) ?? readString(block.baseURL);
  const apiKey = readString(block.apiKey) ?? readString(block.api_key);
  const model = readString(block.model);

  if (!baseUrl && !apiKey && !model) {
    return null;
  }

  if (!baseUrl || !apiKey || !model) {
    throw new Error("llm config must include base_url/baseURL, apiKey, and model");
  }

  return { baseUrl, apiKey, model };
}

function extractFromProviderBlock(value: unknown): Omit<ResolvedLlmConfig, "source" | "configPath" | "error"> | null {
  const block = asRecord(value);
  const npmPackage = readString(block.npm);
  const options = asRecord(block.options);
  const baseUrl = readString(options.baseURL) ?? readString(options.base_url);
  const apiKey = readString(options.apiKey) ?? readString(options.api_key);
  const model = extractModelName(block.models) ?? readString(block.model) ?? readString(block.name);

  const hasAnySignal = Boolean(npmPackage || baseUrl || apiKey || model || block.models);
  if (!hasAnySignal) {
    return null;
  }

  if (npmPackage && npmPackage !== "@ai-sdk/openai-compatible") {
    return null;
  }

  if (!baseUrl || !apiKey || !model) {
    throw new Error("provider config must include options.baseURL, options.apiKey, and a model name");
  }

  return { baseUrl, apiKey, model };
}

function collectProviderCandidates(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) {
    return value.map(asRecord).filter((entry) => Object.keys(entry).length > 0);
  }

  const record = asRecord(value);
  if (Object.keys(record).length === 0) {
    return [];
  }

  const looksLikeProvider = "options" in record || "npm" in record || "models" in record;
  if (looksLikeProvider) {
    return [record];
  }

  return Object.values(record)
    .map(asRecord)
    .filter((entry) => Object.keys(entry).length > 0);
}

function extractModelName(value: unknown): string | null {
  const models = asRecord(value);
  if (Object.keys(models).length === 0) {
    return null;
  }

  for (const entry of Object.values(models)) {
    const record = asRecord(entry);
    const modelName = readString(record.name);
    if (modelName) {
      return modelName;
    }
  }

  const firstKey = Object.keys(models)[0];
  return firstKey ? String(firstKey) : null;
}

function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
