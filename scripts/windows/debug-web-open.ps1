param(
  [string]$SystemId = "security_portal",
  [string]$PageId = ""
)

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

$body = @{
  system_id = $SystemId
}

if ($PageId) {
  $body.page_id = $PageId
}

Invoke-AgentApi -Method "POST" -Uri "$env:ORCHESTRATOR_BASE_URL/debug/web/open" -Body $body | ConvertTo-Json -Depth 20
