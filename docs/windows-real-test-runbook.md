# Windows Real Test Runbook

## 1. Goal

Validate the real execution paths:

- `bookmarklet_bridge` for normal Chrome
- `outlook_com` for Classic Outlook
- `cube` through the same bookmarklet bridge

## 2. Prerequisites

- Windows 10 or 11
- Node.js 22+
- Git
- Classic Outlook installed and logged in
- Normal Chrome installed
- Access to the target internal websites

## 3. Pull And Install

```powershell
git clone https://github.com/stpcoder/automatic.git
cd automatic
git checkout main
git pull origin main
npm install
npm run check
npm test
```

## 4. Start The Orchestrator

```powershell
$env:WEB_WORKER_ADAPTER="bookmarklet_bridge"
$env:OUTLOOK_WORKER_ADAPTER="outlook_com"
$env:CUBE_WORKER_ADAPTER="bookmarklet_bridge"
$env:ORCHESTRATOR_STORE="sqlite"
$env:ORCHESTRATOR_DB_PATH="$PWD\\data\\orchestrator.sqlite"
npm run dev
```

Health check:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/health
```

Start the Outlook reply poller in a second terminal:

```powershell
$env:ORCHESTRATOR_BASE_URL="http://127.0.0.1:3000"
npm run outlook:poller
```

## 5. Install Bookmarklets

Open:

- `http://127.0.0.1:3000/bridge/bookmarklet?systemId=security_portal`
- `http://127.0.0.1:3000/bridge/bookmarklet?systemId=dhl`
- `http://127.0.0.1:3000/bridge/bookmarklet?systemId=cube`

For each response:

1. copy the `bookmarklet` value
2. create a normal Chrome bookmark
3. paste the value into the bookmark URL
4. name it clearly

## 6. Attach Real Browser Pages

For each target system:

1. open the real page in normal Chrome
2. log in normally
3. click the matching bookmarklet
4. verify sessions:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/bridge/sessions
```

## 7. Outlook COM Smoke Test

```powershell
$case = Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:3000/cases `
  -ContentType "application/json" `
  -Body (@{
    workflow_id = "overseas_equipment_shipment"
    facts = @{
      case_id = "CASE-WIN-001"
      traveler_name = "Kim"
      destination_country = "Germany"
      equipment_list = @(@{ serial_number = "SN123"; asset_tag = "AT-001" })
      vendor_email = "vendor@example.com"
      due_date = "2026-03-20"
      receiver_address = "Berlin Office"
    }
  } | ConvertTo-Json -Depth 10)

Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:3000/cases/$($case.case_id)/advance"
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:3000/cases/$($case.case_id)/advance"
```

Approve the pending mail:

```powershell
$approvals = Invoke-RestMethod http://127.0.0.1:3000/approvals
$approvalId = $approvals[0].approval_id

Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:3000/approvals/$approvalId/decision" `
  -ContentType "application/json" `
  -Body (@{
    decision = "approve"
    actor = "tester@example.com"
  } | ConvertTo-Json)

Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:3000/cases/$($case.case_id)/advance"
```

## 8. Resume After Real Reply

Current watch files are written to:

- `%APPDATA%\\skh-agent\\outlook-watches`

With `npm run outlook:poller` running, a matching reply should be auto-posted into the orchestrator.

Manual fallback:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:3000/cases/$($case.case_id)/events/email" `
  -ContentType "application/json" `
  -Body (@{
    sender = "vendor@example.com"
    subject = "Re: customs number"
    conversation_id = "REAL-CONVERSATION-ID"
    extracted_fields = @{
      customs_number = "GB-8839-22"
    }
  } | ConvertTo-Json -Depth 10)
```

## 9. Real Web Smoke Test

```powershell
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:3000/cases/$($case.case_id)/advance"
Invoke-RestMethod "http://127.0.0.1:3000/cases/$($case.case_id)"
```

Expected behavior:

- the attached `security_portal` page receives fill commands
- the normal Chrome page is updated
- final submit still waits for approval

## 10. Remaining Gap

- Cube inbound reply polling is not yet auto-posting into the orchestrator
- site-specific field mapping still needs validation on the real internal pages
