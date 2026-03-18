param(
  [Parameter(Mandatory = $true)]
  [string]$PayloadJson
)

. (Join-Path $PSScriptRoot "..\..\..\scripts\windows\common.ps1")
$payload = ConvertFrom-AgentJson -Json $PayloadJson

function Get-SafeString {
  param($Value)
  try {
    if ($null -eq $Value) { return "" }
    return [string]$Value
  } catch {
    return ""
  }
}

function Wrap-MailHtml {
  param(
    [string]$Content
  )

  return "<div style=""font-family:'Malgun Gothic','맑은 고딕',sans-serif;font-size:10pt;"">$Content</div>"
}

function Find-ReplyBaseItem {
  param(
    [Parameter(Mandatory = $true)]
    $Namespace,
    [string]$EntryId,
    [string]$ConversationId
  )

  if (-not [string]::IsNullOrWhiteSpace($EntryId)) {
    try {
      return $Namespace.GetItemFromID($EntryId)
    } catch {
    }
  }

  if ([string]::IsNullOrWhiteSpace($ConversationId)) {
    return $null
  }

  $stores = @()
  try {
    $stores = @($Namespace.Stores)
  } catch {
    $stores = @()
  }

  foreach ($store in $stores) {
    foreach ($folderId in @(6, 5)) {
      try {
        $folder = $store.GetDefaultFolder($folderId)
        if ($null -eq $folder) { continue }
        $items = $folder.Items
        if ($null -eq $items) { continue }
        try { $items.Sort("[ReceivedTime]", $true) } catch {}
        $maxScan = [Math]::Min($items.Count, 3000)
        for ($index = 1; $index -le $maxScan; $index++) {
          try {
            $item = $items.Item($index)
            if ($null -eq $item) { continue }
            if ([int]$item.Class -ne 43) { continue }
            if ([string]$item.ConversationID -eq $ConversationId) {
              return $item
            }
          } catch {
            continue
          }
        }
      } catch {
        continue
      }
    }
  }

  return $null
}

$outlook = New-Object -ComObject Outlook.Application
$namespace = $outlook.GetNamespace("MAPI")
$entryId = Get-SafeString -Value $payload.entry_id
$conversationId = Get-SafeString -Value $payload.conversation_id
$bodyHtml = Get-SafeString -Value $payload.body_html
$bodyText = Get-SafeString -Value $payload.body_text
$replyAll = $payload.reply_all -eq $true

$baseItem = Find-ReplyBaseItem -Namespace $namespace -EntryId $entryId -ConversationId $conversationId
if ($null -eq $baseItem) {
  throw "Base message not found for reply. entry_id='$entryId' conversation_id='$conversationId'"
}

if ($replyAll) {
  $reply = $baseItem.ReplyAll()
} else {
  $reply = $baseItem.Reply()
}

if (-not [string]::IsNullOrWhiteSpace($bodyHtml)) {
  $styledBody = Wrap-MailHtml -Content $bodyHtml
  $reply.HTMLBody = "$styledBody<hr/>$($reply.HTMLBody)"
} elseif (-not [string]::IsNullOrWhiteSpace($bodyText)) {
  $escaped = [System.Net.WebUtility]::HtmlEncode($bodyText) -replace "(\r?\n)", "<br/>"
  $styledBody = Wrap-MailHtml -Content $escaped
  $reply.HTMLBody = "$styledBody<hr/>$($reply.HTMLBody)"
}

$reply.Save()

@{
  artifact_kind = "mail_draft"
  draft_id = Get-SafeString -Value $reply.EntryID
  conversation_id = Get-SafeString -Value $reply.ConversationID
  subject = Get-SafeString -Value $reply.Subject
  to = @(Get-SafeString -Value $reply.To -split ";" | Where-Object { $_ -and $_.Trim().Length -gt 0 })
  cc = @(Get-SafeString -Value $reply.CC -split ";" | Where-Object { $_ -and $_.Trim().Length -gt 0 })
  preview_summary = "Reply draft for $($reply.Subject)"
} | ConvertTo-Json -Depth 10 -Compress
