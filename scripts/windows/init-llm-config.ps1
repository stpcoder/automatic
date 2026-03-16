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
  "llm": {
    "base_url": "https://common.llm.skhynix.com/v1",
    "api_key": "",
    "model": "zai-org/GLM-4.7",
    "path": "/chat/completions"
  }
}
'@ | Set-Content -Path $configPath -Encoding UTF8
  }
}

if ($ApiKey) {
  $config = Get-Content -Path $configPath -Raw | ConvertFrom-Json
  $config.llm.api_key = $ApiKey
  $config | ConvertTo-Json -Depth 10 | Set-Content -Path $configPath -Encoding UTF8
}

Write-Host "LLM config path: $configPath"
Get-Content -Path $configPath
