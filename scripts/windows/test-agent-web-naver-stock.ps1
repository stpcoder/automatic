param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

Write-Host "[skh-agent] checking extension session for naver_search..."
$sessions = Assert-AgentSessionForSystem -SystemId "naver_search"
Write-Host "[skh-agent] session found: $($sessions[0].session_id)"
Write-Host "[skh-agent] running multi-step agent loop for naver_search..."

$fieldValues = @{
  query = "하이닉스 주가"
}

$context = @{
  system_id = "naver_search"
  field_values = $fieldValues
  target_key = "search"
}

$body = @{
  instruction = "네이버 열어서 하이닉스 주가라고 검색하고 지금 주가 알려줘"
  context = $context
  max_steps = 6
}

$result = Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/agent/run-loop") -Body $body
Format-AgentRunResult -Result $result
