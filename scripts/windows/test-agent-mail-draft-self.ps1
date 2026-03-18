param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/agent/run") -Body @{
  instruction_base64 = "dGFlaG8uamVAc2suY29tIOycvOuhnCDthrXqtIDrsojtmLgg7JqU7LKtIOuplOydvCDstIjslYjsnYQg7J6R7ISx7ZW07KSY"
  context = @{
    template_id = "request_customs_number"
    to = @("taeho.je@sk.com")
    variables = @{
      traveler_name = "Kim"
      destination_country = "Germany"
      note = "self-test draft only"
    }
  }
} | ConvertTo-Json -Depth 20
