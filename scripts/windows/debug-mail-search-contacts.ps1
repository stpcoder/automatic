param(
  [Parameter(Mandatory = $true)]
  [string]$Query,
  [int]$MaxResults = 10
)

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

$result = Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/mail/search-contacts") -Body @{
  query = $Query
  max_results = $MaxResults
}

$result | ConvertTo-Json -Depth 10
