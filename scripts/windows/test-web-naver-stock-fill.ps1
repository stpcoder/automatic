param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

$fieldValues = @{
  query = "하이닉스 주가"
}

$body = @{
  system_id = "naver_search"
  field_values = $fieldValues
}

Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/web/fill") -Body $body | ConvertTo-Json -Depth 20
