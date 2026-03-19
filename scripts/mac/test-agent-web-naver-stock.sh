#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
agent_set_environment
instruction="https://www.naver.com 에 접속해서 하이닉스 주가를 검색하고 지금 주가를 알려줘"
instruction_base64="$(encode_utf8_base64 "${instruction}")"
body="$(node --input-type=module - "${instruction_base64}" <<'NODE'
console.log(JSON.stringify({ instruction_base64: process.argv[2], context: {} }));
NODE
)"
echo "[skh-agent] running generic multi-step agent loop for Naver..."
invoke_agent_api POST "$(agent_get_url /debug/agent/run-loop)" "${body}" | format_agent_run_result

