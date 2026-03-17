function Set-AgentEnvironment {
  param(
    [string]$RepoRoot
  )

  if (-not $RepoRoot) {
    $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
  }

  $env:ORCHESTRATOR_PORT = if ($env:ORCHESTRATOR_PORT) { $env:ORCHESTRATOR_PORT } else { "43117" }
  $env:WEB_WORKER_ADAPTER = if ($env:WEB_WORKER_ADAPTER) { $env:WEB_WORKER_ADAPTER } else { "extension_bridge" }
  $env:OUTLOOK_WORKER_ADAPTER = if ($env:OUTLOOK_WORKER_ADAPTER) { $env:OUTLOOK_WORKER_ADAPTER } else { "outlook_com" }
  $env:CUBE_WORKER_ADAPTER = if ($env:CUBE_WORKER_ADAPTER) { $env:CUBE_WORKER_ADAPTER } else { "extension_bridge" }
  $env:ORCHESTRATOR_STORE = if ($env:ORCHESTRATOR_STORE) { $env:ORCHESTRATOR_STORE } else { "sqlite" }
  $env:ORCHESTRATOR_DB_PATH = if ($env:ORCHESTRATOR_DB_PATH) { $env:ORCHESTRATOR_DB_PATH } else { Join-Path $RepoRoot "data\orchestrator.sqlite" }
  $env:ORCHESTRATOR_BASE_URL = if ($env:ORCHESTRATOR_BASE_URL) { $env:ORCHESTRATOR_BASE_URL } else { "http://127.0.0.1:$($env:ORCHESTRATOR_PORT)" }
  $env:LLM_TIMEOUT_MS = if ($env:LLM_TIMEOUT_MS) { $env:LLM_TIMEOUT_MS } else { "60000" }
  $env:BRIDGE_OBSERVATION_TIMEOUT_MS = if ($env:BRIDGE_OBSERVATION_TIMEOUT_MS) { $env:BRIDGE_OBSERVATION_TIMEOUT_MS } else { "30000" }
  $env:BRIDGE_COMMAND_TIMEOUT_MS = if ($env:BRIDGE_COMMAND_TIMEOUT_MS) { $env:BRIDGE_COMMAND_TIMEOUT_MS } else { "30000" }

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

function Decode-Utf8Base64 {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Value
  )

  return [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($Value))
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
      $jsonBody = $Body | ConvertTo-Json -Depth 20 -Compress
      $utf8Body = [System.Text.Encoding]::UTF8.GetBytes($jsonBody)
      return Invoke-RestMethod -Method $Method -Uri $Uri -ContentType "application/json; charset=utf-8" -Body $utf8Body
    }
    catch {
      $detail = $_.ErrorDetails.Message
      if ($detail) {
        throw "Agent API request failed at $Uri. HTTP/API error details: $detail"
      }
      throw "Cannot connect to agent server at $Uri. Start the server with 'npm run win:start-all' or verify ORCHESTRATOR_BASE_URL=${env:ORCHESTRATOR_BASE_URL}. Original error: $($_.Exception.Message)"
    }
  }

  try {
    return Invoke-RestMethod -Method $Method -Uri $Uri
  }
  catch {
    $detail = $_.ErrorDetails.Message
    if ($detail) {
      throw "Agent API request failed at $Uri. HTTP/API error details: $detail"
    }
    throw "Cannot connect to agent server at $Uri. Start the server with 'npm run win:start-all' or verify ORCHESTRATOR_BASE_URL=${env:ORCHESTRATOR_BASE_URL}. Original error: $($_.Exception.Message)"
  }
}

function Get-AgentSessions {
  return @(Invoke-AgentApi -Method "GET" -Uri (Get-AgentUrl "/bridge/sessions"))
}

function Assert-AgentSessionForSystem {
  param(
    [Parameter(Mandatory = $true)]
    [string]$SystemId
  )

  $sessions = Get-AgentSessions
  $matched = @($sessions | Where-Object { $_.system_id -eq $SystemId -and $_.has_observation -eq $true -and $_.is_stale -ne $true })
  if ($matched.Count -eq 0) {
    throw "No active fresh extension session found for system '$SystemId'. Open the target page in Chrome with the extension enabled, wait a few seconds, then run 'npm run win:doctor'."
  }

  return $matched
}

function Format-AgentRunResult {
  param(
    [Parameter(Mandatory = $true)]
    $Result
  )

  if ($Result.ok -eq $true) {
    $output = [ordered]@{
      ok = $true
      final_response = $Result.final_response
      stock_result = $Result.final_result.stock_result
      goal_satisfied = $Result.final_result.goal_satisfied
      total_ms = $Result.timing.total_ms
      steps = @($Result.steps | ForEach-Object { $_.tool })
    }
    return ($output | ConvertTo-Json -Depth 10)
  }

  $output = [ordered]@{
    ok = $false
    error_stage = $Result.error_stage
    error_message = $Result.error_message
    total_ms = $Result.timing.total_ms
  }
  return ($output | ConvertTo-Json -Depth 10)
}

function Format-AgentSingleRunResult {
  param(
    [Parameter(Mandatory = $true)]
    $Result
  )

  if ($Result.ok -eq $true) {
    $output = [ordered]@{
      ok = $true
      tool = $Result.planner_output.next_action.tool
      summary = $Result.tool_result.output.summary
      stock_result = $Result.tool_result.output.stock_result
      goal_satisfied = $Result.tool_result.output.goal_satisfied
      total_ms = $Result.timing.total_ms
    }
    return ($output | ConvertTo-Json -Depth 10)
  }

  $output = [ordered]@{
    ok = $false
    error_stage = $Result.error_stage
    error_message = $Result.error_message
    total_ms = $Result.timing.total_ms
  }
  return ($output | ConvertTo-Json -Depth 10)
}

function Format-WebExtractResult {
  param(
    [Parameter(Mandatory = $true)]
    $Result
  )

  $output = [ordered]@{
    success = $Result.success
    summary = $Result.output.summary
    stock_result = $Result.output.stock_result
    goal_satisfied = $Result.output.goal_satisfied
  }
  return ($output | ConvertTo-Json -Depth 10)
}
