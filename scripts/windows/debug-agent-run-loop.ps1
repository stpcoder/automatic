param(
  [Parameter(Mandatory = $true)]
  [string]$Instruction,
  [string]$ContextJson = "{}",
  [int]$MaxSteps = 6
)

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

$context = ConvertFrom-AgentJson -Json $ContextJson
if ($context.system_id) {
  Write-Host "[skh-agent] checking extension session for $($context.system_id)..."
  $sessions = Assert-AgentSessionForSystem -SystemId ([string]$context.system_id)
  Write-Host "[skh-agent] session found: $($sessions[0].session_id)"
}
Write-Host "[skh-agent] running debug agent loop..."
$result = Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/agent/run-loop") -Body @{
  instruction = $Instruction
  context = $context
  max_steps = $MaxSteps
}

Format-AgentRunResult -Result $result
