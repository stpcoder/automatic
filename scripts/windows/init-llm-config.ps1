param(
  [string]$ApiKey = ""
)

. (Join-Path $PSScriptRoot "common.ps1")
$repoRoot = Set-AgentEnvironment

$configDir = Join-Path $repoRoot "opencode.ai"
$configPath = Join-Path $configDir "config.json"
$examplePath = Join-Path $configDir "config.example.json"

New-Item -ItemType Directory -Path $configDir -Force | Out-Null

if (-not (Test-Path $configPath)) {
  if (Test-Path $examplePath) {
    Copy-Item $examplePath $configPath
  }
  else {
    @'
{
  "provider": {
    "name": "zai-org/GLM4.7",
    "npm": "@ai-sdk/openai-compatible",
    "models": {
      "GLM4.7": {
        "name": "GLM4.7"
      }
    },
    "options": {
      "baseURL": "http://common.llm.skhynix.com/v1",
      "apiKey": ""
    }
  }
}
'@ | Set-Content -Path $configPath -Encoding UTF8
  }
}

if ($ApiKey) {
  $config = Get-Content -Path $configPath -Raw | ConvertFrom-Json
  if ($config.provider -and $config.provider.options) {
    $config.provider.options.apiKey = $ApiKey
    if ($config.provider.options.PSObject.Properties["api_key"]) {
      $config.provider.options.PSObject.Properties.Remove("api_key")
    }
  }
  elseif ($config.llm) {
    $config.llm.apiKey = $ApiKey
    if ($config.llm.PSObject.Properties["api_key"]) {
      $config.llm.PSObject.Properties.Remove("api_key")
    }
  }
  $config | ConvertTo-Json -Depth 10 | Set-Content -Path $configPath -Encoding UTF8
}

Write-Host "LLM config path: $configPath"
Get-Content -Path $configPath
