param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

$body = @{
  system_id = "web_generic"
  target_key = "search_action"
}

Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/web/click") -Body $body | ConvertTo-Json -Depth 30
