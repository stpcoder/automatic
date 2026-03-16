param(
  [string]$CaseId = "DEBUG-CASE",
  [Parameter(Mandatory = $true)]
  [string]$ConversationId,
  [string[]]$ExpectedFrom = @(),
  [string[]]$RequiredFields = @()
)

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

Invoke-AgentApi -Method "POST" -Uri "$env:ORCHESTRATOR_BASE_URL/debug/mail/watch" -Body @{
  case_id = $CaseId
  conversation_id = $ConversationId
  expected_from = @($ExpectedFrom)
  required_fields = @($RequiredFields)
} | ConvertTo-Json -Depth 20
