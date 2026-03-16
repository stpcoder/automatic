param(
  [string[]]$To = @(),
  [string[]]$Cc = @(),
  [string]$TemplateId = "debug_template",
  [string]$VariablesJson = "{}"
)

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

$variables = ConvertFrom-AgentJson -Json $VariablesJson

Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/mail/draft") -Body @{
  template_id = $TemplateId
  to = @($To)
  cc = @($Cc)
  variables = $variables
} | ConvertTo-Json -Depth 20
