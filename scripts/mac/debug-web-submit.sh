#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

system_id="${1:-security_portal}"
expected_button="${2:-Submit}"
agent_set_environment
body="$(node --input-type=module - "${system_id}" "${expected_button}" <<'NODE'
console.log(JSON.stringify({ system_id: process.argv[2], expected_button: process.argv[3] }));
NODE
)"
invoke_agent_api POST "$(agent_get_url /debug/web/submit)" "${body}"

