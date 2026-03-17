param(
  [string]$SystemId = "web_generic"
)

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

$result = Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/web/read") -Body @{
  system_id = $SystemId
}

Format-WebReadResult -Result $result
