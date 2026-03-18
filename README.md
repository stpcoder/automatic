# Enterprise Agent Orchestration Draft

This repository contains a concrete draft for an enterprise workflow agent system that:

- orchestrates multi-step business workflows such as overseas equipment shipment and sample intake
- pauses on external dependencies and resumes on email/chat/system events
- enforces human approval before any final send, save, submit, or approval action
- runs against Windows-based tools such as Outlook and internal desktop/web systems
- integrates with an internal OpenAI-compatible local LLM, including older chat-completions style APIs

## Contents

- [Current Status](docs/current-status.md)
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
- browser bridge coordinator with session-aware same-tab/new-tab follow support
- extension-first Page-Agent-style web worker with `extension_bridge` and `page_agent_dom`
- Windows Outlook COM path for real draft/send/watch registration
- Outlook reply poller that posts matched replies back into the orchestrator
- Cube web path through the shared bridge path
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

The Chrome extension bridge path is the default web path:

```bash
WEB_WORKER_ADAPTER=extension_bridge npm run dev
```

The extension bridge is the default web path.

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
npm run win:doctor
npm run win:sessions
npm run win:create-shipment-case
npm run win:advance-case -- -CaseId CASE_ID
npm run win:approve-latest
```

Standalone agent tests:

```bash
npm run win:llm:init
npm run win:debug:overview
npm run win:debug:web:open -- -SystemId security_portal
npm run win:debug:web:fill -- -SystemId security_portal -FieldsJson '{"traveler_name":"Kim"}'
npm run win:debug:mail:draft -- -To vendor@example.com -TemplateId request_customs_number -VariablesJson '{"traveler_name":"Kim"}'
npm run win:debug:agent:run -- -Instruction "메일 초안을 작성해줘" -ContextJson '{"template_id":"request_customs_number","to":["vendor@example.com"],"variables":{"traveler_name":"Kim"}}'
```

Naver stock prompt examples:

```bash
npm run win:test:1
npm run win:test:2
npm run win:test:3

Windows quick test aliases:
- `npm run win:test:1`: 네이버 열어서 하이닉스 주가 검색 후 현재 주가 알려주기
- `npm run win:test:2`: 네이버에서 SK hynix 뉴스 검색 후 핵심 결과 열기
- `npm run win:test:3`: 구글에서 SK hynix 뉴스 검색 후 핵심 결과 열기
- `npm run win:test:4`: 구글에서 상품 가격 검색 후 가격 확인
- `npm run win:test:5`: 현재 페이지 핵심 내용 요약
- `npm run win:test:6`: 현재 페이지 주요 행동 파악
- `npm run win:test:7`: 현재 열린 상세 페이지에서 주가 직접 읽기
- `npm run win:test:8`: 네이버 쇼핑/가격 검색 시나리오
```

See `docs/windows-real-test-runbook.md` for the current Windows extension setup.

Important Chrome extension note:

- Set the extension site access to `On all sites`.
- If Chrome keeps asking whether the extension may access each new site, the extension is still in `On click` or limited-site mode.
- This is a Chrome permission setting, not an orchestrator whitelist.

The natural-language debug agent uses `@ai-sdk/openai-compatible` when `opencode.ai/config.json` contains a valid API key.
It supports both a simple `llm` block and an OpenCode-style `provider/options/models` block.

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
- Cube bridge execution path
- waiting on incoming email
- resume on matched email with extracted fields
- move to the next draft step after reply
- web worker adapter selection
- Chrome extension bridge with page-navigation-safe sessions and visual pointer/scroll feedback
- extension bootstrap retry when the local server starts late

## Next Build Steps

1. Validate site-specific field mappings on the real internal websites
2. Add search-result list extraction and candidate selection
3. Add stronger session selection for multiple same-system tabs
4. Add sample-intake workflow execution
5. Add Cube inbound reply polling
6. Strengthen approval and audit UI

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
