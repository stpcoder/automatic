param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

Write-Host "[skh-agent] checking extension session for naver_stock..."
$sessions = Assert-AgentSessionForSystem -SystemId "naver_stock"
Write-Host "[skh-agent] session found: $($sessions[0].session_id)"
Write-Host "[skh-agent] running direct stock extraction loop..."

$result = Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/agent/run-loop") -Body @{
  instruction = "Read SK hynix stock result from the current Naver stock page"
  context = @{
    system_id = "naver_stock"
  }
  max_steps = 4
}

Format-AgentRunResult -Result $result
