param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/web/submit") -Body @{
  system_id = "naver_search"
  expected_button = "search"
} | ConvertTo-Json -Depth 20
