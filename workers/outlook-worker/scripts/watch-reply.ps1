param(
  [Parameter(Mandatory = $true)]
  [string]$PayloadJson
)

$payload = $PayloadJson | ConvertFrom-Json -AsHashtable
$baseDir = Join-Path $env:APPDATA "skh-agent"
$watchDir = Join-Path $baseDir "outlook-watches"
New-Item -ItemType Directory -Path $watchDir -Force | Out-Null

$watchId = "watch-" + [guid]::NewGuid().ToString()
$watchFile = Join-Path $watchDir "$watchId.json"

@{
  case_id = [string]$payload.case_id
  conversation_id = [string]$payload.conversation_id
  expected_from = @($payload.expected_from)
  required_fields = @($payload.required_fields)
  processed_entry_ids = @()
  completed = $false
  created_at = (Get-Date).ToString("o")
} | ConvertTo-Json -Depth 10 | Set-Content -Path $watchFile -Encoding UTF8

@{
  watcher = "email"
  expectation_registered = $true
  conversation_id = [string]$payload.conversation_id
  watch_file = $watchFile
} | ConvertTo-Json -Depth 10 -Compress
