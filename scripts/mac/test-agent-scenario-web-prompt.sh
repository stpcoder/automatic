#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

prompt=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prompt|-p)
      prompt="${2:-}"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

agent_set_environment

if [[ -z "${prompt}" ]]; then
  prompt="https://www.google.com 에 접속해서 원하는 내용을 검색하고 핵심 결과를 요약해줘"
fi

instruction_base64="$(encode_utf8_base64 "${prompt}")"
body="$(node --input-type=module - "${instruction_base64}" <<'NODE'
const instructionBase64 = process.argv[2];
console.log(JSON.stringify({ instruction_base64: instructionBase64, context: {} }));
NODE
)"

echo "[skh-agent] running prompt-driven web scenario..."
result_json="$(invoke_agent_api POST "$(agent_get_url /debug/agent/run-loop)" "${body}")"
printf '%s' "${result_json}" | format_agent_run_result
