param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

$goalText = Decode-Utf8Base64 "7ZiE7J6sIO2OmOydtOyngOyXkOyEnCDtlZjsnbTri4nsiqQg7ZiE7J6sIOyjvOqwgCDslYzroKTspJg="
$body = @{
  system_id = "naver_stock"
  goal = $goalText
  query = ""
}

$result = Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/web/extract") -Body $body
Format-WebExtractResult -Result $result
