#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

agent_set_environment
repo_root="${AGENT_REPO_ROOT}"
api_key="${1:-}"
base_url="${2:-${LLM_BASE_URL:-}}"
default_model="${3:-${LLM_MODEL:-gpt-5.1-codex-mini}}"
config_dir="${repo_root}/opencode.ai"
config_path="${config_dir}/config.json"
example_path="${config_dir}/config.example.json"

mkdir -p "${config_dir}"
if [[ ! -f "${config_path}" && -f "${example_path}" ]]; then
  cp "${example_path}" "${config_path}"
fi

if [[ -z "${api_key}" ]]; then
  api_key="${LLM_API_KEY:-}"
fi

if [[ -z "${api_key}" ]]; then
  echo "Missing API key. Pass it as the first argument or set LLM_API_KEY." >&2
  echo "Example: npm run mac:llm:init -- sk-your-key https://your-endpoint.example/v1 gpt-5.1-codex-mini" >&2
  exit 1
fi

if [[ -z "${base_url}" ]]; then
  echo "Missing base URL. Pass it as the second argument or set LLM_BASE_URL." >&2
  echo "Example: npm run mac:llm:init -- sk-your-key https://your-endpoint.example/v1 gpt-5.1-codex-mini" >&2
  exit 1
fi

node --input-type=module - "${config_path}" "${api_key}" "${base_url}" "${default_model}" <<'NODE'
import fs from "node:fs";

const configPath = process.argv[2];
const explicitApiKey = process.argv[3] ?? "";
const defaultBaseUrl = process.argv[4] ?? "";
const defaultModel = process.argv[5] ?? "";

let existingApiKey = "";
if (fs.existsSync(configPath)) {
  try {
    const existing = JSON.parse(fs.readFileSync(configPath, "utf8"));
    existingApiKey =
      existing?.provider?.options?.apiKey ??
      existing?.llm?.apiKey ??
      existing?.llm?.api_key ??
      "";
  } catch {}
}

const finalApiKey = explicitApiKey || existingApiKey;
const finalBaseUrl = defaultBaseUrl;
const finalModel = defaultModel;
const normalizedConfig = {
  provider: {
    name: finalModel,
    npm: "@ai-sdk/openai-compatible",
    models: {
      [finalModel]: {
        name: finalModel
      }
    },
    options: {
      baseURL: finalBaseUrl,
      apiKey: finalApiKey
    }
  }
};

fs.writeFileSync(configPath, `${JSON.stringify(normalizedConfig, null, 2)}\n`, "utf8");
console.log(`LLM config path: ${configPath}`);
console.log(fs.readFileSync(configPath, "utf8"));
NODE
