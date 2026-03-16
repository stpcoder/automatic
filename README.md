# Enterprise Agent Orchestration Draft

This repository contains a concrete draft for an enterprise workflow agent system that:

- orchestrates multi-step business workflows such as overseas equipment shipment and sample intake
- pauses on external dependencies and resumes on email/chat/system events
- enforces human approval before any final send, save, submit, or approval action
- runs against Windows-based tools such as Outlook and internal desktop/web systems
- integrates with an internal OpenAI-compatible local LLM, including older chat-completions style APIs

## Contents

- [Architecture](docs/architecture.md)
- [Runtime Spec](docs/runtime-spec.md)
- [Workflow Library](docs/workflows.md)
- [Implementation Plan](docs/implementation-plan.md)
- [Implementation Blueprint](docs/implementation-blueprint.md)
- [MVP Backlog](docs/mvp-backlog.md)
- [Decision Checklist](docs/decision-checklist.md)
- [Integration Test Strategy](docs/integration-test-strategy.md)
- [Test Status](docs/test-status.md)
- [Operator Runbook](docs/operator-runbook.md)

## Design Principles

- Deterministic outer workflow, agentic inner execution
- Draft first, approve second, commit third
- Checklist-driven steps, not free-form automation
- Waiting is a first-class state, not an error
- The model sees only harness-provided observations and uses only registered tools

## Repository Layout

- `docs/`: architecture and planning documents
- `examples/`: YAML examples for prompts, tools, systems, workflows, and policies
- `apps/`: services and operator-facing applications
- `workers/`: Windows and channel-specific executors
- `packages/`: shared contracts and schemas
- `infra/`: deployment and environment notes

## Current Implementation

The repository now includes an executable MVP skeleton:

- shared contracts with Zod schemas
- YAML workflow registry loader
- legacy OpenAI-compatible LLM adapter
- SQLite-backed persistent orchestrator store
- approval-gated commit flow
- email wait/resume event handling
- browser bridge coordinator for normal Chrome bookmarklets
- Page-Agent-style web worker with `bookmarklet_bridge`, `page_agent_dom`, and `live_chrome` adapters
- Windows Outlook COM path for real draft/send/watch registration
- Outlook reply poller that posts matched replies back into the orchestrator
- Cube web path through the bookmarklet bridge
- shipment workflow demo through the customs-number request path

## Run

```bash
npm install
npm run check
npm test
npm run demo
```

Run the demo HTTP API:

```bash
npm run dev
```

Enable persistent storage:

```bash
ORCHESTRATOR_STORE=sqlite ORCHESTRATOR_DB_PATH=./data/orchestrator.sqlite npm run dev
```

Use the normal Chrome bookmarklet bridge:

```bash
WEB_WORKER_ADAPTER=bookmarklet_bridge npm run dev
```

Then open:

- `http://127.0.0.1:3000/bridge/bookmarklet?systemId=security_portal`
- `http://127.0.0.1:3000/bridge/bookmarklet?systemId=dhl`
- `http://127.0.0.1:3000/bridge/bookmarklet?systemId=cube`

Copy the returned `bookmarklet` value into a normal Chrome bookmark URL field and click it on the target page.

Use the Windows Outlook COM path:

```bash
OUTLOOK_WORKER_ADAPTER=outlook_com npm run dev
npm run outlook:poller
```

Windows helper commands:

```bash
npm run win:setup
npm run win:start
npm run win:poller
npm run win:start-all
npm run win:health
npm run win:bookmarklets
npm run win:sessions
npm run win:create-shipment-case
npm run win:advance-case -- -CaseId CASE_ID
npm run win:approve-latest
```

API endpoints:

- `POST /cases`
- `GET /cases/:caseId`
- `POST /cases/:caseId/advance`
- `POST /cases/:caseId/events/email`
- `GET /approvals`
- `POST /approvals/:approvalId/decision`

Operator UI:

- `/ui/approvals`
- `/ui/cases/:caseId`

## What Works Today

- case creation
- workflow loading from YAML
- SQLite persistence across process restarts
- immediate auto-advance through non-blocking steps
- draft creation before commit
- human approval requirement before commit
- approval UI for pending commit actions
- Outlook COM execution path
- Outlook reply poller service
- Cube bookmarklet bridge execution path
- waiting on incoming email
- resume on matched email with extracted fields
- move to the next draft step after reply
- web worker adapter selection
- normal Chrome bookmarklet bridge
- live Chrome DOM observation mapping over CDP

## Next Build Steps

1. Add real approval UI
2. Add planner integration through the internal LLM endpoint
3. Validate site-specific field mappings on the real internal websites
4. Add sample-intake workflow execution
5. Add Cube inbound reply polling

## Recommended Product Direction

The recommended baseline is:

- `UiPath Automation Suite / Orchestrator` for Windows execution, scheduling, queues, approvals, and operations
- a small internal `Case Orchestrator` service for state, pending/resume, and policy control
- internal `Qwen 3.5` or `GLM-4.7` via a legacy OpenAI-compatible adapter
- `Page Agent` style web harness for DOM-first browser operations
- Outlook/Cube/internal-system adapters as bounded execution tools

## First PoC

Build this vertical slice first:

1. Create a shipment case
2. Draft and send a vendor email asking for customs number
3. Register an email expectation and move to `WAITING_EMAIL`
4. Resume when the vendor reply arrives
5. Extract customs number
6. Prepare the next internal system registration draft
7. Require human approval before final save/submit
