param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

Write-Host "[skh-agent] running generic multi-step agent loop for Naver..."

$instructionTextBase64 = "aHR0cHM6Ly93d3cubmF2ZXIuY29tIOyXkCDsoJHsho3tlbTshJwg7ZWY7J2064uJ7IqkIOyjvOqwgOulvCDqsoDsg4ntlZjqs6Ag7KeA6riIIOyjvOqwgOulvCDslYzroKTspJg="

$body = @{
  instruction_base64 = $instructionTextBase64
  context = @{}
}

$result = Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/agent/run-loop") -Body $body
Format-AgentRunResult -Result $result
