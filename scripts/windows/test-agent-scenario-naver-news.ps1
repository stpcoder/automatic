param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

Write-Host "[skh-agent] running prompt-only scenario: naver news..."

$body = @{
  instruction_base64 = "aHR0cHM6Ly93d3cubmF2ZXIuY29tIOyXkCDsoJHsho3tlbTshJwgU0sgaHluaXgg6rSA66MoIOuJtOyKpOulvCDqsoDsg4ntlZjqs6Ag6rCA7J6lIOuIiOyXkCDrnYTripQg7KCc66qpIO2VmOuCmOulvCDslYzroKTspJg="
  context = @{}
}

$result = Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/agent/run-loop") -Body $body
Format-AgentRunResult -Result $result
