param(
  [Parameter(Mandatory = $true)]
  [string]$PayloadJson
)

. (Join-Path $PSScriptRoot "..\..\..\scripts\windows\common.ps1")
$payload = ConvertFrom-AgentJson -Json $PayloadJson
$conversationId = [string]$payload.conversation_id
$maxMessages = if ($payload.max_messages) { [int]$payload.max_messages } else { 20 }

function Get-SafeString {
  param($Value)
  try {
    if ($null -eq $Value) { return "" }
    return [string]$Value
  } catch {
    return ""
  }
}

function Get-MailSender {
  param($Item)
  $sender = Get-SafeString -Value $Item.SenderEmailAddress
  if (-not [string]::IsNullOrWhiteSpace($sender)) { return $sender }
  return Get-SafeString -Value $Item.SenderName
}

function Get-MailRecipients {
  param($Item)
  $toLine = Get-SafeString -Value $Item.To
  $ccLine = Get-SafeString -Value $Item.CC
  $combined = @($toLine, $ccLine) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
  return ($combined -join "; ").Trim()
}

$outlook = New-Object -ComObject Outlook.Application
$namespace = $outlook.GetNamespace("MAPI")
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

$messages = @()
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
          if ([string]$item.ConversationID -ne $conversationId) { continue }
          $body = Get-SafeString -Value $item.Body
          $normalizedBody = ($body -replace "\s+", " ").Trim()
          $messages += @{
            entry_id = Get-SafeString -Value $item.EntryID
            subject = Get-SafeString -Value $item.Subject
            sender = Get-MailSender -Item $item
            recipients = Get-MailRecipients -Item $item
            received_time = Get-SafeString -Value $item.ReceivedTime
            sent_time = Get-SafeString -Value $item.SentOn
            body_snippet = if ($normalizedBody.Length -gt 500) { $normalizedBody.Substring(0, 500) } else { $normalizedBody }
            folder = [string]$folderSpec.label
            store = $storeName
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

$messages = @($messages | Sort-Object -Property @{ Expression = { $_.received_time } } | Select-Object -First $maxMessages)
@{
  artifact_kind = "mail_conversation"
  conversation_id = $conversationId
  count = $messages.Count
  messages = $messages
} | ConvertTo-Json -Depth 10 -Compress
