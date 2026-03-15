# Web Operation Spec

## 1. Operating Model

The web worker uses a `Page Agent` style DOM harness and supports three adapters:

- `bookmarklet_bridge`
  - works with normal Chrome bookmarks
  - injects a bridge loop into the current page
  - sends reduced DOM observations to the local orchestrator
  - executes queued fill and submit commands from the orchestrator

- `page_agent_dom`
  - in-memory harness for deterministic local development and tests
- `live_chrome`
  - attaches to a Chrome or Chromium session over CDP and extracts a reduced DOM observation from the live page

Both adapters follow the same execution contract.

This means:

- the worker does not operate from raw screenshots by default
- the worker exposes a reduced DOM observation
- interactive elements have stable indexes and semantic keys
- the planner and worker reason over structured state

## 2. Observation Shape

Each opened page should produce:

- `systemId`
- `pageId`
- `url`
- `title`
- `summary`
- `interactiveElements`
- `finalActionButton`

Each interactive element should include:

- `index`
- `type`
- `key`
- `label`
- `value`
- `required`

## 3. Execution Sequence

For any approval-sensitive web step:

1. `open_system`
2. `fill_web_form`
3. `preview_web_submission`
4. human approval
5. `submit_web_form`

## 4. Field Mapping Rule

The worker fills fields by `semantic key`, not by screen coordinate.

Example:

- `traveler_name`
- `destination_country`
- `customs_number`

These keys map to the interactive elements in the DOM harness observation.

## 5. Final Submit Rule

`submit_web_form` must validate:

- expected final action button matches
- all required fields have non-empty values

If either condition fails, submission must stop.

## 6. Current Implementation Boundary

The current implementation provides:

- a bookmarklet bridge for normal Chrome sessions
- a Page-Agent-style in-memory DOM harness adapter
- a live Chrome adapter over CDP using `playwright-core`
- a Windows Outlook COM execution path
- a Cube web execution path over the bookmarklet bridge
- semantic field fill
- preview
- final-button validation
- adapter selection through `WEB_WORKER_ADAPTER=bookmarklet_bridge|page_agent_dom|live_chrome`
- CDP endpoint selection through `WEB_WORKER_CDP_URL`

The current implementation does not yet provide:

- Page Agent JS injection into a production browser session
- site-specific locator packs beyond the shared system definitions
- a production-tested Outlook reply poller service
- production validation against the real internal websites

## 7. Live Chrome Runtime

To use the live adapter:

1. start Chrome or Chromium with remote debugging enabled
2. set `WEB_WORKER_ADAPTER=live_chrome`
3. optionally set `WEB_WORKER_CDP_URL=http://127.0.0.1:9222`
4. call the existing web tools:
   - `open_system`
   - `fill_web_form`
   - `preview_web_submission`
   - `submit_web_form`

Example:

```bash
open -na "Google Chrome" --args --remote-debugging-port=9222
WEB_WORKER_ADAPTER=live_chrome npm run demo
```

## 8. Bookmarklet Bridge Runtime

To use the normal Chrome path:

1. run `WEB_WORKER_ADAPTER=bookmarklet_bridge npm run dev`
2. open `/bridge/bookmarklet?systemId=security_portal`
3. create a normal Chrome bookmark and paste the returned `bookmarklet` value into the bookmark URL
4. navigate to the target internal page in normal Chrome
5. click the bookmark
6. verify `/bridge/sessions` shows the attached page
7. call the existing web tools through the orchestrator API
