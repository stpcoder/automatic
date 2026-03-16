param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

$systems = @("security_portal", "dhl", "cube")
foreach ($systemId in $systems) {
  $result = Invoke-AgentApi -Method "GET" -Uri (Get-AgentUrl "/bridge/bookmarklet?systemId=$systemId")
  Write-Host ""
  Write-Host "[$systemId]"
  Write-Host $result.bookmarklet
}
