param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

Write-Host "[skh-agent] checking extension session for naver_search..."
$sessions = Assert-AgentSessionForSystem -SystemId "naver_search"
Write-Host "[skh-agent] session found: $($sessions[0].session_id)"
Write-Host "[skh-agent] running multi-step agent loop for naver_search..."

$result = Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/agent/run-loop") -Body @{
  instruction = "Open Naver search and search for SK hynix stock price"
  context = @{
    system_id = "naver_search"
    field_values = @{
      query = "SK hynix stock price"
    }
    target_key = "search"
  }
  max_steps = 6
}

Format-AgentRunResult -Result $result
