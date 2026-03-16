param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/web/fill") -Body @{
  system_id = "naver_search"
  field_values = @{
    query = "SK hynix stock price"
  }
} | ConvertTo-Json -Depth 20
