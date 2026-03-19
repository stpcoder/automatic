#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

instruction=""
context_json="{}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --instruction)
      instruction="${2:-}"
      shift 2
      ;;
    --context-json)
      context_json="${2:-{}}"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "${instruction}" ]]; then
  echo "Usage: $0 --instruction \"...\" [--context-json '{\"system_id\":\"web_generic\"}']" >&2
  exit 1
fi

agent_set_environment

echo "[skh-agent] running debug agent loop..."
instruction_base64="$(encode_utf8_base64 "${instruction}")"
body="$(node --input-type=module - "${instruction_base64}" "${context_json}" <<'NODE'
const instructionBase64 = process.argv[2];
const contextJson = process.argv[3];
const context = JSON.parse(contextJson);
console.log(JSON.stringify({ instruction_base64: instructionBase64, context }));
NODE
)"

result_json="$(invoke_agent_api POST "$(agent_get_url /debug/agent/run-loop)" "${body}")"
printf '%s' "${result_json}" | format_agent_run_result
