# Windows Real Test Runbook

## 1. Goal

Validate the real execution paths:

- `live_chrome` for Chrome DevTools/CDP
- `outlook_com` for Classic Outlook
- `cube` through the shared bridge path when needed

## 2. Prerequisites

- Windows 10 or 11
- Node.js 22+
- Git
- Classic Outlook installed and logged in
- Normal Chrome installed
- Chrome or Edge launchable with remote debugging
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

First start Chrome in DevTools mode:

```powershell
npm run win:chrome:start
```

```powershell
npm run win:start
```

Health check:

```powershell
Invoke-RestMethod http://127.0.0.1:43117/health
```

Start the Outlook reply poller in a second terminal:

```powershell
npm run win:poller
```

Or start both:

```powershell
npm run win:start-all
```

## 5. Verify DevTools Connection

```powershell
npm run win:doctor
```

Expected:

- `WEB_WORKER_ADAPTER: live_chrome`
- `Chrome DevTools: ok`

## 6. Open Real Browser Pages

For each target system:

1. open the real page in normal Chrome
2. log in normally
3. keep the page open in the DevTools browser profile
4. verify sessions if using bridge-based pages:

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
  -Uri "http://127.0.0.1:43117/cases/$($case.case_id)/events/email" `
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
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:43117/cases/$($case.case_id)/advance"
Invoke-RestMethod "http://127.0.0.1:43117/cases/$($case.case_id)"
```

Expected behavior with `live_chrome`:

- the DevTools-connected Chrome page receives fill/click commands
- the connected browser page is updated
- final submit still waits for approval

## 10. Remaining Gap

- Cube inbound reply polling is not yet auto-posting into the orchestrator
- site-specific field mapping still needs validation on the real internal pages
- Chrome extension bridge is available for page-navigation-heavy cases when CDP is not suitable
