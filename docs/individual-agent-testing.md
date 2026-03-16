# Individual Agent Testing

## 1. What The Bookmarklet Is

The bookmarklet is a normal Chrome bookmark whose URL starts with `javascript:`.

When you click it on a real web page:

1. it registers a browser session with the local orchestrator
2. it sends the current DOM observation every second
3. it polls for pending commands
4. it applies fill or submit commands on the page

It does not need Chrome devtools mode or an extension.

## 2. Why `win:sessions` Can Be Empty

If `npm run win:sessions` returns `[]`, one of these is true:

1. the server is not running on `43117`
2. the bookmarklet was not installed as a real bookmark
3. the bookmarklet was clicked on the wrong page
4. the page is a protected page like `chrome://` or a blank new tab
5. the bookmark URL does not start with `javascript:`

## 3. Start The Local Test Environment

```powershell
npm run win:start-all
npm run win:health
npm run win:debug:overview
```

## 4. Install And Verify A Bookmarklet

```powershell
npm run win:bookmarklets
```

Use the printed value like this:

1. open the target site in normal Chrome
2. log in first
3. create a bookmark on the bookmarks bar
4. right click the bookmark and choose edit
5. paste the full `javascript:...` value into the URL field
6. click the bookmark while the target page is open

Verify:

```powershell
npm run win:sessions
```

You should see a session for `security_portal`, `dhl`, or `cube`.

## 5. Web Agent Standalone Tests

Open and observe the attached page:

```powershell
npm run win:debug:web:open -- -SystemId security_portal
```

Fill fields from inline JSON:

```powershell
npm run win:debug:web:fill -- -SystemId security_portal -FieldsJson '{"traveler_name":"Kim","destination_country":"Germany","customs_number":"GB-8839-22"}'
```

Or fill from a file:

```powershell
npm run win:debug:web:fill -- -SystemId security_portal -FieldsFile .\security-fields.json
```

Preview:

```powershell
npm run win:debug:web:preview -- -SystemId security_portal
```

Submit:

```powershell
npm run win:debug:web:submit -- -SystemId security_portal -ExpectedButton 등록
```

Recommended first file for testing:

```json
{
  "traveler_name": "Kim",
  "destination_country": "Germany",
  "customs_number": "GB-8839-22",
  "receiver_address": "Berlin Office"
}
```

## 6. Email Agent Standalone Tests

Prerequisite:

1. Classic Outlook must be open
2. the mailbox must already be logged in

Create a draft:

```powershell
npm run win:debug:mail:draft -- -To vendor@example.com -TemplateId request_customs_number -VariablesJson '{"traveler_name":"Kim","destination_country":"Germany"}'
```

The response returns `output.draft_id`.

Send the draft:

```powershell
npm run win:debug:mail:send -- -DraftId DRAFT_ID_HERE
```

The response returns `output.conversation_id`.

Register a reply watch:

```powershell
npm run win:debug:mail:watch -- -ConversationId CONVERSATION_ID_HERE -ExpectedFrom vendor@example.com -RequiredFields customs_number
```

Run one poll iteration manually:

```powershell
npm run win:debug:mail:poll-once
```

## 7. Recommended Order

1. `npm run win:start-all`
2. `npm run win:bookmarklets`
3. attach `security_portal` and confirm `npm run win:sessions`
4. `npm run win:debug:web:open`
5. `npm run win:debug:web:fill`
6. `npm run win:debug:web:preview`
7. `npm run win:debug:mail:draft`
8. `npm run win:debug:mail:send`
9. `npm run win:debug:mail:watch`
10. `npm run win:debug:mail:poll-once`
