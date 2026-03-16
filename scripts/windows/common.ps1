function Set-AgentEnvironment {
  param(
    [string]$RepoRoot
  )

  if (-not $RepoRoot) {
    $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
  }

  $env:ORCHESTRATOR_PORT = if ($env:ORCHESTRATOR_PORT) { $env:ORCHESTRATOR_PORT } else { "43117" }
  $env:WEB_WORKER_ADAPTER = if ($env:WEB_WORKER_ADAPTER) { $env:WEB_WORKER_ADAPTER } else { "bookmarklet_bridge" }
  $env:OUTLOOK_WORKER_ADAPTER = if ($env:OUTLOOK_WORKER_ADAPTER) { $env:OUTLOOK_WORKER_ADAPTER } else { "outlook_com" }
  $env:CUBE_WORKER_ADAPTER = if ($env:CUBE_WORKER_ADAPTER) { $env:CUBE_WORKER_ADAPTER } else { "bookmarklet_bridge" }
  $env:ORCHESTRATOR_STORE = if ($env:ORCHESTRATOR_STORE) { $env:ORCHESTRATOR_STORE } else { "sqlite" }
  $env:ORCHESTRATOR_DB_PATH = if ($env:ORCHESTRATOR_DB_PATH) { $env:ORCHESTRATOR_DB_PATH } else { Join-Path $RepoRoot "data\orchestrator.sqlite" }
  $env:ORCHESTRATOR_BASE_URL = if ($env:ORCHESTRATOR_BASE_URL) { $env:ORCHESTRATOR_BASE_URL } else { "http://127.0.0.1:$($env:ORCHESTRATOR_PORT)" }

  return $RepoRoot
}

function ConvertTo-AgentHashtable {
  param(
    [Parameter(Mandatory = $true)]
    $InputObject
  )

  if ($null -eq $InputObject) {
    return $null
  }

  if ($InputObject -is [System.Collections.IDictionary]) {
    $result = @{}
    foreach ($key in $InputObject.Keys) {
      $result[$key] = ConvertTo-AgentHashtable -InputObject $InputObject[$key]
    }
    return $result
  }

  if ($InputObject -is [System.Collections.IEnumerable] -and $InputObject -isnot [string]) {
    $result = @()
    foreach ($item in $InputObject) {
      $result += ,(ConvertTo-AgentHashtable -InputObject $item)
    }
    return $result
  }

  if ($InputObject.PSObject -and $InputObject.PSObject.Properties.Count -gt 0 -and $InputObject -isnot [string]) {
    $result = @{}
    foreach ($property in $InputObject.PSObject.Properties) {
      $result[$property.Name] = ConvertTo-AgentHashtable -InputObject $property.Value
    }
    return $result
  }

  return $InputObject
}

function ConvertFrom-AgentJson {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Json
  )

  $parsed = $Json | ConvertFrom-Json
  return ConvertTo-AgentHashtable -InputObject $parsed
}

function Get-AgentUrl {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $base = $env:ORCHESTRATOR_BASE_URL.TrimEnd("/")
  if ($Path.StartsWith("/")) {
    return "${base}${Path}"
  }
  return "${base}/${Path}"
}

function Invoke-AgentNpm {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  $npmCommand = if (Get-Command npm.cmd -ErrorAction SilentlyContinue) { "npm.cmd" } else { "npm" }
  & $npmCommand @Arguments
}

function Invoke-AgentApi {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Method,
    [Parameter(Mandatory = $true)]
    [string]$Uri,
    [object]$Body
  )

  if ($null -ne $Body) {
    try {
      return Invoke-RestMethod -Method $Method -Uri $Uri -ContentType "application/json" -Body ($Body | ConvertTo-Json -Depth 20)
    }
    catch {
      throw "Cannot connect to agent server at $Uri. Start the server with 'npm run win:start-all' or verify ORCHESTRATOR_BASE_URL=${env:ORCHESTRATOR_BASE_URL}. Original error: $($_.Exception.Message)"
    }
  }

  try {
    return Invoke-RestMethod -Method $Method -Uri $Uri
  }
  catch {
    throw "Cannot connect to agent server at $Uri. Start the server with 'npm run win:start-all' or verify ORCHESTRATOR_BASE_URL=${env:ORCHESTRATOR_BASE_URL}. Original error: $($_.Exception.Message)"
  }
}
