param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

Write-Host "[skh-agent] running generic direct stock extraction loop..."

$instructionTextBase64 = "7ZiE7J6sIO2OmOydtOyngOyXkOyEnCDtlZjsnbTri4nsiqQg7ZiE7J6sIOyjvOqwgCDslYzroKTspJg="
$context = @{
  target_url = "https://finance.naver.com/item/main.naver?code=000660"
  url_contains = "finance.naver.com/item/main.naver"
  open_if_missing = $true
}
$body = @{
  instruction_base64 = $instructionTextBase64
  context = $context
  max_steps = 4
}

$result = Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/agent/run-loop") -Body $body
Format-AgentRunResult -Result $result
