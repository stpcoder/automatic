#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
agent_set_environment
repo_root="${AGENT_REPO_ROOT}"
exec node "${repo_root}/scripts/llm-list-models.mjs" "$@"
