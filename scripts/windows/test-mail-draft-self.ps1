param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/mail/draft") -Body @{
  template_id = "request_customs_number"
  to = @("taeho.je@sk.com")
  cc = @()
  variables = @{
    traveler_name = "Kim"
    destination_country = "Germany"
    note = "self-test draft only"
  }
} | ConvertTo-Json -Depth 20
