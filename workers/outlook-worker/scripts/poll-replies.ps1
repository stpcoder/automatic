param(
  [Parameter(Mandatory = $true)]
  [string]$PayloadJson
)

. (Join-Path $PSScriptRoot "..\..\..\scripts\windows\common.ps1")
$payload = ConvertFrom-AgentJson -Json $PayloadJson
$watchDir = if ($payload.watch_directory) { [string]$payload.watch_directory } else { Join-Path (Join-Path $env:APPDATA "skh-agent") "outlook-watches" }
New-Item -ItemType Directory -Path $watchDir -Force | Out-Null

$matches = @()
$outlook = New-Object -ComObject Outlook.Application
$namespace = $outlook.GetNamespace("MAPI")
$inbox = $namespace.GetDefaultFolder(6)
$items = $inbox.Items
$items.Sort("[ReceivedTime]", $true)

function Get-FieldValue {
  param(
    [string]$Text,
    [string]$FieldName
  )

  $label = $FieldName -replace "_", "[ _-]?"
  $pattern = "(?im)$label\s*[:=]\s*([A-Za-z0-9._@/-]+)"
  $match = [regex]::Match($Text, $pattern)
  if ($match.Success) {
    return $match.Groups[1].Value.Trim()
  }
  return $null
}

Get-ChildItem -Path $watchDir -Filter "*.json" | ForEach-Object {
  $watch = ConvertFrom-AgentJson -Json (Get-Content $_.FullName -Raw)
  if ($watch.completed -eq $true) {
    return
  }

  foreach ($item in $items) {
    if ($item -isnot [__ComObject]) {
      continue
    }

    $entryId = [string]$item.EntryID
    if (@($watch.processed_entry_ids) -contains $entryId) {
      continue
    }

    $conversationMatches = (-not $watch.conversation_id) -or ([string]$item.ConversationID -eq [string]$watch.conversation_id)
    $senderAddress = ""
    try {
      $senderAddress = [string]$item.SenderEmailAddress
    } catch {
      $senderAddress = ""
    }
    $senderMatches = (@($watch.expected_from).Count -eq 0) -or (@($watch.expected_from) -contains $senderAddress)
    if (-not $conversationMatches -or -not $senderMatches) {
      continue
    }

    $body = [string]$item.Body
    $extracted = @{}
    $allFieldsPresent = $true
    foreach ($field in @($watch.required_fields)) {
      $value = Get-FieldValue -Text $body -FieldName ([string]$field)
      if ($null -eq $value -or $value -eq "") {
        $allFieldsPresent = $false
        break
      }
      $extracted[[string]$field] = $value
    }

    $watch.processed_entry_ids = @($watch.processed_entry_ids) + @($entryId)

    if ($allFieldsPresent) {
      $matches += @{
        case_id = [string]$watch.case_id
        sender = $senderAddress
        subject = [string]$item.Subject
        conversation_id = [string]$item.ConversationID
        body = $body
        extracted_fields = $extracted
      }
      $watch.completed = $true
      $watch.completed_at = (Get-Date).ToString("o")
      break
    }
  }

  $watch | ConvertTo-Json -Depth 10 | Set-Content -Path $_.FullName -Encoding UTF8
}

@{
  matches = $matches
} | ConvertTo-Json -Depth 10 -Compress
