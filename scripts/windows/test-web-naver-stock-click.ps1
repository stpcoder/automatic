param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

$body = @{
  system_id = "naver_search"
  target_key = "search"
}

Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/web/click") -Body $body | ConvertTo-Json -Depth 30
