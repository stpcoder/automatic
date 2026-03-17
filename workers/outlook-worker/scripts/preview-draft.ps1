param(
  [Parameter(Mandatory = $true)]
  [string]$PayloadJson
)

. (Join-Path $PSScriptRoot "..\..\..\scripts\windows\common.ps1")
$payload = ConvertFrom-AgentJson -Json $PayloadJson

$outlook = New-Object -ComObject Outlook.Application
$namespace = $outlook.GetNamespace("MAPI")
$draft = $namespace.GetItemFromID([string]$payload.draft_id)

if ($null -eq $draft) {
  throw "Draft not found."
}

$htmlBody = ""
try {
  $htmlBody = [string]$draft.HTMLBody
} catch {
  $htmlBody = ""
}

@{
  artifact_kind = "mail_draft_preview"
  draft_id = [string]$draft.EntryID
  conversation_id = [string]$draft.ConversationID
  subject = [string]$draft.Subject
  to = @([string]$draft.To -split ";" | Where-Object { $_ -and $_.Trim().Length -gt 0 })
  cc = @([string]$draft.CC -split ";" | Where-Object { $_ -and $_.Trim().Length -gt 0 })
  body_html = $htmlBody
  preview_summary = "Draft preview for $([string]$draft.Subject)"
} | ConvertTo-Json -Depth 10 -Compress
