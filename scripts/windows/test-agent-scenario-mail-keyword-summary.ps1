param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

$instructionBase64 = "T3V0bG9va+yXkOyEnCBhZSBzY2hvb2wg6rSA66GoIOydtOuplOydvOydhCDssL7slYQg6rCA7J6lIOq0gOugqCDrhpLsnYAg66mU7J287J2EIOydveqzoCDtlbXsi6wg64K07Jqp7J2EIOyalOyVve2VtOykmA=="

$context = @{
  keyword_base64 = "YWUgc2Nob29s"
}

Write-Host "[skh-agent] running mail summary scenario..."
$result = Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/agent/run-loop") -Body @{
  instruction_base64 = $instructionBase64
  context = $context
}

Format-AgentRunResult -Result $result
