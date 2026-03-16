param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/web/extract") -Body @{
  system_id = "naver_search"
  goal = "Search for SK hynix stock price"
  query = "SK hynix stock price"
} | ConvertTo-Json -Depth 30
