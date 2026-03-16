param()

. (Join-Path $PSScriptRoot "common.ps1")
$repoRoot = Set-AgentEnvironment

Write-Host "RepoRoot: $repoRoot"
Write-Host "ORCHESTRATOR_BASE_URL: $env:ORCHESTRATOR_BASE_URL"
Write-Host "ORCHESTRATOR_PORT: $env:ORCHESTRATOR_PORT"
Write-Host "Node: $(node -v)"

try {
  $npmVersion = & (if (Get-Command npm.cmd -ErrorAction SilentlyContinue) { "npm.cmd" } else { "npm" }) -v
  Write-Host "Npm: $npmVersion"
} catch {
  Write-Host "Npm: unavailable"
}

$configPath = Join-Path $repoRoot "opencode.ai\config.json"
if (Test-Path $configPath) {
  Write-Host "LLM config: present at $configPath"
} else {
  Write-Host "LLM config: missing at $configPath"
}

try {
  $health = Invoke-AgentApi -Method "GET" -Uri (Get-AgentUrl "/health")
  Write-Host "Server health: ok"
  $health | ConvertTo-Json -Depth 10
} catch {
  Write-Host "Server health: failed"
  Write-Host $_
}

try {
  $portState = netstat -ano | Select-String ":$($env:ORCHESTRATOR_PORT)\s"
  if ($portState) {
    Write-Host "Port $($env:ORCHESTRATOR_PORT): in use"
    $portState
  } else {
    Write-Host "Port $($env:ORCHESTRATOR_PORT): not listening"
  }
} catch {
  Write-Host "Port check failed"
}
