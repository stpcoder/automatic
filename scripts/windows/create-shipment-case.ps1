param(
  [string]$TravelerName = "Kim",
  [string]$DestinationCountry = "Germany",
  [string]$VendorEmail = "vendor@example.com",
  [string]$DueDate = "2026-03-20",
  [string]$ReceiverAddress = "Berlin Office"
)

. (Join-Path $PSScriptRoot "common.ps1")
Set-AgentEnvironment | Out-Null

$body = @{
  workflow_id = "overseas_equipment_shipment"
  facts = @{
    case_id = "CASE-" + [guid]::NewGuid().ToString().Substring(0, 8).ToUpper()
    traveler_name = $TravelerName
    destination_country = $DestinationCountry
    equipment_list = @(@{
      serial_number = "SN123"
      asset_tag = "AT-001"
    })
    vendor_email = $VendorEmail
    due_date = $DueDate
    receiver_address = $ReceiverAddress
  }
}

Invoke-AgentApi -Method "POST" -Uri "$env:ORCHESTRATOR_BASE_URL/cases" -Body $body | ConvertTo-Json -Depth 20
