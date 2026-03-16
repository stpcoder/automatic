param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/web/submit") -Body @{
  system_id = "naver_search"
  expected_button = "검색"
} | ConvertTo-Json -Depth 20
