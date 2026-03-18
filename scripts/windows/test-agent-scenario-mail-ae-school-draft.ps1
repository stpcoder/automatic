param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

$instructionBase64 = "T3V0bG9va+yXkOyEnCBhZSBzY2hvb2wg6rWQ7Jyh7J287KCVIOq0gOugqCDsnbTrqZTsnbzsnYQg7LC+7JWEIOuCtOyaqeydhCDsoJXrpqztlZjqs6AsIOydtOuplOydvCDso7zshozrpbwg7KeB7KCRIOyTsOyngCDrp5Dqs6AgT3V0bG9vayDsobDsp4Eg7Jew65297LKY7JeQ7IScIOygnO2DnO2YuOulvCDssL7slYQg6re4IOyImOyLoOyekOyXkOqyjCDrs7Trgrwg66mU7J28IOy0iOyViOydhCDsoJzrqqnqs7wg67O466y47J20IOyekOyXsOyKpOufveqyjCDsnpHshLHrkJwg66mU7J2866GcIOunjOuToCDrkqQsIOuztOuCtOyngCDrp5Dqs6Ag64KY7JeQ6rKMIO2ZleyduCDsmpTssq3tlbTspJg="

$context = @{
  keyword_base64 = "YWUgc2Nob29sIOq1kOycoeydvOyglQ=="
  approved_to_send = $false
}

Write-Host "[skh-agent] running mail scenario: search -> summarize -> draft -> approval..."
$result = Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/agent/run-loop") -Body @{
  instruction_base64 = $instructionBase64
  context = $context
}

$formatted = Format-AgentRunResult -Result $result
Write-Host $formatted

if ($result.ok -eq $true) {
  Confirm-AndMaybeSendDraft -RunResult $result | Out-Null
}
