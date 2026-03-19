#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
agent_set_environment
repo_root="${AGENT_REPO_ROOT}"

raw="$(node "${repo_root}/scripts/llm-list-models.mjs" --json true)"

models_json="$(printf '%s' "${raw}" | node --input-type=module - <<'NODE'
import fs from "node:fs";
const raw = fs.readFileSync(0, "utf8");
const parsed = JSON.parse(raw);
if (!Array.isArray(parsed.models) || parsed.models.length === 0) {
  console.error("No models returned from /models.");
  process.exit(1);
}
for (const [index, model] of parsed.models.entries()) {
  const ownedBy = model.owned_by ? ` | ${model.owned_by}` : "";
  console.log(`[${index + 1}] ${model.id}${ownedBy}`);
}
console.error("__JSON__");
console.error(JSON.stringify(parsed.models));
NODE
)"

model_lines="$(printf '%s' "${models_json}" | sed '/^__JSON__$/,$d')"
models_payload="$(printf '%s' "${models_json}" | sed -n '/^__JSON__$/,$p' | tail -n +2)"
printf '[llm] available models\n%s\n' "${model_lines}"
read -r -p "Select model numbers (comma separated, e.g. 1,3,5): " selection

model_csv="$(printf '%s' "${models_payload}" | node --input-type=module - "${selection}" <<'NODE'
import fs from "node:fs";
const models = JSON.parse(fs.readFileSync(0, "utf8"));
const selection = process.argv[2] ?? "";
const chosen = Array.from(
  new Set(
    selection
      .split(",")
      .map((entry) => Number(entry.trim()))
      .filter((value) => Number.isInteger(value) && value >= 1 && value <= models.length)
      .map((index) => models[index - 1].id)
  )
);
if (chosen.length === 0) {
  process.exit(1);
}
process.stdout.write(chosen.join(","));
NODE
)" || {
  echo "No valid model numbers selected." >&2
  exit 1
}

echo "[llm] benchmarking: ${model_csv}"
exec node "${repo_root}/scripts/llm-bench-matrix.mjs" --models "${model_csv}" --sizes "2000,4000,6000,8000" --maxOutputTokens "64"
