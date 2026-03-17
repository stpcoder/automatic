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

function Get-MailBody {
  param($Item)
  try {
    return (Get-SafeString -Value $Item.Body)
  } catch {
    return ""
  }
}

function Get-MailRecipients {
  param($Item)
  $toLine = Get-SafeString -Value $Item.To
  $ccLine = Get-SafeString -Value $Item.CC
  $combined = @($toLine, $ccLine) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
  return ($combined -join "; ").Trim()
}

function Get-MailSender {
  param($Item)
  $sender = Get-SafeString -Value $Item.SenderEmailAddress
  if (-not [string]::IsNullOrWhiteSpace($sender)) {
    return $sender
  }
  return Get-SafeString -Value $Item.SenderName
}

function Convert-MailItem {
  param(
    [Parameter(Mandatory = $true)]
    $Item,
    [Parameter(Mandatory = $false)]
    [string]$FolderLabel = "",
    [Parameter(Mandatory = $false)]
    [string]$StoreLabel = ""
  )

  $body = Get-MailBody -Item $Item
  $normalizedBody = ($body -replace "\s+", " ").Trim()
  $snippet = if ($normalizedBody.Length -gt 500) { $normalizedBody.Substring(0, 500) } else { $normalizedBody }
  return @{
    artifact_kind = "mail_detail"
    entry_id = Get-SafeString -Value $Item.EntryID
    subject = Get-SafeString -Value $Item.Subject
    sender = Get-MailSender -Item $Item
    recipients = Get-MailRecipients -Item $Item
    received_time = Get-SafeString -Value $Item.ReceivedTime
    sent_time = Get-SafeString -Value $Item.SentOn
    conversation_id = Get-SafeString -Value $Item.ConversationID
    folder = $FolderLabel
    store = $StoreLabel
    body = $body
    body_snippet = $snippet
  }
}

$outlook = New-Object -ComObject Outlook.Application
$namespace = $outlook.GetNamespace("MAPI")
$entryId = Get-SafeString -Value $payload.entry_id
$conversationId = Get-SafeString -Value $payload.conversation_id

if (-not [string]::IsNullOrWhiteSpace($entryId)) {
  try {
    $item = $namespace.GetItemFromID($entryId)
    if ($null -ne $item) {
      Convert-MailItem -Item $item | ConvertTo-Json -Depth 10 -Compress
      exit 0
    }
  } catch {
  }
}

$stores = @()
try {
  $stores = @($namespace.Stores)
} catch {
  $stores = @()
}

$folderSpecs = @(
  @{ label = "inbox"; folderId = 6; timeProperty = "ReceivedTime" },
  @{ label = "sent"; folderId = 5; timeProperty = "SentOn" }
)

foreach ($store in $stores) {
  $storeName = Get-SafeString -Value $store.DisplayName
  foreach ($folderSpec in $folderSpecs) {
    try {
      $folder = $store.GetDefaultFolder([int]$folderSpec.folderId)
      if ($null -eq $folder) { continue }
      $items = $folder.Items
      if ($null -eq $items) { continue }
      try { $items.Sort("[$($folderSpec.timeProperty)]", $true) } catch {}

      $maxScan = [Math]::Min($items.Count, 3000)
      for ($index = 1; $index -le $maxScan; $index++) {
        try {
          $item = $items.Item($index)
          if ($null -eq $item) { continue }
          $itemClass = 0
          try { $itemClass = [int]$item.Class } catch { $itemClass = 0 }
          if ($itemClass -ne 43) { continue }
          if (-not [string]::IsNullOrWhiteSpace($conversationId) -and [string]$item.ConversationID -eq $conversationId) {
            Convert-MailItem -Item $item -FolderLabel ([string]$folderSpec.label) -StoreLabel $storeName | ConvertTo-Json -Depth 10 -Compress
            exit 0
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

throw "Mail not found. entry_id='$entryId' conversation_id='$conversationId'"
