param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

Write-Host "[skh-agent] checking extension session for naver_stock..."
$sessions = Assert-AgentSessionForSystem -SystemId "naver_stock"
Write-Host "[skh-agent] session found: $($sessions[0].session_id)"
Write-Host "[skh-agent] running direct stock extraction loop..."

$result = Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/agent/run-loop") -Body @{
  instruction = "현재 페이지에서 하이닉스 현재 주가 알려줘"
  context = @{
    system_id = "naver_stock"
  }
  max_steps = 4
}

Format-AgentRunResult -Result $result
