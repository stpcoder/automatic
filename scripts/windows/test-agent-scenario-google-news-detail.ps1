param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

Write-Host "[skh-agent] running prompt-only scenario: google news detail..."

$body = @{
  instruction_base64 = "aHR0cHM6Ly93d3cuZ29vZ2xlLmNvbSDsl5Ag7KCR7IaN7ZW07IScIFNLIGh5bml4IOuJtOyKpOulvCDqsoDsg4ntlZjqs6Ag6rCA7J6lIOq0gOugqCDrhpLsnYAg6rKw6rO866W8IOyXtOyWtOyEnCDtlbXsi6wg64K07Jqp7J2EIOyVjOugpOykmA=="
  context = @{}
}

$result = Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/agent/run-loop") -Body $body
Format-AgentRunResult -Result $result
