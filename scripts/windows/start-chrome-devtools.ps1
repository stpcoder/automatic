param(
  [int]$Port = 9222
)

. (Join-Path $PSScriptRoot "common.ps1")
$repoRoot = Set-AgentEnvironment

$chromeCandidates = @(
  "C:\Program Files\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
  "C:\Program Files\Microsoft\Edge\Application\msedge.exe",
  "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
)

$browserPath = $chromeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $browserPath) {
  throw "Chrome or Edge executable not found."
}

$userDataDir = Join-Path $repoRoot ".chrome-devtools-profile"
if (-not (Test-Path $userDataDir)) {
  New-Item -ItemType Directory -Path $userDataDir | Out-Null
}

Start-Process -FilePath $browserPath -ArgumentList @(
  "--remote-debugging-port=$Port",
  "--user-data-dir=$userDataDir"
)

Write-Host "Started browser in DevTools mode."
Write-Host "Executable: $browserPath"
Write-Host "CDP URL: http://127.0.0.1:$Port"
