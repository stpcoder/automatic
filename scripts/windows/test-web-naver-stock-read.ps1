param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

$result = Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/web/read") -Body @{
  system_id = "web_generic"
}

Format-WebReadResult -Result $result
