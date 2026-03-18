param()

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

$instructionBase64 = "T3V0bG9vayDsobDsp4Eg7Jew65297LKY7JeQ7IScIOygnO2DnO2YuOulvCDssL7slYQg6rWQ7JyhIOydvOyglSDtmZXsnbgg7JqU7LKtIOuplOydvOydhCDsoIHsoIjtlZwg7KCc66qp6rO8IOuzuOusuOycvOuhnCDsnpHshLHtlZjqs6AsIOyKueyduOuQnCDqsoPsnLzroZwg67O06rOgIOuwnOyGoe2VnCDrkqQg7ZqM7Iug7J20IOyYpOuptCDri6Tsi5wg7LKY66as7ZWgIOyImCDsnojrj4TroZ0g64yA6riwIOyEpOygleq5jOyngCDtlbTspJg="

$context = @{
  approved_to_send = $true
}

Write-Host "[skh-agent] running mail scenario: draft -> send -> watch..."
$result = Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/agent/run-loop") -Body @{
  instruction_base64 = $instructionBase64
  context = $context
}

Format-AgentRunResult -Result $result
