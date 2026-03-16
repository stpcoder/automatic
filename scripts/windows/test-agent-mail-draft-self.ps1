param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/agent/run") -Body @{
  instruction = "taeho.je@sk.com 으로 통관번호 요청 메일 초안을 작성해줘"
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
