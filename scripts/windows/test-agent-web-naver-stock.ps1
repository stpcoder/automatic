param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

Write-Host "[skh-agent] checking extension session for naver_search..."
$sessions = Assert-AgentSessionForSystem -SystemId "naver_search"
Write-Host "[skh-agent] session found: $($sessions[0].session_id)"
Write-Host "[skh-agent] running multi-step agent loop for naver_search..."

$queryTextBase64 = "7ZWY7J2064uJ7IqkIOyjvOqwgA=="
$instructionTextBase64 = "64Sk7J2067KEIOyXtOyWtOyEnCDtlZjsnbTri4nsiqQg7KO86rCA65286rOgIOqygOyDie2VmOqzoCDsp4DquIgg7KO86rCAIOyVjOugpOykmA=="

$fieldValues = @{
  query_base64 = $queryTextBase64
}

$context = @{
  system_id = "naver_search"
  field_values = $fieldValues
  target_key = "search"
}

$body = @{
  instruction_base64 = $instructionTextBase64
  context = $context
  max_steps = 6
}

$result = Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/agent/run-loop") -Body $body
Format-AgentRunResult -Result $result
