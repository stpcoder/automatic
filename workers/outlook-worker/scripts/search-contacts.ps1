param(
  [Parameter(Mandatory = $true)]
  [string]$PayloadJson
)

. (Join-Path $PSScriptRoot "..\..\..\scripts\windows\common.ps1")
$payload = ConvertFrom-AgentJson -Json $PayloadJson
$query = [string]$payload.query
$maxResults = if ($payload.max_results) { [int]$payload.max_results } else { 10 }
$maxResults = [Math]::Min([Math]::Max($maxResults, 1), 25)

function Get-SafeString {
  param($Value)
  try {
    if ($null -eq $Value) { return "" }
    return [string]$Value
  } catch {
    return ""
  }
}

function Get-SmtpAddressFromAddressEntry {
  param($AddressEntry)

  if ($null -eq $AddressEntry) {
    return ""
  }

  try {
    $exchangeUser = $AddressEntry.GetExchangeUser()
    if ($null -ne $exchangeUser) {
      $smtp = Get-SafeString -Value $exchangeUser.PrimarySmtpAddress
      if (-not [string]::IsNullOrWhiteSpace($smtp)) {
        return $smtp
      }
    }
  } catch {
  }

  try {
    $exchangeList = $AddressEntry.GetExchangeDistributionList()
    if ($null -ne $exchangeList) {
      $smtp = Get-SafeString -Value $exchangeList.PrimarySmtpAddress
      if (-not [string]::IsNullOrWhiteSpace($smtp)) {
        return $smtp
      }
    }
  } catch {
  }

  try {
    $accessor = $AddressEntry.PropertyAccessor
    if ($null -ne $accessor) {
      $smtp = Get-SafeString -Value ($accessor.GetProperty("http://schemas.microsoft.com/mapi/proptag/0x39FE001E"))
      if (-not [string]::IsNullOrWhiteSpace($smtp)) {
        return $smtp
      }
    }
  } catch {
  }

  return Get-SafeString -Value $AddressEntry.Address
}

function Get-DirectoryMetadata {
  param($AddressEntry)

  $jobTitle = ""
  $department = ""
  $company = ""
  $alias = ""

  try {
    $exchangeUser = $AddressEntry.GetExchangeUser()
    if ($null -ne $exchangeUser) {
      $jobTitle = Get-SafeString -Value $exchangeUser.JobTitle
      $department = Get-SafeString -Value $exchangeUser.Department
      $company = Get-SafeString -Value $exchangeUser.CompanyName
      $alias = Get-SafeString -Value $exchangeUser.Alias
    }
  } catch {
  }

  try {
    if ([string]::IsNullOrWhiteSpace($company)) {
      $exchangeList = $AddressEntry.GetExchangeDistributionList()
      if ($null -ne $exchangeList) {
        $company = Get-SafeString -Value $exchangeList.Name
      }
    }
  } catch {
  }

  return @{
    job_title = $jobTitle
    department = $department
    company = $company
    alias = $alias
  }
}

$results = @{}
$seen = @{}

function Normalize-SearchText {
  param(
    [string]$Value
  )

  $text = Get-SafeString -Value $Value
  if ([string]::IsNullOrWhiteSpace($text)) {
    return ""
  }

  $text = $text.ToLowerInvariant()
  $text = $text -replace "[\s\-_.,;:/\\\(\)\[\]{}]+", ""
  return $text.Trim()
}

function Get-QueryTokens {
  param(
    [string]$Value
  )

  $text = Get-SafeString -Value $Value
  if ([string]::IsNullOrWhiteSpace($text)) {
    return @()
  }

  $tokens = @($text.ToLowerInvariant().Split(" ", [System.StringSplitOptions]::RemoveEmptyEntries))
  $normalized = Normalize-SearchText -Value $text
  if (-not [string]::IsNullOrWhiteSpace($normalized)) {
    $tokens += $normalized
  }

  return @($tokens | Where-Object { $_ -and $_.Trim().Length -gt 0 } | Select-Object -Unique)
}

function Get-MatchScore {
  param(
    [string]$QueryText,
    [string]$Name,
    [string]$Email,
    [string]$Company,
    [string]$Department,
    [string]$JobTitle,
    [string]$Alias,
    [string]$Source = "",
    [string]$ListName = ""
  )

  if ([string]::IsNullOrWhiteSpace($QueryText)) {
    return 1
  }

  $queryNormalized = Normalize-SearchText -Value $QueryText
  $tokens = Get-QueryTokens -Value $QueryText

  $nameNormalized = Normalize-SearchText -Value $Name
  $emailNormalized = Normalize-SearchText -Value $Email
  $companyNormalized = Normalize-SearchText -Value $Company
  $departmentNormalized = Normalize-SearchText -Value $Department
  $jobTitleNormalized = Normalize-SearchText -Value $JobTitle
  $aliasNormalized = Normalize-SearchText -Value $Alias
  $combined = "$nameNormalized $emailNormalized $companyNormalized $departmentNormalized $jobTitleNormalized $aliasNormalized"

  $score = 0
  if (-not [string]::IsNullOrWhiteSpace($queryNormalized)) {
    if ($nameNormalized -eq $queryNormalized) { $score += 1000 }
    elseif ($nameNormalized.StartsWith($queryNormalized)) { $score += 800 }
    elseif ($nameNormalized.Contains($queryNormalized)) { $score += 650 }

    if ($aliasNormalized -eq $queryNormalized) { $score += 900 }
    elseif ($aliasNormalized.StartsWith($queryNormalized)) { $score += 700 }
    elseif ($aliasNormalized.Contains($queryNormalized)) { $score += 500 }

    if ($emailNormalized -eq $queryNormalized) { $score += 900 }
    elseif ($emailNormalized.StartsWith($queryNormalized)) { $score += 700 }
    elseif ($emailNormalized.Contains($queryNormalized)) { $score += 450 }

    if ($companyNormalized.Contains($queryNormalized)) { $score += 250 }
    if ($departmentNormalized.Contains($queryNormalized)) { $score += 250 }
    if ($jobTitleNormalized.Contains($queryNormalized)) { $score += 150 }
  }

  if ($tokens.Count -gt 0) {
    $matchedTokenCount = 0
    foreach ($token in $tokens) {
      if ([string]::IsNullOrWhiteSpace($token)) { continue }
      if ($combined.Contains($token)) {
        $matchedTokenCount += 1
      }
    }

    if ($matchedTokenCount -eq $tokens.Count) {
      $score += 300 + ($matchedTokenCount * 40)
    } elseif ($matchedTokenCount -gt 0) {
      $score += $matchedTokenCount * 35
    }
  }

  $sourceNormalized = Normalize-SearchText -Value $Source
  $listNameNormalized = Normalize-SearchText -Value $ListName
  if ($sourceNormalized.Contains("directoryresolved")) { $score += 120 }
  elseif ($sourceNormalized.Contains("directory")) { $score += 80 }
  elseif ($sourceNormalized.Contains("contacts")) { $score += 50 }
  elseif ($sourceNormalized.Contains("recentmail")) { $score += 20 }

  if (
    $listNameNormalized.Contains("globaladdresslist") -or
    $listNameNormalized.Contains("allusers") -or
    $listNameNormalized.Contains("organiz") -or
    $listNameNormalized.Contains("주소록") -or
    $listNameNormalized.Contains("조직")
  ) {
    $score += 40
  }

  return $score
}

function Add-Result {
  param(
    [string]$Name,
    [string]$Email,
    [string]$Source,
    [string]$Company,
    [string]$Department,
    [string]$JobTitle,
    [string]$EntryId = "",
    [string]$Alias = "",
    [string]$ListName = ""
  )

  if ([string]::IsNullOrWhiteSpace($Name) -and [string]::IsNullOrWhiteSpace($Email)) {
    return
  }

  $score = Get-MatchScore -QueryText $query -Name $Name -Email $Email -Company $Company -Department $Department -JobTitle $JobTitle -Alias $Alias -Source $Source -ListName $ListName
  if ($score -le 0) {
    return
  }

  $key = if (-not [string]::IsNullOrWhiteSpace($Email)) { $Email.ToLowerInvariant() } else { $Name.ToLowerInvariant() }
  if ($seen.ContainsKey($key) -and [int]$seen[$key] -ge $score) {
    return
  }
  $seen[$key] = $score

  $results[$key] = @{
    name = $Name
    email = $Email
    source = $Source
    company = $Company
    department = $Department
    job_title = $JobTitle
    entry_id = $EntryId
    alias = $Alias
    list_name = $ListName
    score = $score
    display = if (-not [string]::IsNullOrWhiteSpace($Email)) { "$Name <$Email>" } else { $Name }
  }
}

function Add-RecentMailParticipant {
  param(
    [string]$Name,
    [string]$Email,
    [string]$FolderName
  )

  Add-Result `
    -Name $Name `
    -Email $Email `
    -Source "recent_mail_$FolderName" `
    -Company "" `
    -Department "" `
    -JobTitle "" `
    -Alias ""
}

$outlook = New-Object -ComObject Outlook.Application
$namespace = $outlook.GetNamespace("MAPI")

if (-not [string]::IsNullOrWhiteSpace($query)) {
  try {
    $recipient = $namespace.CreateRecipient($query)
    if ($null -ne $recipient -and $recipient.Resolve()) {
      $addressEntry = $recipient.AddressEntry
      $meta = Get-DirectoryMetadata -AddressEntry $addressEntry
      Add-Result `
        -Name (Get-SafeString -Value $recipient.Name) `
        -Email (Get-SmtpAddressFromAddressEntry -AddressEntry $addressEntry) `
        -Source "directory_resolved" `
        -Company (Get-SafeString -Value $meta.company) `
        -Department (Get-SafeString -Value $meta.department) `
        -JobTitle (Get-SafeString -Value $meta.job_title) `
        -Alias (Get-SafeString -Value $meta.alias) `
        -ListName "resolved"
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

foreach ($store in $stores) {
  try {
    foreach ($folderId in @(6, 5)) {
      try {
        $folder = $store.GetDefaultFolder($folderId)
        if ($null -eq $folder) { continue }
        $folderName = if ($folderId -eq 6) { "inbox" } else { "sent" }
        $items = $folder.Items
        if ($null -eq $items) { continue }

        try {
          $items.Sort("[ReceivedTime]", $true)
        } catch {
        }

        $maxScan = [Math]::Min($items.Count, 800)
        for ($index = 1; $index -le $maxScan; $index++) {
          try {
            $item = $items.Item($index)
            if ($null -eq $item) { continue }
            $itemClass = 0
            try { $itemClass = [int]$item.Class } catch { $itemClass = 0 }
            if ($itemClass -ne 43) { continue }

            $senderName = Get-SafeString -Value $item.SenderName
            $senderEmail = Get-SafeString -Value $item.SenderEmailAddress
            if (-not [string]::IsNullOrWhiteSpace($senderName) -or -not [string]::IsNullOrWhiteSpace($senderEmail)) {
              Add-RecentMailParticipant -Name $senderName -Email $senderEmail -FolderName $folderName
            }

            try {
              $recipients = $item.Recipients
              if ($null -eq $recipients) { continue }
              $recipientCount = [Math]::Min([int]$recipients.Count, 20)
              for ($recipientIndex = 1; $recipientIndex -le $recipientCount; $recipientIndex++) {
                try {
                  $recipient = $recipients.Item($recipientIndex)
                  if ($null -eq $recipient) { continue }
                  $recipientName = Get-SafeString -Value $recipient.Name
                  $recipientEmail = ""
                  try {
                    if ($null -ne $recipient.AddressEntry) {
                      $recipientEmail = Get-SmtpAddressFromAddressEntry -AddressEntry $recipient.AddressEntry
                    }
                  } catch {
                  }
                  if ([string]::IsNullOrWhiteSpace($recipientEmail)) {
                    $recipientEmail = Get-SafeString -Value $recipient.Address
                  }

                  Add-RecentMailParticipant -Name $recipientName -Email $recipientEmail -FolderName $folderName
                } catch {
                  continue
                }
              }
            } catch {
            }
          } catch {
            continue
          }
        }
      } catch {
        continue
      }
    }
  } catch {
  }

  try {
    $contactsFolder = $store.GetDefaultFolder(10)
    if ($null -eq $contactsFolder) { continue }
    $items = $contactsFolder.Items
    if ($null -eq $items) { continue }

    $maxScan = [Math]::Min($items.Count, 2000)
    for ($index = 1; $index -le $maxScan; $index++) {
      try {
        $item = $items.Item($index)
        if ($null -eq $item) { continue }
        $itemClass = 0
        try { $itemClass = [int]$item.Class } catch { $itemClass = 0 }
        if ($itemClass -ne 40) { continue }

        $name = Get-SafeString -Value $item.FullName
        $email = Get-SafeString -Value $item.Email1Address
        $company = Get-SafeString -Value $item.CompanyName
        $department = Get-SafeString -Value $item.Department
        $jobTitle = Get-SafeString -Value $item.JobTitle
        Add-Result `
          -Name $name `
          -Email $email `
          -Source "contacts" `
          -Company $company `
          -Department $department `
          -JobTitle $jobTitle `
          -EntryId (Get-SafeString -Value $item.EntryID)
      } catch {
        continue
      }
    }
  } catch {
    continue
  }
}

if (-not [string]::IsNullOrWhiteSpace($query)) {
  try {
    $addressLists = @($namespace.AddressLists)
    foreach ($addressList in $addressLists) {
      $listName = Get-SafeString -Value $addressList.Name
      try {
        $entries = $addressList.AddressEntries
        if ($null -eq $entries) { continue }
        $maxScan = [Math]::Min($entries.Count, 5000)
        for ($index = 1; $index -le $maxScan; $index++) {
          try {
            $entry = $entries.Item($index)
            if ($null -eq $entry) { continue }
            $name = Get-SafeString -Value $entry.Name
            $email = Get-SmtpAddressFromAddressEntry -AddressEntry $entry
            $meta = Get-DirectoryMetadata -AddressEntry $entry
            Add-Result `
              -Name $name `
              -Email $email `
              -Source "directory" `
              -Company (Get-SafeString -Value $meta.company) `
              -Department (Get-SafeString -Value $meta.department) `
              -JobTitle (Get-SafeString -Value $meta.job_title) `
              -Alias (Get-SafeString -Value $meta.alias) `
              -ListName $listName
          } catch {
            continue
          }
        }
      } catch {
        continue
      }
    }
  } catch {
  }
}

$rankedResults = @(
  $results.Values |
    Sort-Object -Property `
      @{ Expression = { [int]$_.score }; Descending = $true }, `
      @{ Expression = { [string]$_.name } } |
    Select-Object -First $maxResults |
    ForEach-Object {
      @{
        name = $_.name
        email = $_.email
        source = $_.source
        company = $_.company
        department = $_.department
        job_title = $_.job_title
        entry_id = $_.entry_id
        alias = $_.alias
        list_name = $_.list_name
        display = $_.display
      }
    }
)

@{
  artifact_kind = "contact_search"
  query = $query
  count = $rankedResults.Count
  contacts = $rankedResults
} | ConvertTo-Json -Depth 10 -Compress
