param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

Write-Host "[skh-agent] running prompt-only scenario: current page actions..."

$body = @{
  instruction_base64 = "7ZiE7J6sIO2OmOydtOyngOyXkOyEnCDsgqzrnozsnbQg7ZW07JW8IO2VoCDspJHsmpTtlZwg67KE7Yq86rO8IOyeheugpeywveydhCDssL7slYTshJwg66y07JeH7J2EIO2VoCDsiJgg7J6I64qU7KeAIOyEpOuqhe2VtOykmA=="
  context = @{}
}

$result = Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/agent/run-loop") -Body $body
Format-AgentRunResult -Result $result
