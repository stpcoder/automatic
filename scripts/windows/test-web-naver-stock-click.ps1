param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/web/click") -Body @{
  system_id = "naver_search"
  target_key = "search"
} | ConvertTo-Json -Depth 30
