param()

. (Join-Path $PSScriptRoot "common.ps1")
$repoRoot = Set-AgentEnvironment

Set-Location $repoRoot
npm install
npm run check
npm test
