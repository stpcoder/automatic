param(
  [string]$SystemId = "security_portal"
)

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/web/preview") -Body @{
  system_id = $SystemId
} | ConvertTo-Json -Depth 20
