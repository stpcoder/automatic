param(
  [Parameter(Mandatory = $true)]
  [string]$Instruction,
  [string]$ContextJson = "{}",
  [int]$MaxSteps = 6
)

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

$context = ConvertFrom-AgentJson -Json $ContextJson
$result = Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/agent/run-loop") -Body @{
  instruction = $Instruction
  context = $context
  max_steps = $MaxSteps
}

Format-AgentRunResult -Result $result
