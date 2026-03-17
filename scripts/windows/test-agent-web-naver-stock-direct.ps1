param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

Write-Host "[skh-agent] running generic direct stock extraction loop..."

$instructionTextBase64 = "aHR0cHM6Ly9maW5hbmNlLm5hdmVyLmNvbS9pdGVtL21haW4ubmF2ZXI/Y29kZT0wMDA2NjAg7Y6Y7J207KeA66W8IOyXtOqzoCDtmITsnqwg7ZWY7J2064uJ7IqkIOyjvOqwgOulvCDslYzroKTspJg="
$body = @{
  instruction_base64 = $instructionTextBase64
  context = @{}
}

$result = Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/agent/run-loop") -Body $body
Format-AgentRunResult -Result $result
