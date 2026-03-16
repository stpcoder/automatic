param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/web/fill") -Body @{
  system_id = "naver_search"
  field_values = @{
    query = "하이닉스 주가"
  }
} | ConvertTo-Json -Depth 20
