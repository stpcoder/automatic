param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

Write-Host "[skh-agent] checking extension session for naver_stock..."
$sessions = Assert-AgentSessionForSystem -SystemId "naver_stock"
Write-Host "[skh-agent] session found: $($sessions[0].session_id)"
Write-Host "[skh-agent] running direct stock extraction loop..."

$instructionTextBase64 = "7ZiE7J6sIO2OmOydtOyngOyXkOyEnCDtlZjsnbTri4nsiqQg7ZiE7J6sIOyjvOqwgCDslYzroKTspJg="
$context = @{
  system_id = "naver_stock"
}
$body = @{
  instruction_base64 = $instructionTextBase64
  context = $context
  max_steps = 4
}

$result = Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/agent/run-loop") -Body $body
Format-AgentRunResult -Result $result
