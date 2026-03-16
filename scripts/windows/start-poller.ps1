param()

. (Join-Path $PSScriptRoot "common.ps1")
$repoRoot = Set-AgentEnvironment

Set-Location $repoRoot
npm run outlook:poller
