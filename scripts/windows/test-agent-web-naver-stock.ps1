param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/agent/run") -Body @{
  instruction = "네이버에서 하이닉스 주가를 조회해줘"
  context = @{
    system_id = "naver_search"
    field_values = @{
      query = "하이닉스 주가"
    }
    expected_button = "검색"
  }
} | ConvertTo-Json -Depth 20
