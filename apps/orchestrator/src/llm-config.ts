import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

const llmConfigFileSchema = z.object({
  llm: z.object({
    base_url: z.string().min(1),
    api_key: z.string().optional().default(""),
    model: z.string().min(1)
  })
});

export interface ResolvedLlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  source: "env" | "file" | "none";
  configPath?: string;
}

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

  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = llmConfigFileSchema.parse(JSON.parse(raw));
  return {
    baseUrl: parsed.llm.base_url,
    apiKey: parsed.llm.api_key,
    model: parsed.llm.model,
    source: "file",
    configPath
  };
}
