param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

Write-Host "[skh-agent] running prompt-only scenario: naver shopping price..."

$body = @{
  instruction_base64 = "aHR0cHM6Ly9zZWFyY2guc2hvcHBpbmcubmF2ZXIuY29tIOyXkCDsoJHsho3tlbTshJwg66y07ISgIOuniOyasOyKpCDqsIDqsqnsnYQg6rKA7IOJ7ZWY6rOgIOqwgOyepSDqtIDroKgg64aS7J2AIOqysOqzvOulvCDsl7TslrTshJwg6rCA6rKp7J2EIOyVjOugpOykmA=="
  context = @{}
}

$result = Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/agent/run-loop") -Body $body
Format-AgentRunResult -Result $result
