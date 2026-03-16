param(
  [string]$SystemId = "security_portal",
  [string]$ExpectedButton = "Submit"
)

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/web/submit") -Body @{
  system_id = $SystemId
  expected_button = $ExpectedButton
} | ConvertTo-Json -Depth 20
