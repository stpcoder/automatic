param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

$instruction = "taeho.je@sk.com에게 교육 일정 확인 요청 메일을 작성하고, 승인된 것으로 보고 발송한 뒤 회신이 오면 다시 처리할 수 있도록 대기 설정까지 해줘"
$instructionBase64 = Encode-Utf8Base64 -Value $instruction

$context = @{
  approved_to_send = $true
}

Write-Host "[skh-agent] running mail scenario: draft -> send -> watch..."
$result = Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/agent/run-loop") -Body @{
  instruction_base64 = $instructionBase64
  context = $context
}

Format-AgentRunResult -Result $result
