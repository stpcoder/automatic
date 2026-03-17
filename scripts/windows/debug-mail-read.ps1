param(
  [string]$EntryId = "",
  [string]$ConversationId = ""
)

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/mail/read") -Body @{
  entry_id = $EntryId
  conversation_id = $ConversationId
} | ConvertTo-Json -Depth 20
