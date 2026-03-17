param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

$body = @{
  system_id = "naver_stock"
  goal = "현재 페이지에서 하이닉스 현재 주가 알려줘"
  query = ""
}

$result = Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/web/extract") -Body $body
Format-WebExtractResult -Result $result
