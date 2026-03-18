param(
  [Parameter(Mandatory = $true)]
  [string]$PayloadJson
)

. (Join-Path $PSScriptRoot "..\..\..\scripts\windows\common.ps1")
$payload = ConvertFrom-AgentJson -Json $PayloadJson
$query = [string]$payload.query
$maxResults = if ($payload.max_results) { [int]$payload.max_results } else { 10 }
$maxResults = [Math]::Min([Math]::Max($maxResults, 1), 25)
$escapedQuery = [regex]::Escape($query)

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

  try {
    $exchangeUser = $AddressEntry.GetExchangeUser()
    if ($null -ne $exchangeUser) {
      $jobTitle = Get-SafeString -Value $exchangeUser.JobTitle
      $department = Get-SafeString -Value $exchangeUser.Department
      $company = Get-SafeString -Value $exchangeUser.CompanyName
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
  }
}

$results = New-Object System.Collections.ArrayList
$seen = @{}

function Add-Result {
  param(
    [string]$Name,
    [string]$Email,
    [string]$Source,
    [string]$Company,
    [string]$Department,
    [string]$JobTitle,
    [string]$EntryId = ""
  )

  if ([string]::IsNullOrWhiteSpace($Name) -and [string]::IsNullOrWhiteSpace($Email)) {
    return
  }

  $key = if (-not [string]::IsNullOrWhiteSpace($Email)) { $Email.ToLowerInvariant() } else { $Name.ToLowerInvariant() }
  if ($seen.ContainsKey($key)) {
    return
  }
  $seen[$key] = $true

  [void]$results.Add(@{
    name = $Name
    email = $Email
    source = $Source
    company = $Company
    department = $Department
    job_title = $JobTitle
    entry_id = $EntryId
  })
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
        -JobTitle (Get-SafeString -Value $meta.job_title)
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
    $contactsFolder = $store.GetDefaultFolder(10)
    if ($null -eq $contactsFolder) { continue }
    $items = $contactsFolder.Items
    if ($null -eq $items) { continue }

    $maxScan = [Math]::Min($items.Count, 500)
    for ($index = 1; $index -le $maxScan; $index++) {
      if ($results.Count -ge $maxResults) { break }
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
        $haystack = "$name`n$email`n$company`n$department`n$jobTitle"

        if ([string]::IsNullOrWhiteSpace($query) -or $haystack -match $escapedQuery) {
          Add-Result `
            -Name $name `
            -Email $email `
            -Source "contacts" `
            -Company $company `
            -Department $department `
            -JobTitle $jobTitle `
            -EntryId (Get-SafeString -Value $item.EntryID)
        }
      } catch {
        continue
      }
    }
  } catch {
    continue
  }
}

if ($results.Count -lt $maxResults -and -not [string]::IsNullOrWhiteSpace($query)) {
  try {
    $addressLists = @($namespace.AddressLists)
    foreach ($addressList in $addressLists) {
      if ($results.Count -ge $maxResults) { break }
      $listName = Get-SafeString -Value $addressList.Name
      $isPreferredList = $listName -match "Global Address List|All Users|Offline Global Address List|주소록|조직"
      if (-not $isPreferredList) { continue }

      try {
        $entries = $addressList.AddressEntries
        if ($null -eq $entries) { continue }
        $maxScan = [Math]::Min($entries.Count, 1000)
        for ($index = 1; $index -le $maxScan; $index++) {
          if ($results.Count -ge $maxResults) { break }
          try {
            $entry = $entries.Item($index)
            if ($null -eq $entry) { continue }
            $name = Get-SafeString -Value $entry.Name
            $email = Get-SmtpAddressFromAddressEntry -AddressEntry $entry
            $meta = Get-DirectoryMetadata -AddressEntry $entry
            $haystack = "$name`n$email`n$($meta.company)`n$($meta.department)`n$($meta.job_title)"
            if ($haystack -match $escapedQuery) {
              Add-Result `
                -Name $name `
                -Email $email `
                -Source "directory" `
                -Company (Get-SafeString -Value $meta.company) `
                -Department (Get-SafeString -Value $meta.department) `
                -JobTitle (Get-SafeString -Value $meta.job_title)
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
}

@{
  artifact_kind = "contact_search"
  query = $query
  count = $results.Count
  contacts = @($results | Select-Object -First $maxResults)
} | ConvertTo-Json -Depth 10 -Compress
