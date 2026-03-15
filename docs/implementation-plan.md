# Implementation Plan

## 1. Recommended Delivery Order

### Phase 0. Baseline Decisions

Decide these first:

- classic Outlook vs new Outlook
- UiPath availability vs custom worker approach
- Cube integration mode: API, web, or Windows UI automation
- internal LLM endpoint behavior: legacy chat-completions, function calling support, token limits

### Phase 1. Contracts and Schemas

Deliverables:

- workflow schema
- step schema
- checklist schema
- policy schema
- memory schema
- observation schema
- tool schema
- expectation/event schema

Why first:

- without contracts, approvals and waiting logic will fragment across tools

### Phase 2. Core Orchestration Service

Implement:

- case service
- event router
- expectation matcher
- state machine
- deadline watcher
- audit log

Exit criteria:

- can create a case
- can move to `WAITING_EMAIL`
- can resume on matched incoming email

### Phase 3. Policy and Approval Engine

Implement:

- policy evaluator
- approval request table
- approval UI contract
- reject/rework behavior

Exit criteria:

- final email send and final web submit cannot happen without approval

### Phase 4. LLM Adapter

Implement:

- unified internal LLM client
- legacy chat-completions adapter
- tool-call normalization
- JSON-text fallback parser

Exit criteria:

- planner and extractor prompts work against the internal OpenAI-compatible endpoint

### Phase 5. Tool Harnesses

Implement in this order:

1. Outlook draft/send/watch
2. web open/fill/preview/submit
3. shift file reader
4. Cube message draft/send/watch
5. physical task create/confirm

Exit criteria:

- each harness supports draft/preview mode before commit mode

### Phase 6. First Business Workflow

Implement `overseas_equipment_shipment`.

Exit criteria:

- vendor customs-number wait/resume flow works end-to-end

### Phase 7. Second Business Workflow

Implement `sample_intake`.

Exit criteria:

- shift file resolution, Cube notification, internal entry, and physical receipt confirmation work end-to-end

## 2. Workstream Breakdown

### 2.1 Platform and Product

- select product baseline
- provision Windows execution environment
- define operator ownership and approvals

### 2.2 Workflow Authoring

- create workflow registry
- define step library
- define checklists
- define system registry
- define email/chat templates

### 2.3 Adapter Engineering

- Outlook adapter
- web harness
- Cube adapter
- file parser
- human task adapter

### 2.4 AI Engineering

- planner prompts
- extractor prompts
- draft-generation prompts
- fallback behavior for legacy APIs

### 2.5 Governance

- approval matrix
- audit logging
- retry policy
- escalation policy
- secrets and credentials handling

## 3. Needed Deliverables

### Documents

- architecture
- runtime spec
- workflow library
- implementation roadmap
- operator runbook

### Configuration

- system prompt
- tool registry
- system registry
- approval policies
- templates
- workflows
- LLM adapter config

### Services

- orchestration API
- event ingestion API
- approval API
- LLM adapter

### Workers

- Outlook worker
- web worker
- Cube worker
- scheduler/watcher worker

## 4. Data Model Requirements

Core entities:

- `users`
- `cases`
- `case_steps`
- `case_events`
- `expectations`
- `approvals`
- `artifacts`
- `workflow_definitions`
- `audit_logs`

## 5. PoC Scope

Keep first PoC narrow.

### PoC A

- case creation
- draft vendor email
- approval
- send
- waiting state
- vendor reply resume
- extract customs number

### PoC B

- shift file parse
- resolve assignee
- draft Cube message
- approval
- send
- physical receipt wait/confirm

## 6. Risks and Controls

### Risks

- New Outlook incompatibility
- unstable internal web UI
- Cube integration uncertainty
- local LLM inconsistent tool calling

### Controls

- choose classic Outlook if possible
- use preview/draft first
- add adapter abstraction for Cube
- support strict JSON fallback when tool calling is weak
