param()

. (Join-Path $PSScriptRoot "common.ps1")
$repoRoot = Set-AgentEnvironment

$nodeCommand = if (Get-Command node.exe -ErrorAction SilentlyContinue) { "node.exe" } else { "node" }
& $nodeCommand (Join-Path $repoRoot "scripts\llm-list-models.mjs")

