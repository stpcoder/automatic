# Integration Test Strategy

## 1. Goal

Validate that the system behaves correctly across layers, not just within isolated modules.

The target is staged verification:

1. contract validation
2. module validation
3. orchestration validation
4. HTTP integration validation
5. end-to-end demo validation

## 2. Test Layers

### 2.1 Contract Tests

Purpose:

- verify schema compatibility
- catch malformed workflow or payload structure early

Coverage:

- case creation input
- workflow definition shape

### 2.2 Package Tests

Purpose:

- validate registry and adapter behavior independently

Coverage:

- workflow YAML loading
- legacy LLM tool-call parsing

### 2.3 Worker Tests

Purpose:

- validate tool-level behavior for each channel worker

Coverage:

- Outlook draft/send/watch
- Web fill/preview/submit
- Cube draft/send
- Scheduler remind/escalate

### 2.4 Orchestrator Core Tests

Purpose:

- validate state transitions, approval gates, waiting/resume, and negative paths

Coverage:

- shipment flow through vendor mail wait/resume
- approval rejection path
- unmatched email path
- web step approval progression

### 2.5 HTTP Integration Tests

Purpose:

- validate the public API surface against the orchestrator behavior

Coverage:

- create case
- advance case
- request approval
- approve
- ingest email
- resume to next step

### 2.6 Demo Validation

Purpose:

- run a realistic scripted scenario from CLI
- confirm final state and intermediate transitions are coherent

## 3. Test Environment

Current environment:

- macOS developer machine
- in-memory persistence
- simulated workers
- no external Outlook or browser process

This is sufficient for logic validation but not for production connectivity validation.

## 4. Future Integration Test Stages

### Stage A. Current

- in-memory store
- simulated workers
- local CLI and HTTP tests

### Stage B. Pre-Windows

- persistent DB
- approval UI against the orchestrator
- internal LLM endpoint smoke tests

### Stage C. Windows Integration

- Classic Outlook worker against a real mailbox profile
- web worker against a test internal system or sandbox page
- Cube adapter against a test tenant or stub endpoint

### Stage D. UAT

- full shipment rehearsal
- operator approval flow rehearsal
- reply-driven resume under real timing

## 5. Pass Criteria

The current codebase is considered healthy when all of the following pass:

- `npm run check`
- `npm test`
- `npm run demo`

## 6. Known Boundaries

The current suite does not yet validate:

- real Outlook COM connectivity
- real Page Agent or Playwright execution against production pages
- real Cube transport
- DB-backed persistence
- operator UI rendering
