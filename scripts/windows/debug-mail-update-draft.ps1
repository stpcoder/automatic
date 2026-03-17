param(
  [Parameter(Mandatory = $true)]
  [string]$DraftId,
  [string]$Subject = "",
  [string[]]$To = @(),
  [string[]]$Cc = @(),
  [string]$BodyText = "",
  [string]$BodyHtml = ""
)

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/mail/update-draft") -Body @{
  draft_id = $DraftId
  subject = $Subject
  to = @($To)
  cc = @($Cc)
  body_text = $BodyText
  body_html = $BodyHtml
} | ConvertTo-Json -Depth 20
