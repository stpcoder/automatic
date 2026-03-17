param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

$goalTextBase64 = "7ZiE7J6sIO2OmOydtOyngOyXkOyEnCDtlZjsnbTri4nsiqQg7ZiE7J6sIOyjvOqwgCDslYzroKTspJg="
$body = @{
  system_id = "naver_stock"
  goal_base64 = $goalTextBase64
  query = ""
}

$result = Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/web/extract") -Body $body
Format-WebExtractResult -Result $result
