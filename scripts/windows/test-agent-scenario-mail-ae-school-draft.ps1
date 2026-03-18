param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

$instructionBase64 = "T3V0bG9va+yXkOyEnCBhZSBzY2hvb2wg6rWQ7Jyh7J287KCVIOq0gOugqCDsnbTrqZTsnbzsnYQg7LC+7JWEIOuCtOyaqeydhCDsoJXrpqztlZjqs6AsIE91dGxvb2sg7KGw7KeBIOyXsOudveyymOyXkOyEnCDsoJztg5ztmLjrpbwg7LC+7JWE7IScIOq3uCDrgrTsmqnsnYQg67CU7YOV7Jy866GcIOygnO2DnO2YuOyXkOqyjCDrs7Trgrwg7KCB7KII7ZWcIOygnOuqqeqzvCDrs7jrrLjsnZgg7J2066mU7J28IOy0iOyViOydhCDsnpHshLHtlZwg65KkLCDrs7TrgrTsp4Ag66eQ6rOgIOuCmOyXkOqyjCDtmZXsnbgg7JqU7LKt7ZW07KSY"

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
