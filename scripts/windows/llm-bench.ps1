param(
  [string]$Model = "",
  [string]$Sizes = "500,1000,2000,4000,8000",
  [string]$Prompt = "Return one short sentence saying the benchmark request was received. Do not explain anything else.",
  [int]$MaxOutputTokens = 64
)

. (Join-Path $PSScriptRoot "common.ps1")
$repoRoot = Set-AgentEnvironment

$nodeCommand = if (Get-Command node.exe -ErrorAction SilentlyContinue) { "node.exe" } else { "node" }
$args = @((Join-Path $repoRoot "scripts\llm-bench.mjs"), "--sizes", $Sizes, "--prompt", $Prompt, "--maxOutputTokens", "$MaxOutputTokens")
if ($Model) {
  $args += @("--model", $Model)
}
& $nodeCommand @args

