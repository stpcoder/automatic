param(
  [string]$Prompt = ""
)

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

$defaultPromptBase64 = "T3V0bG9va+yXkOyEnCBhZSBzY2hvb2wg6rWQ7Jyh7J287KCVIOq0gOugqCDsnbTrqZTsnbzsnYQg7LC+7JWEIOuCtOyaqeydhCDsoJXrpqztlZwg65KkLCBPdXRsb29rIOyhsOyngSDsl7Drnb3sspjsl5DshJwg7JaR7Iq57IiY66W8IOywvuyVhCDqt7gg64K07Jqp7J2EIOuwlO2DneycvOuhnCDslpHsi5zsipnrspDrnbzqs4Qg7KCB7KCI7ZWcIOygnOuqqeqzvCDqs7zshJzsnZgg7J2066mU7J28IOy0iOyViOydhCDsnpHshLHtlZjqs6Ag7KO87IS47JqULiDssLjsoJDrl5DripQg7KCc7YOc7Zi466W8IE91dGxvb2sg7KGw7KeBIOyXsOudveyymOyXkOyEnCDssL7slYQg64Sj7Ja07IScIOuEo+qzoCwg67O064K07KeAIOunkOqzoCDrgpjsl5Dqsowg7ZmV7J24IOyalOyyre2VtOykmA=="

if ([string]::IsNullOrWhiteSpace($Prompt)) {
  $Prompt = Decode-Utf8Base64 -Value $defaultPromptBase64
}

$instructionBase64 = Encode-Utf8Base64 -Value $Prompt
$context = @{
  approved_to_send = $false
}

Write-Host "[skh-agent] running prompt-driven mail scenario..."
$result = Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/agent/run-loop") -Body @{
  instruction_base64 = $instructionBase64
  context = $context
}

$formatted = Format-AgentRunResult -Result $result
Write-Host $formatted

if ($result.ok -eq $true) {
  Confirm-AndMaybeSendDraft -RunResult $result | Out-Null
}
