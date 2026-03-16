param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

$result = Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/agent/run-loop") -Body @{
  instruction = "Read SK hynix stock result from the current Naver stock page"
  context = @{
    system_id = "naver_stock"
  }
  max_steps = 4
}

Format-AgentRunResult -Result $result
