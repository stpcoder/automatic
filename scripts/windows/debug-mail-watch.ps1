param(
  [string]$CaseId = "DEBUG-CASE",
  [Parameter(Mandatory = $true)]
  [string]$ConversationId,
  [string[]]$ExpectedFrom = @(),
  [string[]]$RequiredFields = @(),
  [string[]]$KeywordContains = @()
)

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/mail/watch") -Body @{
  case_id = $CaseId
  conversation_id = $ConversationId
  expected_from = @($ExpectedFrom)
  required_fields = @($RequiredFields)
  keyword_contains = @($KeywordContains)
} | ConvertTo-Json -Depth 20
