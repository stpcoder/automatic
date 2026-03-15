param(
  [Parameter(Mandatory = $true)]
  [string]$PayloadJson
)

$payload = $PayloadJson | ConvertFrom-Json -AsHashtable
$outlook = New-Object -ComObject Outlook.Application
$mail = $outlook.CreateItem(0)

$mail.To = (@($payload.to) -join ";")
$mail.CC = (@($payload.cc) -join ";")
$templateId = [string]$payload.template_id
$variablesJson = ($payload.variables | ConvertTo-Json -Depth 10)

$mail.Subject = "[$templateId] Automated Draft"
$mail.HTMLBody = "<pre>$variablesJson</pre>"
$mail.Save()

@{
  artifact_kind = "mail_draft"
  draft_id = $mail.EntryID
  preview_summary = "Drafted $templateId for $($mail.To)"
} | ConvertTo-Json -Depth 10 -Compress
