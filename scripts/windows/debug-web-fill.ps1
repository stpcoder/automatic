param(
  [string]$SystemId = "security_portal",
  [string]$FieldsJson = "{}",
  [string]$FieldsFile = ""
)

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

$fieldValues = @{}
if ($FieldsFile) {
  $fieldValues = ConvertFrom-AgentJson -Json (Get-Content -Path $FieldsFile -Raw)
}
elseif ($FieldsJson) {
  $fieldValues = ConvertFrom-AgentJson -Json $FieldsJson
}

Invoke-AgentApi -Method "POST" -Uri (Get-AgentUrl "/debug/web/fill") -Body @{
  system_id = $SystemId
  field_values = $fieldValues
} | ConvertTo-Json -Depth 20
