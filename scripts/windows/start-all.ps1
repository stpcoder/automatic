param()

. (Join-Path $PSScriptRoot "common.ps1")
$repoRoot = Set-AgentEnvironment

$orchestratorScript = Join-Path $PSScriptRoot "start-orchestrator.ps1"
$pollerScript = Join-Path $PSScriptRoot "start-poller.ps1"

Start-Process powershell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-File", $orchestratorScript
Start-Sleep -Seconds 2
Start-Process powershell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-File", $pollerScript

Write-Host "Started orchestrator and poller in separate PowerShell windows."
Write-Host "Approval UI: $(Get-AgentUrl '/ui/approvals')"
try {
  $health = Invoke-AgentApi -Method "GET" -Uri (Get-AgentUrl "/health")
  Write-Host "Initial health check: ok"
} catch {
  Write-Host "Initial health check failed. Run 'npm run win:start' in the foreground and inspect the server window."
}
