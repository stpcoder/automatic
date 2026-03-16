param(
  [Parameter(Mandatory = $true)]
  [string]$Instruction,
  [string]$ContextJson = "{}"
)

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

$context = ConvertFrom-AgentJson -Json $ContextJson

Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/agent/run") -Body @{
  instruction = $Instruction
  context = $context
} | ConvertTo-Json -Depth 20
