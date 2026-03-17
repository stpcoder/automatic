param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

Write-Host "[skh-agent] running generic multi-step agent loop for Naver..."

$queryTextBase64 = "7ZWY7J2064uJ7IqkIOyjvOqwgA=="
$instructionTextBase64 = "64Sk7J2067KEIOyXtOyWtOyEnCDtlZjsnbTri4nsiqQg7KO86rCA65286rOgIOqygOyDie2VmOqzoCDsp4DquIgg7KO86rCAIOyVjOugpOykmA=="

$fieldValues = @{
  query_base64 = $queryTextBase64
}

$context = @{
  target_url = "https://www.naver.com"
  url_contains = "naver.com"
  title_contains = "네이버"
  open_if_missing = $true
  field_values = $fieldValues
}

$body = @{
  instruction_base64 = $instructionTextBase64
  context = $context
  max_steps = 6
}

$result = Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/agent/run-loop") -Body $body
Format-AgentRunResult -Result $result
