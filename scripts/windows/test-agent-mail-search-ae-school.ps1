param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/agent/run") -Body @{
  instruction_base64 = "YWUgc2Nob29sIO2CpOybjOuTnOqwgCDrk6TslrTqsIQg66mU7J287J2EIOyhsO2ajO2VtOykmA=="
  context = @{
    keyword_base64 = "YWUgc2Nob29s"
    max_results = 10
  }
} | ConvertTo-Json -Depth 20
