param(
  [string]$Actor = "operator@example.com",
  [ValidateSet("approve", "reject", "request_revision")]
  [string]$Decision = "approve"
)

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

$approvals = Invoke-AgentApi -Method "GET" -Uri "$env:ORCHESTRATOR_BASE_URL/approvals"
$latest = @($approvals) | Where-Object { $_.status -eq "pending" } | Select-Object -First 1

if (-not $latest) {
  throw "No pending approvals found."
}

Invoke-AgentApi -Method "POST" -Uri "$env:ORCHESTRATOR_BASE_URL/approvals/$($latest.approval_id)/decision" -Body @{
  decision = $Decision
  actor = $Actor
} | ConvertTo-Json -Depth 20
