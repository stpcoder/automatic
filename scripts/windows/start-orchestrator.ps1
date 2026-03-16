param()

. (Join-Path $PSScriptRoot "common.ps1")
$repoRoot = Set-AgentEnvironment

Set-Location $repoRoot
if (-not (Test-Path (Join-Path $repoRoot "node_modules\ai"))) {
  throw "Missing dependency 'ai'. Run 'npm install' or 'npm run win:setup' first."
}
if (-not (Test-Path (Join-Path $repoRoot "node_modules\@ai-sdk\openai-compatible"))) {
  throw "Missing dependency '@ai-sdk/openai-compatible'. Run 'npm install' or 'npm run win:setup' first."
}
Invoke-AgentNpm -Arguments @("run", "dev")
