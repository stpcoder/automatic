param(
  [string]$EntryId = "",
  [string]$ConversationId = "",
  [string]$BodyText = "",
  [string]$BodyHtml = "",
  [switch]$ReplyAll
)

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/mail/reply") -Body @{
  entry_id = $EntryId
  conversation_id = $ConversationId
  body_text = $BodyText
  body_html = $BodyHtml
  reply_all = $ReplyAll.IsPresent
} | ConvertTo-Json -Depth 20
