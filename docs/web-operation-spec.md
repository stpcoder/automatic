# Web Operation Spec

## 1. Operating Model

The web worker uses a `Page Agent` style DOM harness and supports two adapters:

- `extension_bridge`
  - works through a Chrome extension content script
  - automatically reconnects across same-tab and new-tab navigation
  - sends reduced DOM observations to the local orchestrator
  - executes queued fill, click, read, submit, and navigation commands
- `page_agent_dom`
  - in-memory harness for deterministic local development and tests

Both adapters follow the same execution contract.

## 2. Observation Shape

Each opened page should produce:

- `sessionId`
- `parentSessionId`
- `systemId`
- `pageId`
- `url`
- `title`
- `summary`
- `pageText`
- `interactiveElements`
- `finalActionButton`

## 3. Execution Sequence

For a normal interactive web step:

1. `open_system`
2. `fill_web_form`
3. `click_web_element`
4. `read_web_page`
5. `finish_task`

For an approval-sensitive commit step:

1. `open_system`
2. `fill_web_form`
3. `preview_web_submission`
4. human approval
5. `submit_web_form`
6. `read_web_page`
7. `finish_task`

## 4. Field Mapping Rule

The worker fills fields by `semantic key`, not by screen coordinate.

## 5. Current Implementation Boundary

The current implementation provides:

- a Chrome extension bridge for normal Chrome sessions
- a Page-Agent-style in-memory DOM harness adapter
- a Windows Outlook COM execution path
- a Cube web execution path over the extension bridge
- semantic field fill
- click and navigation follow
- page read / DOM observation
- preview
- final-button validation
- adapter selection through `WEB_WORKER_ADAPTER=extension_bridge|page_agent_dom`

The current implementation does not yet provide:

- robust hover/shortcut/file-upload primitives
- richer result-list ranking across many candidates
- production validation against every real internal website

## 6. Extension Runtime

To use the extension adapter:

1. load the unpacked extension from `extensions/chrome-bridge`
2. set `WEB_WORKER_ADAPTER=extension_bridge`
3. call the existing web tools:
   - `open_system`
   - `fill_web_form`
   - `click_web_element`
   - `read_web_page`
   - `preview_web_submission`
   - `submit_web_form`

Example:

```bash
WEB_WORKER_ADAPTER=extension_bridge npm run demo
```
