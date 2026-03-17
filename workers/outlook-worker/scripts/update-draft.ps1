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

if ($payload.subject) {
  $draft.Subject = [string]$payload.subject
}
if ($null -ne $payload.to) {
  $draft.To = (@($payload.to) -join ";")
}
if ($null -ne $payload.cc) {
  $draft.CC = (@($payload.cc) -join ";")
}
if ($payload.body_html) {
  $draft.HTMLBody = [string]$payload.body_html
} elseif ($payload.body_text) {
  $draft.HTMLBody = "<div>$([string]$payload.body_text)</div>"
}

$draft.Save()

@{
  artifact_kind = "mail_draft"
  draft_id = [string]$draft.EntryID
  subject = [string]$draft.Subject
  to = @([string]$draft.To -split ";" | Where-Object { $_ -and $_.Trim().Length -gt 0 })
  cc = @([string]$draft.CC -split ";" | Where-Object { $_ -and $_.Trim().Length -gt 0 })
  preview_summary = "Updated draft $([string]$draft.Subject)"
} | ConvertTo-Json -Depth 10 -Compress
