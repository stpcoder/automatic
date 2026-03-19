#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

system_id="${1:-security_portal}"
page_id="${2:-}"

agent_set_environment
body="$(node --input-type=module - "${system_id}" "${page_id}" <<'NODE'
const systemId = process.argv[2];
const pageId = process.argv[3];
const body = { system_id: systemId };
if (pageId) body.page_id = pageId;
console.log(JSON.stringify(body));
NODE
)"
invoke_agent_api POST "$(agent_get_url /debug/web/open)" "${body}"

