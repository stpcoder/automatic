#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

system_id="${1:-web_generic}"
agent_set_environment
body="$(node --input-type=module - "${system_id}" <<'NODE'
console.log(JSON.stringify({ system_id: process.argv[2] }));
NODE
)"
invoke_agent_api POST "$(agent_get_url /debug/web/read)" "${body}"

