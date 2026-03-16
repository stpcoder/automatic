param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

Invoke-AgentApi -Method "GET" -Uri (Get-AgentUrl "/bridge/sessions") | ConvertTo-Json -Depth 10
