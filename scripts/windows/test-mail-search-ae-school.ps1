param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/mail/search") -Body @{
  keyword = "ae school"
  max_results = 10
} | ConvertTo-Json -Depth 20
