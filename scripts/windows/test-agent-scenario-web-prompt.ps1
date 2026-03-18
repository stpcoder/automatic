param(
  [string]$Prompt = ""
)

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

$defaultPromptBase64 = "aHR0cHM6Ly93d3cuZ29vZ2xlLmNvbSDsl5Ag7KCR7IaN7ZW07IScIOybkO2VmOuKlCDrgrTsmqnsnYQg6rKA7IOJ7ZWY6rOgIO2ZleyduO2VtOykmA=="

if ([string]::IsNullOrWhiteSpace($Prompt)) {
  $Prompt = Decode-Utf8Base64 -Value $defaultPromptBase64
}

$instructionBase64 = Encode-Utf8Base64 -Value $Prompt

Write-Host "[skh-agent] running prompt-driven web scenario..."
$result = Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/agent/run-loop") -Body @{
  instruction_base64 = $instructionBase64
  context = @{}
}

Format-AgentRunResult -Result $result
