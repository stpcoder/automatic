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

$outlook = New-Object -ComObject Outlook.Application
$namespace = $outlook.GetNamespace("MAPI")
$inbox = $namespace.GetDefaultFolder(6)
$items = $inbox.Items
$items.Sort("[ReceivedTime]", $true)

$matches = @()
$escapedKeyword = [regex]::Escape($keyword)
$maxScan = [Math]::Min($items.Count, [Math]::Max($maxResults * 20, 50))

for ($index = 1; $index -le $maxScan; $index++) {
  if ($matches.Count -ge $maxResults) {
    break
  }

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
    $bodySnippet = Get-MailBodySnippet -Item $item
    $sender = Get-MailSenderAddress -Item $item
    $haystack = "$subject`n$bodySnippet`n$sender"

    if ([string]::IsNullOrWhiteSpace($keyword) -or $haystack -match $escapedKeyword) {
      $receivedTime = ""
      $conversationId = ""
      try {
        $receivedTime = [string]$item.ReceivedTime
      } catch {
        $receivedTime = ""
      }

      try {
        $conversationId = [string]$item.ConversationID
      } catch {
        $conversationId = ""
      }

      $matches += @{
        entry_id = Get-SafeString -Value $item.EntryID
        subject = $subject
        sender = $sender
        received_time = $receivedTime
        conversation_id = $conversationId
        body_snippet = $bodySnippet
      }
    }
  } catch {
    continue
  }
}

@{
  artifact_kind = "mail_search"
  keyword = $keyword
  count = $matches.Count
  messages = $matches
} | ConvertTo-Json -Depth 10 -Compress
