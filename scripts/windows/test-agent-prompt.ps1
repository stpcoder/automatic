param(
  [Parameter(Mandatory = $true)]
  [string]$Instruction,
  [string]$TargetUrl = "",
  [string]$UrlContains = "",
  [string]$TitleContains = "",
  [string]$Query = "",
  [switch]$OpenIfMissing
)

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

$instructionBase64 = Encode-Utf8Base64 -Value $Instruction
$context = @{}
if ($TargetUrl) {
  $context.target_url = $TargetUrl
}
if ($UrlContains) {
  $context.url_contains = $UrlContains
}
if ($TitleContains) {
  $context.title_contains = $TitleContains
}
if ($OpenIfMissing.IsPresent) {
  $context.open_if_missing = $true
}
if ($Query) {
  $queryBase64 = Encode-Utf8Base64 -Value $Query
  $fieldValues = @{
    query_base64 = $queryBase64
  }
  $context.field_values = $fieldValues
  $context.query_base64 = $queryBase64
}

Write-Host "[skh-agent] running prompt-driven agent loop..."
$body = @{
  instruction_base64 = $instructionBase64
  context = $context
}

$result = Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/agent/run-loop") -Body $body
Format-AgentRunResult -Result $result
