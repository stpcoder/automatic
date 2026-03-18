param(
  [Parameter(Mandatory = $true)]
  [string]$PayloadJson
)

. (Join-Path $PSScriptRoot "..\..\..\scripts\windows\common.ps1")
$payload = ConvertFrom-AgentJson -Json $PayloadJson
$outlook = New-Object -ComObject Outlook.Application
$mail = $outlook.CreateItem(0)

function Wrap-MailHtml {
  param(
    [string]$Content
  )

  return "<div style=""font-family:'Malgun Gothic',sans-serif;font-size:10pt;"">$Content</div>"
}

$mail.To = (@($payload.to) -join ";")
$mail.CC = (@($payload.cc) -join ";")
$templateId = if ([string]::IsNullOrWhiteSpace([string]$payload.template_id)) { "general_mail" } else { [string]$payload.template_id }
$subject = if ([string]::IsNullOrWhiteSpace([string]$payload.subject)) { "[$templateId] Automated Draft" } else { [string]$payload.subject }
$bodyHtml = [string]$payload.body_html
$bodyText = [string]$payload.body_text
$variablesJson = ($payload.variables | ConvertTo-Json -Depth 10)

$mail.Subject = $subject
if (-not [string]::IsNullOrWhiteSpace($bodyHtml)) {
  $mail.HTMLBody = Wrap-MailHtml -Content $bodyHtml
}
elseif (-not [string]::IsNullOrWhiteSpace($bodyText)) {
  $escaped = [System.Net.WebUtility]::HtmlEncode($bodyText) -replace "(\r?\n)", "<br/>"
  $mail.HTMLBody = Wrap-MailHtml -Content $escaped
}
else {
  $escapedVariables = [System.Net.WebUtility]::HtmlEncode($variablesJson)
  $mail.HTMLBody = Wrap-MailHtml -Content "<pre style=""font-family:'Malgun Gothic',sans-serif;font-size:10pt;margin:0;"">$escapedVariables</pre>"
}
$mail.Save()

@{
  artifact_kind = "mail_draft"
  draft_id = $mail.EntryID
  preview_summary = "Drafted $subject for $($mail.To)"
  subject = $mail.Subject
  to = @($payload.to)
  cc = @($payload.cc)
} | ConvertTo-Json -Depth 10 -Compress
