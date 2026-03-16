param(
  [string[]]$To = @(),
  [string[]]$Cc = @(),
  [string]$TemplateId = "debug_template",
  [string]$VariablesJson = "{}"
)

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

$variables = $VariablesJson | ConvertFrom-Json -AsHashtable

Invoke-AgentApi -Method "POST" -Uri "$env:ORCHESTRATOR_BASE_URL/debug/mail/draft" -Body @{
  template_id = $TemplateId
  to = @($To)
  cc = @($Cc)
  variables = $variables
} | ConvertTo-Json -Depth 20
