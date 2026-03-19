#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

system_id="${1:-security_portal}"
fields_json="${2:-{}}"
agent_set_environment
body="$(node --input-type=module - "${system_id}" "${fields_json}" <<'NODE'
const systemId = process.argv[2];
const fieldsJson = process.argv[3];
console.log(JSON.stringify({ system_id: systemId, field_values: JSON.parse(fieldsJson) }));
NODE
)"
invoke_agent_api POST "$(agent_get_url /debug/web/fill)" "${body}"

