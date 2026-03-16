param()

. (Join-Path $PSScriptRoot "common.ps1")
$repoRoot = Set-AgentEnvironment

Set-Location $repoRoot
Invoke-AgentNpm -Arguments @("install")
Invoke-AgentNpm -Arguments @("run", "check")
Invoke-AgentNpm -Arguments @("test")
