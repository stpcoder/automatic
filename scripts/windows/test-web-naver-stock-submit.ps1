param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

$body = @{
  system_id = "web_generic"
  expected_button = "Submit"
}

Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/web/submit") -Body $body | ConvertTo-Json -Depth 20
