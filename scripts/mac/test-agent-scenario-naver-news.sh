#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
agent_set_environment
instruction="https://www.naver.com 에 접속해서 SK hynix 관련 뉴스를 검색하고 가장 높은 관련도를 가진 결과 하나를 열어 요약해줘"
instruction_base64="$(encode_utf8_base64 "${instruction}")"
body="$(node --input-type=module - "${instruction_base64}" <<'NODE'
console.log(JSON.stringify({ instruction_base64: process.argv[2], context: {} }));
NODE
)"
echo "[skh-agent] running prompt-only scenario: naver news..."
invoke_agent_api POST "$(agent_get_url /debug/agent/run-loop)" "${body}" | format_agent_run_result

