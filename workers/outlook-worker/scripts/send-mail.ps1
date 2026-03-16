param(
  [Parameter(Mandatory = $true)]
  [string]$PayloadJson
)

. (Join-Path $PSScriptRoot "..\..\..\scripts\windows\common.ps1")
$payload = ConvertFrom-AgentJson -Json $PayloadJson
$outlook = New-Object -ComObject Outlook.Application
$namespace = $outlook.GetNamespace("MAPI")
$mail = $namespace.GetItemFromID([string]$payload.draft_id)

$mail.Send()

@{
  artifact_kind = "sent_mail"
  message_id = $mail.EntryID
  conversation_id = $mail.ConversationID
  recipients = @($mail.To -split ";")
} | ConvertTo-Json -Depth 10 -Compress
