param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

$instructionBase64 = "7J2066mU7J28IOyjvOyGjOulvCDsp4HsoJEg7JOw7KeAIOunkOqzoCBPdXRsb29rIOyhsOyngSDsl7Drnb3sspjsl5DshJwg7KCc7YOc7Zi466W8IOywvuyVhCDqtZDsnKEg7J287KCVIO2ZleyduCDsmpTssq0g66mU7J287J2EIOyekeyEse2VmOqzoCwg7Iq57J2465CcIOqyg+ycvOuhnCDrs7Tqs6Ag67Cc7Iah7ZWcIOuSpCDtmozsi6DsnbQg7Jik66m0IOuLpOyLnCDsspjrpqztlaAg7IiYIOyeiOuPhOuhnSDrjIDquLAg7ISk7KCV6rmM7KeAIO2VtOykmA=="

$context = @{
  approved_to_send = $true
}

Write-Host "[skh-agent] running mail scenario: draft -> send -> watch..."
$result = Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/agent/run-loop") -Body @{
  instruction_base64 = $instructionBase64
  context = $context
}

Format-AgentRunResult -Result $result
