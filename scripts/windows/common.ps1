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

function Invoke-AgentApi {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Method,
    [Parameter(Mandatory = $true)]
    [string]$Uri,
    [object]$Body
  )

  if ($null -ne $Body) {
    return Invoke-RestMethod -Method $Method -Uri $Uri -ContentType "application/json" -Body ($Body | ConvertTo-Json -Depth 20)
  }

  return Invoke-RestMethod -Method $Method -Uri $Uri
}
