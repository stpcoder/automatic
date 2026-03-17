param(
  [Parameter(Mandatory = $true)]
  [string]$Instruction,
  [string]$ContextJson = "{}"
)

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

$context = ConvertFrom-AgentJson -Json $ContextJson

$body = @{
  instruction_base64 = Encode-Utf8Base64 -Value $Instruction
  context = $context
}

$result = Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/agent/run") -Body $body

Format-AgentSingleRunResult -Result $result
