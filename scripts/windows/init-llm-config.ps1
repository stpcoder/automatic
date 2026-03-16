param(
  [string]$ApiKey = ""
)

. (Join-Path $PSScriptRoot "common.ps1")
$repoRoot = Set-AgentEnvironment

$configDir = Join-Path $repoRoot "opencode.ai"
$configPath = Join-Path $configDir "config.json"
$examplePath = Join-Path $configDir "config.example.json"

New-Item -ItemType Directory -Path $configDir -Force | Out-Null

$existingApiKey = ""

if (Test-Path $configPath) {
  try {
    $existingConfig = Get-Content -Path $configPath -Raw | ConvertFrom-Json
    if ($existingConfig.provider -and $existingConfig.provider.options -and $existingConfig.provider.options.apiKey) {
      $existingApiKey = [string]$existingConfig.provider.options.apiKey
    }
    elseif ($existingConfig.llm -and $existingConfig.llm.apiKey) {
      $existingApiKey = [string]$existingConfig.llm.apiKey
    }
    elseif ($existingConfig.llm -and $existingConfig.llm.api_key) {
      $existingApiKey = [string]$existingConfig.llm.api_key
    }
  } catch {
  }
} elseif (Test-Path $examplePath) {
  Copy-Item $examplePath $configPath
}

$finalApiKey = if ($ApiKey) { $ApiKey } else { $existingApiKey }

$normalizedConfig = [ordered]@{
  provider = [ordered]@{
    name = "GLM-4.7"
    npm = "@ai-sdk/openai-compatible"
    models = [ordered]@{
      "GLM-4.7" = [ordered]@{
        name = "GLM-4.7"
      }
    }
    options = [ordered]@{
      baseURL = "http://common.llm.skhynix.com/v1"
      apiKey = $finalApiKey
    }
  }
}

$normalizedConfig | ConvertTo-Json -Depth 10 | Set-Content -Path $configPath -Encoding UTF8

Write-Host "LLM config path: $configPath"
Get-Content -Path $configPath
