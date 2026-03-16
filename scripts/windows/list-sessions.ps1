param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

Invoke-AgentApi -Method "GET" -Uri "$env:ORCHESTRATOR_BASE_URL/bridge/sessions" | ConvertTo-Json -Depth 10
