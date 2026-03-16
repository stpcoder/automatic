param(
  [Parameter(Mandatory = $true)]
  [string]$DraftId
)

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/mail/send") -Body @{
  draft_id = $DraftId
} | ConvertTo-Json -Depth 20
