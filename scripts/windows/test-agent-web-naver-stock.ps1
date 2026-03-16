param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/agent/run") -Body @{
  instruction = "Open Naver search and search for SK hynix stock price"
  context = @{
    system_id = "naver_search"
    field_values = @{
      query = "SK hynix stock price"
    }
    expected_button = "search"
  }
} | ConvertTo-Json -Depth 20
