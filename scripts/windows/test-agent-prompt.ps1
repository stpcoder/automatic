param(
  [Parameter(Mandatory = $true)]
  [string]$Instruction,
  [string]$SystemId = "",
  [string]$Query = "",
  [int]$MaxSteps = 6
)

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

$context = @{}
if ($SystemId) {
  Write-Host "[skh-agent] checking extension session for $SystemId..."
  $sessions = Assert-AgentSessionForSystem -SystemId $SystemId
  Write-Host "[skh-agent] session found: $($sessions[0].session_id)"
  $context.system_id = $SystemId
}
if ($Query) {
  $fieldValues = @{
    query = $Query
  }
  $context.field_values = $fieldValues
  $context.query = $Query
  if ($SystemId -eq "naver_search") {
    $context.target_key = "search"
  }
}

Write-Host "[skh-agent] running prompt-driven agent loop..."
$body = @{
  instruction = $Instruction
  context = $context
  max_steps = $MaxSteps
}

$result = Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/agent/run-loop") -Body $body
Format-AgentRunResult -Result $result
