param(
  [string]$WatchDirectory = ""
)

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

$body = @{}
if ($WatchDirectory) {
  $body.watch_directory = $WatchDirectory
}

Invoke-AgentApi -Method "POST" -Uri "$env:ORCHESTRATOR_BASE_URL/debug/mail/poll-once" -Body $body | ConvertTo-Json -Depth 20
