param(
  [string]$SystemId = "security_portal",
  [string]$FieldsJson = "{}",
  [string]$FieldsFile = ""
)

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

$fieldValues = @{}
if ($FieldsFile) {
  $fieldValues = Get-Content -Path $FieldsFile -Raw | ConvertFrom-Json -AsHashtable
}
elseif ($FieldsJson) {
  $fieldValues = $FieldsJson | ConvertFrom-Json -AsHashtable
}

Invoke-AgentApi -Method "POST" -Uri "$env:ORCHESTRATOR_BASE_URL/debug/web/fill" -Body @{
  system_id = $SystemId
  field_values = $fieldValues
} | ConvertTo-Json -Depth 20
