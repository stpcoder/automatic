param(
  [Parameter(Mandatory = $true)]
  [string]$Instruction,
  [string]$ContextJson = "{}"
)

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

$context = ConvertFrom-AgentJson -Json $ContextJson
if ($context.system_id) {
  Write-Host "[skh-agent] checking extension session for $($context.system_id)..."
  $sessions = Assert-AgentSessionForSystem -SystemId ([string]$context.system_id)
  Write-Host "[skh-agent] session found: $($sessions[0].session_id)"
}
Write-Host "[skh-agent] running debug agent loop..."
$body = @{
  instruction_base64 = Encode-Utf8Base64 -Value $Instruction
  context = $context
}

$result = Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/agent/run-loop") -Body $body

Format-AgentRunResult -Result $result
