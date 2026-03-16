param(
  [Parameter(Mandatory = $true)]
  [string]$CaseId
)

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

Invoke-AgentApi -Method "POST" -Uri "$env:ORCHESTRATOR_BASE_URL/cases/$CaseId/advance" | ConvertTo-Json -Depth 20
