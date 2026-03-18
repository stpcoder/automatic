param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

$instructionBase64 = "T3V0bG9va+yXkOyEnCBhZSBzY2hvb2wg6rWQ7Jyh7J287KCVIOq0gOugqCDsnbTrqZTsnbzsnYQg7LC+7JWEIOuCtOyaqeydhCDsoJXrpqztlZjqs6AsIOydtOuplOydvCDso7zshozrpbwg7KeB7KCRIOyTsOyngCDrp5Dqs6AgT3V0bG9vayDsobDsp4Eg7Jew65297LKY7JeQ7IScIFRhZWhvIEpl66W8IOywvuyVhCDqt7gg7IiY7Iug7J6Q7JeQ6rKMIOuztOuCvCDrqZTsnbwg7LSI7JWI7J2EIOygnOuqqeqzvCDrs7jrrLjsnbQg7J6Q7Jew7Iqk65+96rKMIOyekeyEseuQnCDrqZTsnbzroZwg66eM65OgIOuSpCwg67O064K07KeAIOunkOqzoCDrgpjsl5Dqsowg7ZmV7J24IOyalOyyre2VtOykmA=="

$context = @{
  keyword_base64 = "YWUgc2Nob29sIOq1kOycoeydvOyglQ=="
  approved_to_send = $false
}

Write-Host "[skh-agent] running mail scenario: search -> summarize -> draft -> approval..."
$result = Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/agent/run-loop") -Body @{
  instruction_base64 = $instructionBase64
  context = $context
}

Format-AgentRunResult -Result $result
