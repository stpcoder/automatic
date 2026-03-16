param(
  [string]$SystemId = "security_portal",
  [string]$TargetKey = "submit"
)

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/web/click") -Body @{
  system_id = $SystemId
  target_key = $TargetKey
} | ConvertTo-Json -Depth 30
