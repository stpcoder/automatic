param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

$instruction = "Outlook에서 ae school 교육일정 관련 이메일을 찾아 내용을 정리하고, 이메일 주소를 직접 쓰지 말고 Outlook 조직 연락처에서 Taeho Je를 찾아 그 수신자에게 보낼 메일 초안을 만든 뒤, 보내지 말고 나에게 확인 요청해줘"
$instructionBase64 = Encode-Utf8Base64 -Value $instruction

$context = @{
  keyword = "ae school 교육일정"
  approved_to_send = $false
}

Write-Host "[skh-agent] running mail scenario: search -> summarize -> draft -> approval..."
$result = Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/agent/run-loop") -Body @{
  instruction_base64 = $instructionBase64
  context = $context
}

Format-AgentRunResult -Result $result
