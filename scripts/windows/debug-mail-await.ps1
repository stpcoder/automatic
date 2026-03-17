param(
  [string]$CaseId = "DEBUG-CASE",
  [string]$ConversationId = "",
  [string[]]$ExpectedFrom = @(),
  [string[]]$RequiredFields = @(),
  [string[]]$KeywordContains = @(),
  [int]$TimeoutSeconds = 1800,
  [int]$PollIntervalMs = 10000
)

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/mail/await") -Body @{
  case_id = $CaseId
  conversation_id = $ConversationId
  expected_from = @($ExpectedFrom)
  required_fields = @($RequiredFields)
  keyword_contains = @($KeywordContains)
  timeout_seconds = $TimeoutSeconds
  poll_interval_ms = $PollIntervalMs
} | ConvertTo-Json -Depth 20
