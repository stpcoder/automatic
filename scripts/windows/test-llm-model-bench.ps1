param()

. (Join-Path $PSScriptRoot "common.ps1")
$repoRoot = Set-AgentEnvironment

$nodeCommand = if (Get-Command node.exe -ErrorAction SilentlyContinue) { "node.exe" } else { "node" }
$listScript = Join-Path $repoRoot "scripts\llm-list-models.mjs"
$benchScript = Join-Path $repoRoot "scripts\llm-bench-matrix.mjs"

$raw = & $nodeCommand $listScript --json true
if ($LASTEXITCODE -ne 0) {
  throw "Failed to load model list. $raw"
}

$parsed = $raw | ConvertFrom-Json
$models = @($parsed.models)
if ($models.Count -eq 0) {
  throw "No models returned from /models."
}

Write-Host "[llm] available models"
for ($index = 0; $index -lt $models.Count; $index++) {
  $model = $models[$index]
  $ownedBy = if ($model.owned_by) { " | $($model.owned_by)" } else { "" }
  Write-Host ("[{0}] {1}{2}" -f ($index + 1), $model.id, $ownedBy)
}

$selection = Read-Host "Select model numbers (comma separated, e.g. 1,3,5)"
if (-not $selection) {
  throw "No model selection provided."
}

$selectedNumbers = @(
  $selection.Split(",") |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ -match '^\d+$' } |
    ForEach-Object { [int]$_ } |
    Where-Object { $_ -ge 1 -and $_ -le $models.Count }
)

if ($selectedNumbers.Count -eq 0) {
  throw "No valid model numbers selected."
}

$selectedIds = @(
  $selectedNumbers |
    ForEach-Object { $models[$_ - 1].id } |
    Select-Object -Unique
)

$modelCsv = ($selectedIds -join ",")
Write-Host "[llm] benchmarking: $modelCsv"
& $nodeCommand $benchScript --models $modelCsv --sizes "2000,4000,6000,8000" --maxOutputTokens "64"

