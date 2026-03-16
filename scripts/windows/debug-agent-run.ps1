param(
  [Parameter(Mandatory = $true)]
  [string]$Instruction,
  [string]$ContextJson = "{}"
)

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

$context = $ContextJson | ConvertFrom-Json -AsHashtable

Invoke-AgentApi -Method "POST" -Uri "$env:ORCHESTRATOR_BASE_URL/debug/agent/run" -Body @{
  instruction = $Instruction
  context = $context
} | ConvertTo-Json -Depth 20
