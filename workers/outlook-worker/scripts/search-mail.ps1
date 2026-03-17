param(
  [Parameter(Mandatory = $true)]
  [string]$PayloadJson
)

. (Join-Path $PSScriptRoot "..\..\..\scripts\windows\common.ps1")
$payload = ConvertFrom-AgentJson -Json $PayloadJson
$keyword = [string]$payload.keyword
$maxResults = if ($payload.max_results) { [int]$payload.max_results } else { 10 }

function Get-SafeString {
  param(
    [Parameter(Mandatory = $false)]
    $Value
  )

  try {
    if ($null -eq $Value) {
      return ""
    }
    return [string]$Value
  } catch {
    return ""
  }
}

function Get-MailBodySnippet {
  param(
    [Parameter(Mandatory = $true)]
    $Item
  )

  try {
    $body = Get-SafeString -Value $Item.Body
    if ([string]::IsNullOrWhiteSpace($body)) {
      return ""
    }
    $normalized = ($body -replace "\s+", " ").Trim()
    if ($normalized.Length -gt 500) {
      return $normalized.Substring(0, 500)
    }
    return $normalized
  } catch {
    return ""
  }
}

function Get-MailBodyForSearch {
  param(
    [Parameter(Mandatory = $true)]
    $Item
  )

  try {
    $body = Get-SafeString -Value $Item.Body
    if ([string]::IsNullOrWhiteSpace($body)) {
      return ""
    }
    return ($body -replace "\s+", " ").Trim()
  } catch {
    return ""
  }
}

function Get-MailSenderAddress {
  param(
    [Parameter(Mandatory = $true)]
    $Item
  )

  $sender = Get-SafeString -Value $Item.SenderEmailAddress
  if (-not [string]::IsNullOrWhiteSpace($sender)) {
    return $sender
  }

  try {
    return Get-SafeString -Value $Item.SenderName
  } catch {
    return ""
  }
}

function Get-MailRecipients {
  param(
    [Parameter(Mandatory = $true)]
    $Item
  )

  $toLine = Get-SafeString -Value $Item.To
  $ccLine = Get-SafeString -Value $Item.CC
  $combined = @($toLine, $ccLine) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
  return ($combined -join "; ").Trim()
}

function Get-MailTimestamp {
  param(
    [Parameter(Mandatory = $true)]
    $Item,
    [Parameter(Mandatory = $true)]
    [string]$PrimaryProperty
  )

  $raw = ""
  try {
    $raw = Get-SafeString -Value ($Item.$PrimaryProperty)
  } catch {
    $raw = ""
  }

  if ([string]::IsNullOrWhiteSpace($raw)) {
    foreach ($fallback in @("ReceivedTime", "SentOn", "CreationTime")) {
      try {
        $raw = Get-SafeString -Value ($Item.$fallback)
      } catch {
        $raw = ""
      }
      if (-not [string]::IsNullOrWhiteSpace($raw)) {
        break
      }
    }
  }

  $ticks = 0L
  try {
    $ticks = [DateTime]::Parse($raw).ToUniversalTime().Ticks
  } catch {
    $ticks = 0L
  }

  return @{
    raw = $raw
    ticks = $ticks
  }
}

$outlook = New-Object -ComObject Outlook.Application
$namespace = $outlook.GetNamespace("MAPI")

$matches = @()
$escapedKeyword = [regex]::Escape($keyword)
$folderSpecs = @(
  @{ label = "inbox"; folderId = 6; timeProperty = "ReceivedTime" },
  @{ label = "sent"; folderId = 5; timeProperty = "SentOn" }
)

$maxScanPerFolder = [Math]::Min([Math]::Max($maxResults * 200, 500), 5000)
$stores = @()
try {
  $stores = @($namespace.Stores)
} catch {
  $stores = @()
}

if ($stores.Count -eq 0) {
  $stores = @($namespace)
}

foreach ($store in $stores) {
  $storeName = ""
  try {
    $storeName = Get-SafeString -Value $store.DisplayName
  } catch {
    $storeName = ""
  }

  foreach ($folderSpec in $folderSpecs) {
    try {
      if ($store -is [Microsoft.Office.Interop.Outlook.NameSpace]) {
        $folder = $store.GetDefaultFolder([int]$folderSpec.folderId)
      } else {
        $folder = $store.GetDefaultFolder([int]$folderSpec.folderId)
      }
      if ($null -eq $folder) {
        continue
      }
      $items = $folder.Items
      if ($null -eq $items) {
        continue
      }
      try {
        $items.Sort("[$($folderSpec.timeProperty)]", $true)
      } catch {
      }

      $maxScan = [Math]::Min($items.Count, $maxScanPerFolder)
      for ($index = 1; $index -le $maxScan; $index++) {
        try {
          $item = $items.Item($index)
          if ($null -eq $item) {
            continue
          }

          $itemClass = 0
          try {
            $itemClass = [int]$item.Class
          } catch {
            $itemClass = 0
          }

          if ($itemClass -ne 43) {
            continue
          }

          $subject = Get-SafeString -Value $item.Subject
          $bodyFull = Get-MailBodyForSearch -Item $item
          $bodySnippet = if ([string]::IsNullOrWhiteSpace($bodyFull)) { "" } elseif ($bodyFull.Length -gt 500) { $bodyFull.Substring(0, 500) } else { $bodyFull }
          $sender = Get-MailSenderAddress -Item $item
          $recipients = Get-MailRecipients -Item $item
          $haystack = "$subject`n$bodyFull`n$sender`n$recipients"

          if ([string]::IsNullOrWhiteSpace($keyword) -or $haystack -match $escapedKeyword) {
            $timestampInfo = Get-MailTimestamp -Item $item -PrimaryProperty ([string]$folderSpec.timeProperty)
            $conversationId = ""
            try {
              $conversationId = [string]$item.ConversationID
            } catch {
              $conversationId = ""
            }

            $matches += @{
              entry_id = Get-SafeString -Value $item.EntryID
              subject = $subject
              sender = $sender
              recipients = $recipients
              received_time = [string]$timestampInfo.raw
              conversation_id = $conversationId
              body_snippet = $bodySnippet
              folder = [string]$folderSpec.label
              store = $storeName
              sort_ticks = [int64]$timestampInfo.ticks
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

$matches =
  @($matches |
    Sort-Object -Property @{ Expression = { $_.sort_ticks }; Descending = $true } |
    Select-Object -First $maxResults |
    ForEach-Object {
      @{
        entry_id = $_.entry_id
        subject = $_.subject
        sender = $_.sender
        recipients = $_.recipients
        received_time = $_.received_time
        conversation_id = $_.conversation_id
        body_snippet = $_.body_snippet
        folder = $_.folder
        store = $_.store
      }
    })

@{
  artifact_kind = "mail_search"
  keyword = $keyword
  count = $matches.Count
  messages = $matches
} | ConvertTo-Json -Depth 10 -Compress
