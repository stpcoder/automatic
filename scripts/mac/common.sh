#!/usr/bin/env bash

agent_repo_root() {
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  cd "${script_dir}/../.." && pwd
}

agent_set_environment() {
  local repo_root="${1:-$(agent_repo_root)}"

  export AGENT_REPO_ROOT="${repo_root}"

  export ORCHESTRATOR_PORT="${ORCHESTRATOR_PORT:-43117}"
  export WEB_WORKER_ADAPTER="${WEB_WORKER_ADAPTER:-extension_bridge}"
  export OUTLOOK_WORKER_ADAPTER="${OUTLOOK_WORKER_ADAPTER:-fake}"
  export CUBE_WORKER_ADAPTER="${CUBE_WORKER_ADAPTER:-fake}"
  export ORCHESTRATOR_STORE="${ORCHESTRATOR_STORE:-sqlite}"
  export ORCHESTRATOR_DB_PATH="${ORCHESTRATOR_DB_PATH:-${repo_root}/data/orchestrator.sqlite}"
  export ORCHESTRATOR_BASE_URL="${ORCHESTRATOR_BASE_URL:-http://127.0.0.1:${ORCHESTRATOR_PORT}}"
  export LLM_TIMEOUT_MS="${LLM_TIMEOUT_MS:-90000}"
  export LLM_JSON_REPAIR_TIMEOUT_MS="${LLM_JSON_REPAIR_TIMEOUT_MS:-45000}"
  export BRIDGE_OBSERVATION_TIMEOUT_MS="${BRIDGE_OBSERVATION_TIMEOUT_MS:-30000}"
  export BRIDGE_COMMAND_TIMEOUT_MS="${BRIDGE_COMMAND_TIMEOUT_MS:-30000}"
  export AGENT_API_TIMEOUT_SECONDS="${AGENT_API_TIMEOUT_SECONDS:-1800}"
}

agent_require_command() {
  local command_name="$1"
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "Missing required command: ${command_name}" >&2
    exit 1
  fi
}

agent_require_dependencies() {
  local repo_root="$1"
  if [[ ! -d "${repo_root}/node_modules/ai" ]]; then
    echo "Missing dependency 'ai'. Run 'npm install' or 'npm run mac:setup' first." >&2
    exit 1
  fi
  if [[ ! -d "${repo_root}/node_modules/@ai-sdk/openai-compatible" ]]; then
    echo "Missing dependency '@ai-sdk/openai-compatible'. Run 'npm install' or 'npm run mac:setup' first." >&2
    exit 1
  fi
}

agent_get_url() {
  local path="$1"
  local base="${ORCHESTRATOR_BASE_URL%/}"
  if [[ "${path}" == /* ]]; then
    printf '%s%s\n' "${base}" "${path}"
  else
    printf '%s/%s\n' "${base}" "${path}"
  fi
}

encode_utf8_base64() {
  local value="$1"
  node --input-type=module -e 'console.log(Buffer.from(process.argv[1], "utf8").toString("base64"))' "${value}"
}

invoke_agent_npm() {
  npm "$@"
}

invoke_agent_api() {
  local method="$1"
  local uri="$2"
  local body="${3-}"
  local timeout="${AGENT_API_TIMEOUT_SECONDS:-1800}"
  local response_file http_code

  response_file="$(mktemp)"

  if [[ -n "${body}" ]]; then
    http_code="$(
      curl -sS -o "${response_file}" -w '%{http_code}' \
        -X "${method}" "${uri}" \
        -H 'Content-Type: application/json; charset=utf-8' \
        --data-binary "${body}" \
        --max-time "${timeout}"
    )" || {
      local curl_status=$?
      local detail
      detail="$(cat "${response_file}" 2>/dev/null || true)"
      rm -f "${response_file}"
      if [[ -n "${detail}" ]]; then
        echo "Agent API request failed at ${uri}. HTTP/API error details: ${detail}" >&2
      else
        echo "Cannot connect to agent server at ${uri}. Start the server with 'npm run mac:start' or verify ORCHESTRATOR_BASE_URL=${ORCHESTRATOR_BASE_URL}. curl exit=${curl_status}" >&2
      fi
      return 1
    }
  else
    http_code="$(
      curl -sS -o "${response_file}" -w '%{http_code}' \
        -X "${method}" "${uri}" \
        --max-time "${timeout}"
    )" || {
      local curl_status=$?
      local detail
      detail="$(cat "${response_file}" 2>/dev/null || true)"
      rm -f "${response_file}"
      if [[ -n "${detail}" ]]; then
        echo "Agent API request failed at ${uri}. HTTP/API error details: ${detail}" >&2
      else
        echo "Cannot connect to agent server at ${uri}. Start the server with 'npm run mac:start' or verify ORCHESTRATOR_BASE_URL=${ORCHESTRATOR_BASE_URL}. curl exit=${curl_status}" >&2
      fi
      return 1
    }
  fi

  if [[ "${http_code}" -lt 200 || "${http_code}" -ge 300 ]]; then
    local detail
    detail="$(cat "${response_file}")"
    rm -f "${response_file}"
    echo "Agent API request failed at ${uri}. HTTP ${http_code}: ${detail}" >&2
    return 1
  fi

  cat "${response_file}"
  rm -f "${response_file}"
}

format_agent_run_result() {
  local result_file
  result_file="$(mktemp)"
  cat > "${result_file}"
  node --input-type=module - "${result_file}" <<'NODE'
import fs from "node:fs";

const resultFile = process.argv[2];
const raw = fs.readFileSync(resultFile, "utf8");
const result = JSON.parse(raw);

if (result.ok === true) {
  const summary = result.final_response ? String(result.final_response) : "Task completed.";
  const steps = Array.isArray(result.steps) ? result.steps.map((step) => step.tool).filter(Boolean) : [];
  console.log(`[DONE] ${summary}`);
  if (steps.length > 0) {
    console.log(`tools: ${steps.join(" -> ")}`);
  }
  if (result.timing?.total_ms != null) {
    console.log(`time: ${result.timing.total_ms}ms`);
  }
  process.exit(0);
}

console.log(`[FAIL] ${result.error_stage ?? "unknown_stage"}`);
if (result.error_code) {
  console.log(`code: ${result.error_code}`);
}
if (result.error_message) {
  console.log(String(result.error_message));
}
if (result.timing?.total_ms != null) {
  console.log(`time: ${result.timing.total_ms}ms`);
}
process.exit(0);
NODE
  rm -f "${result_file}"
}
