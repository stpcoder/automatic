param()

. (Join-Path $PSScriptRoot "common.ps1")
$repoRoot = Set-AgentEnvironment

Write-Host "RepoRoot: $repoRoot"
Write-Host "ORCHESTRATOR_BASE_URL: $env:ORCHESTRATOR_BASE_URL"
Write-Host "ORCHESTRATOR_PORT: $env:ORCHESTRATOR_PORT"
Write-Host "Node: $(node -v)"

try {
  $npmCommand = if (Get-Command npm.cmd -ErrorAction SilentlyContinue) { "npm.cmd" } elseif (Get-Command npm -ErrorAction SilentlyContinue) { "npm" } else { $null }
  if (-not $npmCommand) {
    throw "npm not found in PATH"
  }
  $npmVersion = & $npmCommand -v
  Write-Host "Npm: $npmVersion"
} catch {
  Write-Host "Npm: unavailable"
}

$requiredModules = @(
  (Join-Path $repoRoot "node_modules\ai"),
  (Join-Path $repoRoot "node_modules\@ai-sdk\openai-compatible")
)
foreach ($modulePath in $requiredModules) {
  if (Test-Path $modulePath) {
    Write-Host "Dependency ok: $modulePath"
  } else {
    Write-Host "Dependency missing: $modulePath"
  }
}

$configPath = Join-Path $repoRoot "opencode.ai\config.json"
if (Test-Path $configPath) {
  Write-Host "LLM config: present at $configPath"
  try {
    $config = Get-Content -Path $configPath -Raw | ConvertFrom-Json
    $providerBaseUrl = if ($config.provider -and $config.provider.options) { $config.provider.options.baseURL } else { $null }
    $providerApiKey = if ($config.provider -and $config.provider.options) { $config.provider.options.apiKey } else { $null }
    $providerModel = if ($config.provider -and $config.provider.models) {
      ($config.provider.models.PSObject.Properties | Select-Object -First 1).Name
    } else { $null }
    $llmBaseUrl = if ($config.llm) { if ($config.llm.baseURL) { $config.llm.baseURL } else { $config.llm.base_url } } else { $null }
    $llmModel = if ($config.llm) { $config.llm.model } else { $null }

    Write-Host "LLM config provider.baseURL: $providerBaseUrl"
    Write-Host "LLM config provider.model: $providerModel"
    Write-Host "LLM config provider.apiKey: $(if ($providerApiKey) { '[present]' } else { '[missing]' })"
    Write-Host "LLM config llm.base_url: $llmBaseUrl"
    Write-Host "LLM config llm.model: $llmModel"
  } catch {
    Write-Host "LLM config parse: failed"
    Write-Host $_
  }
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
