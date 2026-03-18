function Set-AgentEnvironment {
  param(
    [string]$RepoRoot
  )

  if (-not $RepoRoot) {
    $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
  }

  try {
    [Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
  }
  catch {
  }

  try {
    & chcp.com 65001 | Out-Null
  }
  catch {
  }

  $env:ORCHESTRATOR_PORT = if ($env:ORCHESTRATOR_PORT) { $env:ORCHESTRATOR_PORT } else { "43117" }
  $env:WEB_WORKER_ADAPTER = if ($env:WEB_WORKER_ADAPTER) { $env:WEB_WORKER_ADAPTER } else { "extension_bridge" }
  $env:OUTLOOK_WORKER_ADAPTER = if ($env:OUTLOOK_WORKER_ADAPTER) { $env:OUTLOOK_WORKER_ADAPTER } else { "outlook_com" }
  $env:CUBE_WORKER_ADAPTER = if ($env:CUBE_WORKER_ADAPTER) { $env:CUBE_WORKER_ADAPTER } else { "extension_bridge" }
  $env:ORCHESTRATOR_STORE = if ($env:ORCHESTRATOR_STORE) { $env:ORCHESTRATOR_STORE } else { "sqlite" }
  $env:ORCHESTRATOR_DB_PATH = if ($env:ORCHESTRATOR_DB_PATH) { $env:ORCHESTRATOR_DB_PATH } else { Join-Path $RepoRoot "data\orchestrator.sqlite" }
  $env:ORCHESTRATOR_BASE_URL = if ($env:ORCHESTRATOR_BASE_URL) { $env:ORCHESTRATOR_BASE_URL } else { "http://127.0.0.1:$($env:ORCHESTRATOR_PORT)" }
  $env:LLM_TIMEOUT_MS = if ($env:LLM_TIMEOUT_MS) { $env:LLM_TIMEOUT_MS } else { "90000" }
  $env:LLM_JSON_REPAIR_TIMEOUT_MS = if ($env:LLM_JSON_REPAIR_TIMEOUT_MS) { $env:LLM_JSON_REPAIR_TIMEOUT_MS } else { "45000" }
  $env:BRIDGE_OBSERVATION_TIMEOUT_MS = if ($env:BRIDGE_OBSERVATION_TIMEOUT_MS) { $env:BRIDGE_OBSERVATION_TIMEOUT_MS } else { "30000" }
  $env:BRIDGE_COMMAND_TIMEOUT_MS = if ($env:BRIDGE_COMMAND_TIMEOUT_MS) { $env:BRIDGE_COMMAND_TIMEOUT_MS } else { "30000" }
  $env:OUTLOOK_WAIT_TIMEOUT_SECONDS = if ($env:OUTLOOK_WAIT_TIMEOUT_SECONDS) { $env:OUTLOOK_WAIT_TIMEOUT_SECONDS } else { "86400" }
  $env:OUTLOOK_WAIT_POLL_INTERVAL_MS = if ($env:OUTLOOK_WAIT_POLL_INTERVAL_MS) { $env:OUTLOOK_WAIT_POLL_INTERVAL_MS } else { "10000" }
  $env:AGENT_API_TIMEOUT_SECONDS = if ($env:AGENT_API_TIMEOUT_SECONDS) { $env:AGENT_API_TIMEOUT_SECONDS } else { "1800" }

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

function Encode-Utf8Base64 {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Value
  )

  return [System.Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($Value))
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

  $timeoutSeconds = 1800
  try {
    $timeoutSeconds = [int]$env:AGENT_API_TIMEOUT_SECONDS
  }
  catch {
    $timeoutSeconds = 1800
  }

  if ($null -ne $Body) {
    try {
      $jsonBody = $Body | ConvertTo-Json -Depth 20 -Compress
      $utf8Body = [System.Text.Encoding]::UTF8.GetBytes($jsonBody)
      return Invoke-RestMethod -Method $Method -Uri $Uri -ContentType "application/json; charset=utf-8" -TimeoutSec $timeoutSeconds -Body $utf8Body
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
    return Invoke-RestMethod -Method $Method -Uri $Uri -TimeoutSec $timeoutSeconds
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
    $summary = if ($Result.final_response) { [string]$Result.final_response } else { "Task completed." }
    $steps = @($Result.steps | ForEach-Object { $_.tool })
    $stepLine = if ($steps.Count -gt 0) { "tools: $($steps -join ' -> ')" } else { $null }
    $timeLine = if ($Result.timing.total_ms -ne $null) { "time: $($Result.timing.total_ms)ms" } else { $null }
    return @("[DONE] $summary", $stepLine, $timeLine | Where-Object { $_ }) -join [Environment]::NewLine
  }

  $timeLine = if ($Result.timing.total_ms -ne $null) { "time: $($Result.timing.total_ms)ms" } else { $null }
  $codeLine = if ($Result.error_code) { "code: $($Result.error_code)" } else { $null }
  return @("[FAIL] $($Result.error_stage)", $codeLine, $Result.error_message, $timeLine | Where-Object { $_ }) -join [Environment]::NewLine
}

function Format-AgentSingleRunResult {
  param(
    [Parameter(Mandatory = $true)]
    $Result
  )

  if ($Result.ok -eq $true) {
    $tool = [string]$Result.planner_output.next_action.tool
    $summary = if ($Result.tool_result.output.summary) { [string]$Result.tool_result.output.summary } else { "OK" }
    $timeLine = if ($Result.timing.total_ms -ne $null) { "time: $($Result.timing.total_ms)ms" } else { $null }
    return @("[OK] $tool", $summary, $timeLine | Where-Object { $_ }) -join [Environment]::NewLine
  }

  $timeLine = if ($Result.timing.total_ms -ne $null) { "time: $($Result.timing.total_ms)ms" } else { $null }
  $codeLine = if ($Result.error_code) { "code: $($Result.error_code)" } else { $null }
  return @("[FAIL] $($Result.error_stage)", $codeLine, $Result.error_message, $timeLine | Where-Object { $_ }) -join [Environment]::NewLine
}

function Format-WebReadResult {
  param(
    [Parameter(Mandatory = $true)]
    $Result
  )

  $output = [ordered]@{
    success = $Result.success
    summary = $Result.output.summary
    title = $Result.output.title
    url = $Result.output.url
    artifact_kind = $Result.output.artifact_kind
  }
  return ($output | ConvertTo-Json -Depth 10)
}

function Get-AgentRunDraftId {
  param(
    [Parameter(Mandatory = $true)]
    $Result
  )

  if ($null -ne $Result.final_result -and $Result.final_result.draft_id) {
    return [string]$Result.final_result.draft_id
  }

  $steps = @($Result.steps)
  for ($index = $steps.Count - 1; $index -ge 0; $index--) {
    $step = $steps[$index]
    if ($null -ne $step.tool_result -and $null -ne $step.tool_result.output -and $step.tool_result.output.draft_id) {
      return [string]$step.tool_result.output.draft_id
    }
  }

  return $null
}

function Convert-HtmlToPreviewText {
  param(
    [string]$Html
  )

  if ([string]::IsNullOrWhiteSpace($Html)) {
    return ""
  }

  $text = $Html -replace '<br\s*/?>', "`n"
  $text = $text -replace '<[^>]+>', ' '
  $text = [System.Net.WebUtility]::HtmlDecode($text)
  $text = $text -replace '[ \t]+\r?\n', "`n"
  $text = $text -replace '\r?\n\s+', "`n"
  $text = $text -replace '\n{3,}', "`n`n"
  return $text.Trim()
}

function Show-DraftPreview {
  param(
    [Parameter(Mandatory = $true)]
    [string]$DraftId
  )

  $previewResult = Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/mail/preview-draft") -Body @{
    draft_id = $DraftId
  }
  if ($previewResult.success -ne $true) {
    $message = if ($previewResult.output.error) { [string]$previewResult.output.error } else { "Draft preview failed." }
    throw $message
  }

  $preview = if ($previewResult.output) { $previewResult.output } else { $previewResult }

  $bodyPreview = Convert-HtmlToPreviewText -Html ([string]$preview.body_html)
  Write-Host ""
  Write-Host "----- Draft Preview -----"
  Write-Host "Subject: $($preview.subject)"
  Write-Host "To:      $((@($preview.to) -join '; '))"
  if (@($preview.cc).Count -gt 0) {
    Write-Host "Cc:      $((@($preview.cc) -join '; '))"
  }
  Write-Host ""
  if ($bodyPreview) {
    Write-Host $bodyPreview
  }
  Write-Host "-------------------------"
  Write-Host ""

  return $preview
}

function Confirm-AndMaybeSendDraft {
  param(
    [Parameter(Mandatory = $true)]
    $RunResult
  )

  $draftId = Get-AgentRunDraftId -Result $RunResult
  if ([string]::IsNullOrWhiteSpace($draftId)) {
    return $null
  }

  Show-DraftPreview -DraftId $draftId | Out-Null
  $answer = Read-Host "Send this draft now? [y/N]"
  if ($answer -notmatch '^(?i:y|yes)$') {
    Write-Host "[skh-agent] send cancelled."
    return @{
      sent = $false
      draft_id = $draftId
    }
  }

  try {
    $sendResult = Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/mail/send") -Body @{
      draft_id = $draftId
    }
  } catch {
    $message = $_.Exception.Message
    Write-Host "[skh-agent] send failed: $message"
    return @{
      sent = $false
      draft_id = $draftId
      error = $message
    }
  }
  if ($sendResult.success -ne $true) {
    $message = if ($sendResult.output.error) { [string]$sendResult.output.error } else { "Draft send failed." }
    Write-Host "[skh-agent] send failed: $message"
    return @{
      sent = $false
      draft_id = $draftId
      error = $message
      result = $sendResult
    }
  }

  $sendOutput = if ($sendResult.output) { $sendResult.output } else { $sendResult }
  $recipients = @($sendOutput.recipients) | Where-Object { $_ -and $_.ToString().Trim().Length -gt 0 }
  $recipientText = if ($recipients.Count -gt 0) { $recipients -join "; " } else { "(unknown recipients)" }
  Write-Host "[skh-agent] draft sent to $recipientText"
  return @{
    sent = $true
    draft_id = $draftId
    result = $sendOutput
  }
}
