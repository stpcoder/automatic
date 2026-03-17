param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

Write-Host "[skh-agent] running prompt-only scenario: naver news detail..."

$body = @{
  instruction_base64 = "aHR0cHM6Ly93d3cubmF2ZXIuY29tIOyXkCDsoJHsho3tlbTshJwgU0sgaHluaXgg64m07Iqk66W8IOqygOyDie2VmOqzoCDqsIDsnqUg6rSA66CoIOuGkuydgCDqsrDqs7zrpbwg7Je07Ja07IScIO2VteyLrCDrgrTsmqnsnYQg7JWM66Ck7KSY"
  context = @{}
}

$result = Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/agent/run-loop") -Body $body
Format-AgentRunResult -Result $result
