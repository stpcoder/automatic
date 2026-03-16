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
  $context.system_id = $SystemId
}
if ($Query) {
  $context.field_values = @{
    query = $Query
  }
  $context.query = $Query
  if ($SystemId -eq "naver_search") {
    $context.target_key = "search"
  }
}

$result = Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/agent/run-loop") -Body @{
  instruction = $Instruction
  context = $context
  max_steps = $MaxSteps
}

Format-AgentRunResult -Result $result
