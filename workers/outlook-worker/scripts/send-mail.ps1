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

function Get-ResolvedRecipients {
  param($Recipients)

  $values = @()
  if ($null -eq $Recipients) {
    return $values
  }

  for ($index = 1; $index -le $Recipients.Count; $index++) {
    try {
      $recipient = $Recipients.Item($index)
      if ($null -eq $recipient) { continue }
      $resolvedAddress = ""
      try {
        $entry = $recipient.AddressEntry
        if ($null -ne $entry) {
          try {
            $exchangeUser = $entry.GetExchangeUser()
            if ($null -ne $exchangeUser) {
              $resolvedAddress = Get-SafeString -Value $exchangeUser.PrimarySmtpAddress
            }
          } catch {
          }
          if ([string]::IsNullOrWhiteSpace($resolvedAddress)) {
            try {
              $exchangeList = $entry.GetExchangeDistributionList()
              if ($null -ne $exchangeList) {
                $resolvedAddress = Get-SafeString -Value $exchangeList.PrimarySmtpAddress
              }
            } catch {
            }
          }
          if ([string]::IsNullOrWhiteSpace($resolvedAddress)) {
            $resolvedAddress = Get-SafeString -Value $entry.Address
          }
        }
      } catch {
      }

      if ([string]::IsNullOrWhiteSpace($resolvedAddress)) {
        $resolvedAddress = Get-SafeString -Value $recipient.Address
      }

      if ([string]::IsNullOrWhiteSpace($resolvedAddress)) {
        $resolvedAddress = Get-SafeString -Value $recipient.Name
      }

      if (-not [string]::IsNullOrWhiteSpace($resolvedAddress)) {
        $values += $resolvedAddress.Trim()
      }
    } catch {
      continue
    }
  }

  return @($values | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)
}

function Find-MailByConversationOrSubject {
  param(
    [Parameter(Mandatory = $true)]
    $Namespace,
    [string]$ConversationId,
    [string]$Subject,
    [string]$RecipientsLine,
    [int[]]$FolderIds
  )

  $stores = @()
  try {
    $stores = @($Namespace.Stores)
  } catch {
    $stores = @()
  }

  foreach ($store in $stores) {
    foreach ($folderId in $FolderIds) {
      try {
        $folder = $store.GetDefaultFolder([int]$folderId)
        if ($null -eq $folder) { continue }
        $items = $folder.Items
        if ($null -eq $items) { continue }
        try { $items.Sort("[SentOn]", $true) } catch {}

        $maxScan = [Math]::Min($items.Count, 200)
        for ($index = 1; $index -le $maxScan; $index++) {
          try {
            $item = $items.Item($index)
            if ($null -eq $item) { continue }
            $itemClass = 0
            try { $itemClass = [int]$item.Class } catch { $itemClass = 0 }
            if ($itemClass -ne 43) { continue }

            $itemConversationId = Get-SafeString -Value $item.ConversationID
            $itemSubject = Get-SafeString -Value $item.Subject
            $itemRecipients = Get-SafeString -Value $item.To

            $conversationMatches = -not [string]::IsNullOrWhiteSpace($ConversationId) -and $itemConversationId -eq $ConversationId
            $fallbackMatches =
              -not [string]::IsNullOrWhiteSpace($Subject) -and
              $itemSubject -eq $Subject -and
              (
                [string]::IsNullOrWhiteSpace($RecipientsLine) -or
                $itemRecipients -eq $RecipientsLine
              )

            if ($conversationMatches -or $fallbackMatches) {
              return @{
                entry_id = Get-SafeString -Value $item.EntryID
                conversation_id = $itemConversationId
                subject = $itemSubject
                recipients = @([string]$item.To -split ";" | Where-Object { $_ -and $_.Trim().Length -gt 0 })
                folder_id = $folderId
                store = Get-SafeString -Value $store.DisplayName
              }
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
$mail = $namespace.GetItemFromID([string]$payload.draft_id)

if ($null -eq $mail) {
  throw "Draft not found."
}

$subject = Get-SafeString -Value $mail.Subject
$conversationId = Get-SafeString -Value $mail.ConversationID
$recipientsLine = Get-SafeString -Value $mail.To

$resolvedAll = $false
try {
  $resolvedAll = [bool]$mail.Recipients.ResolveAll()
} catch {
  $resolvedAll = $false
}

$resolvedRecipients = Get-ResolvedRecipients -Recipients $mail.Recipients
if (-not $resolvedAll -or $resolvedRecipients.Count -eq 0) {
  $recipientDebug = if ($resolvedRecipients.Count -gt 0) { $resolvedRecipients -join "; " } else { $recipientsLine }
  throw "Outlook could not resolve one or more recipients. recipients='$recipientDebug'"
}

try {
  $mail.Save()
} catch {
}

$mail.Send()

$sentMatch = $null
$outboxMatch = $null
$draftStillExists = $false

for ($attempt = 0; $attempt -lt 20; $attempt++) {
  Start-Sleep -Milliseconds 500

  $sentMatch = Find-MailByConversationOrSubject -Namespace $namespace -ConversationId $conversationId -Subject $subject -RecipientsLine $recipientsLine -FolderIds @(5)
  if ($null -ne $sentMatch) {
    break
  }

  $outboxMatch = Find-MailByConversationOrSubject -Namespace $namespace -ConversationId $conversationId -Subject $subject -RecipientsLine $recipientsLine -FolderIds @(4)

  try {
    $draftCheck = $namespace.GetItemFromID([string]$payload.draft_id)
    $draftStillExists = $null -ne $draftCheck
  } catch {
    $draftStillExists = $false
  }
}

if ($null -ne $sentMatch) {
  @{
    artifact_kind = "sent_mail"
    message_id = $sentMatch.entry_id
    conversation_id = $sentMatch.conversation_id
    recipients = $sentMatch.recipients
    delivery_state = "sent"
    store = $sentMatch.store
  } | ConvertTo-Json -Depth 10 -Compress
  exit 0
}

if ($null -ne $outboxMatch) {
  throw "Mail send was requested and the item moved to Outbox, but it has not reached Sent Items yet."
}

if ($draftStillExists) {
  throw "Mail send did not complete. The draft still remains in Drafts after Send()."
}

throw "Mail send did not complete. The message was not found in Sent Items or Outbox."
