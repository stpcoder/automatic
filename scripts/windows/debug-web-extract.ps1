param(
  [string]$SystemId = "security_portal",
  [string]$Goal = "",
  [string]$Query = ""
)

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/web/extract") -Body @{
  system_id = $SystemId
  goal = $Goal
  query = $Query
} | ConvertTo-Json -Depth 30
