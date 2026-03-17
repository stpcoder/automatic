param(
  [Parameter(Mandatory = $true)]
  [string]$ConversationId,
  [int]$MaxMessages = 20
)

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/mail/conversation") -Body @{
  conversation_id = $ConversationId
  max_messages = $MaxMessages
} | ConvertTo-Json -Depth 20
