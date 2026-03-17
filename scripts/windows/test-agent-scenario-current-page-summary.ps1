param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

Write-Host "[skh-agent] running prompt-only scenario: current page summary..."

$body = @{
  instruction_base64 = "7ZiE7J6sIOyXtOugpCDsnojripQg7Y6Y7J207KeA66W8IOydveqzoCDtlbXsi6wg64K07Jqp7J2EIOyEuCDspITroZwg7JqU7JW97ZW07KSY"
  context = @{}
}

$result = Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/agent/run-loop") -Body $body
Format-AgentRunResult -Result $result
