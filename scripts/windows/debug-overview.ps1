param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

Invoke-AgentApi -Method "GET" -Uri "$env:ORCHESTRATOR_BASE_URL/debug/overview" | ConvertTo-Json -Depth 20
