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
