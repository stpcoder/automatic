#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

agent_set_environment
repo_root="${AGENT_REPO_ROOT}"

echo "RepoRoot: ${repo_root}"
echo "ORCHESTRATOR_BASE_URL: ${ORCHESTRATOR_BASE_URL}"
echo "ORCHESTRATOR_PORT: ${ORCHESTRATOR_PORT}"
echo "WEB_WORKER_ADAPTER: ${WEB_WORKER_ADAPTER}"
echo "OUTLOOK_WORKER_ADAPTER: ${OUTLOOK_WORKER_ADAPTER}"
echo "Node: $(node -v)"
echo "Npm: $(npm -v)"

for module_path in \
  "${repo_root}/node_modules/ai" \
  "${repo_root}/node_modules/@ai-sdk/openai-compatible"
do
  if [[ -e "${module_path}" ]]; then
    echo "Dependency ok: ${module_path}"
  else
    echo "Dependency missing: ${module_path}"
  fi
done

config_path="${repo_root}/opencode.ai/config.json"
if [[ -f "${config_path}" ]]; then
  echo "LLM config: present at ${config_path}"
  node --input-type=module - "${config_path}" <<'NODE'
import fs from "node:fs";
const configPath = process.argv[2];
try {
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const providerBaseUrl = config?.provider?.options?.baseURL ?? null;
  const providerApiKey = config?.provider?.options?.apiKey ?? null;
  const providerModel = config?.provider?.models ? Object.keys(config.provider.models)[0] : null;
  const llmBaseUrl = config?.llm?.baseURL ?? config?.llm?.base_url ?? null;
  const llmModel = config?.llm?.model ?? null;
  console.log(`LLM config provider.baseURL: ${providerBaseUrl ?? ""}`);
  console.log(`LLM config provider.model: ${providerModel ?? ""}`);
  console.log(`LLM config provider.apiKey: ${providerApiKey ? "[present]" : "[missing]"}`);
  console.log(`LLM config llm.base_url: ${llmBaseUrl ?? ""}`);
  console.log(`LLM config llm.model: ${llmModel ?? ""}`);
} catch {
  console.log("LLM config parse: failed");
}
NODE
else
  echo "LLM config: missing at ${config_path}"
fi

if health_json="$(invoke_agent_api GET "$(agent_get_url /health)")"; then
  echo "Server health: ok"
  printf '%s\n' "${health_json}"
else
  echo "Server health: failed"
fi

echo "Chrome Extension Bridge: expected"
echo "Chrome Site Access: set the extension to 'On all sites' or Chrome will prompt on each new site."
echo "Chrome internal pages such as chrome:// and the Chrome Web Store cannot be controlled."
echo "Mail tools: unsupported on macOS in this repo; use web/LLM paths only."

if sessions_json="$(invoke_agent_api GET "$(agent_get_url /bridge/sessions)")"; then
  echo "Extension sessions:"
  AGENT_SESSIONS_JSON="${sessions_json}" node --input-type=module - <<'NODE'
const raw = process.env.AGENT_SESSIONS_JSON ?? "";
const sessions = JSON.parse(raw);
const items = Array.isArray(sessions) ? sessions : [];
console.log(`count=${items.length}`);
for (const session of items) {
  console.log(`${session.session_id} | ${session.system_id} | obs=${session.has_observation} | stale=${session.is_stale} | ${session.title ?? ""} | ${session.url ?? ""}`);
}
NODE
else
  echo "Extension sessions: failed"
fi

if lsof -nP -iTCP:"${ORCHESTRATOR_PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port ${ORCHESTRATOR_PORT}: in use"
  lsof -nP -iTCP:"${ORCHESTRATOR_PORT}" -sTCP:LISTEN
else
  echo "Port ${ORCHESTRATOR_PORT}: not listening"
fi
