param()

. (Join-Path $PSScriptRoot "common.ps1")
$repoRoot = Set-AgentEnvironment

Set-Location $repoRoot
Invoke-AgentNpm -Arguments @("run", "dev")
