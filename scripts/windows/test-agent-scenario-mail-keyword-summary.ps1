param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

$instruction = "Outlook에서 ae school 관련 이메일을 찾아 가장 관련 높은 메일을 읽고 핵심 내용을 요약해줘"
$instructionBase64 = Encode-Utf8Base64 -Value $instruction

$context = @{
  keyword = "ae school"
}

Write-Host "[skh-agent] running mail scenario: search -> read -> summarize..."
$result = Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/agent/run-loop") -Body @{
  instruction_base64 = $instructionBase64
  context = $context
}

Format-AgentRunResult -Result $result
