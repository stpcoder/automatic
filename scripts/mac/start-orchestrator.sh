#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

agent_set_environment
repo_root="${AGENT_REPO_ROOT}"
agent_require_command node
agent_require_command npm
agent_require_dependencies "${repo_root}"

cd "${repo_root}"
invoke_agent_npm run build
invoke_agent_npm run dev:compiled
