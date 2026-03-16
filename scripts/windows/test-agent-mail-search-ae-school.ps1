param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/agent/run") -Body @{
  instruction = "ae school 키워드가 들어간 메일을 조회해줘"
  context = @{
    keyword = "ae school"
    max_results = 10
  }
} | ConvertTo-Json -Depth 20
