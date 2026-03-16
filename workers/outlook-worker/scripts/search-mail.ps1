param(
  [Parameter(Mandatory = $true)]
  [string]$PayloadJson
)

. (Join-Path $PSScriptRoot "..\..\..\scripts\windows\common.ps1")
$payload = ConvertFrom-AgentJson -Json $PayloadJson
$keyword = [string]$payload.keyword
$maxResults = if ($payload.max_results) { [int]$payload.max_results } else { 10 }

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

    $subject = [string]$item.Subject
    $body = [string]$item.Body
    $sender = [string]$item.SenderEmailAddress
    $haystack = "$subject`n$body`n$sender"

    if ([string]::IsNullOrWhiteSpace($keyword) -or $haystack -match $escapedKeyword) {
      $matches += @{
        entry_id = [string]$item.EntryID
        subject = $subject
        sender = $sender
        received_time = try { [string]$item.ReceivedTime } catch { "" }
        conversation_id = try { [string]$item.ConversationID } catch { "" }
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
