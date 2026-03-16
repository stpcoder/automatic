param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

$result = Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/web/extract") -Body @{
  system_id = "naver_stock"
  goal = "Read SK hynix stock result from the current Naver stock page"
  query = ""
}

Format-WebExtractResult -Result $result
