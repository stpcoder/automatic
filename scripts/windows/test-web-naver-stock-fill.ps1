param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

$queryText = Decode-Utf8Base64 "7ZWY7J2064uJ7IqkIOyjvOqwgA=="
$fieldValues = @{
  query = $queryText
}

$body = @{
  system_id = "naver_search"
  field_values = $fieldValues
}

Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/web/fill") -Body $body | ConvertTo-Json -Depth 20
