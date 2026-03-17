param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

$body = @{
  system_id = "naver_search"
  expected_button = "search"
}

Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/web/submit") -Body $body | ConvertTo-Json -Depth 20
