param(
  [Parameter(Mandatory = $true)]
  [string]$Keyword,
  [int]$MaxResults = 10
)

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/mail/search") -Body @{
  keyword = $Keyword
  max_results = $MaxResults
} | ConvertTo-Json -Depth 20
