param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

$instructionBase64 = "7J2066mU7J28IOyjvOyGjOulvCDsp4HsoJEg7JOw7KeAIOunkOqzoCBPdXRsb29rIOyhsOyngSDsl7Drnb3sspjsl5DshJwgVGFlaG8gSmXrpbwg7LC+7JWEIOq1kOycoSDsnbzsoJUg7ZmV7J28IOyalOyyrSDrqZTsnbzsnYQg7J6R7ISx7ZWY6rOgLCDsirnsnbjrkJwg6rKD7Jy866GcIOuztOqzoCDrsJzshqHtlZwg65KkIO2ajOyLoOydtCDsmKTrqbQg64uk7IucIOyymOumrO2VoCDsiJgg7J6I64+E66GdIOuMgOq4sCDshKTsoJXquYzsp4Ag7ZW07KSY"

$context = @{
  approved_to_send = $true
}

Write-Host "[skh-agent] running mail scenario: draft -> send -> watch..."
$result = Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/agent/run-loop") -Body @{
  instruction_base64 = $instructionBase64
  context = $context
}

Format-AgentRunResult -Result $result
