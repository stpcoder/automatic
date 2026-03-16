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
npm run win:setup
```

## 4. Start The Orchestrator

```powershell
npm run win:start
```

Health check:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/health
```

Start the Outlook reply poller in a second terminal:

```powershell
npm run win:poller
```

Or start both:

```powershell
npm run win:start-all
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
npm run win:sessions
```

## 7. Outlook COM Smoke Test

```powershell
$case = npm run win:create-shipment-case
npm run win:advance-case -- -CaseId CASE_ID_HERE
npm run win:advance-case -- -CaseId CASE_ID_HERE
```

Approve the pending mail:

```powershell
npm run win:approve-latest
npm run win:advance-case -- -CaseId CASE_ID_HERE
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
