# Implementation Blueprint

## 1. Scope

This document turns the architecture draft into a buildable implementation outline.

The target is a hybrid system:

- product-led execution and operations on Windows
- custom orchestration and policy logic
- internal LLM integration through a compatibility adapter

## 2. Repository Shape

Recommended repository layout:

```text
apps/
  orchestrator/
  approval-ui/
  admin-console/
workers/
  outlook-worker/
  web-worker/
  cube-worker/
  scheduler-worker/
packages/
  contracts/
  workflow-registry/
  llm-adapter/
infra/
  environments/
  windows-runtime/
docs/
examples/
```

## 3. Services

### 3.1 Orchestrator

Purpose:

- create and resume cases
- evaluate current step
- route events
- register expectations
- enforce state transitions
- call planners and workers

Core responsibilities:

- case CRUD
- workflow load
- expectation matching
- planner invocation
- memory patching
- audit event writing

Suggested API:

- `POST /cases`
- `GET /cases/:caseId`
- `POST /cases/:caseId/resume`
- `POST /events`
- `POST /planner/run`
- `POST /approvals/:approvalId/decision`

### 3.2 Approval UI

Purpose:

- show previews for gated actions
- display checklist and policy reasons
- approve, reject, or request revision

Suggested views:

- approval inbox
- case detail
- event history
- diff/preview panel

### 3.3 Admin Console

Purpose:

- manage workflows, templates, systems, contacts, and policies
- inspect worker health and waiting cases

## 4. Workers

### 4.1 Outlook Worker

Responsibilities:

- draft mail
- send mail after approval
- ingest new mail events
- resolve reply metadata
- register mailbox watchers

Inputs:

- tool requests from orchestrator
- mailbox or event subscriptions

Outputs:

- draft ids
- message ids
- normalized `incoming_email` events

### 4.2 Web Worker

Responsibilities:

- open internal systems
- collect structured page observations
- fill forms
- produce previews
- execute final submit after approval

Modes:

- `page_agent_dom`
- `playwright`

### 4.3 Cube Worker

Responsibilities:

- draft message
- send after approval
- ingest replies if supported
- normalize incoming chat events

### 4.4 Scheduler Worker

Responsibilities:

- poll waiting cases
- emit reminder and escalation events
- retry timed jobs

## 5. Shared Packages

### 5.1 Contracts

Must define canonical schemas for:

- case
- case state
- event
- expectation
- approval request
- tool call request
- tool result
- planner output
- observation

### 5.2 Workflow Registry

Stores versioned workflow definitions:

- workflow yaml
- system registry
- templates
- checklists
- policies

### 5.3 LLM Adapter

Responsibilities:

- translate normalized calls to legacy chat-completions format
- normalize function/tool calls
- fall back to strict JSON text mode
- standardize errors and retries

## 6. Data Model

Suggested persistence tables:

### 6.1 `cases`

- `case_id`
- `workflow_id`
- `state`
- `current_step_id`
- `priority`
- `created_at`
- `updated_at`

### 6.2 `case_facts`

- `case_id`
- `fact_key`
- `fact_value_json`
- `source`
- `verified`
- `updated_at`

### 6.3 `case_events`

- `event_id`
- `case_id`
- `event_type`
- `payload_json`
- `source`
- `created_at`

### 6.4 `expectations`

- `expectation_id`
- `case_id`
- `type`
- `status`
- `matcher_json`
- `required_fields_json`
- `remind_at`
- `escalate_at`

### 6.5 `approvals`

- `approval_id`
- `case_id`
- `action_type`
- `preview_json`
- `checklist_json`
- `status`
- `requested_at`
- `decided_at`
- `decided_by`

### 6.6 `artifacts`

- `artifact_id`
- `case_id`
- `kind`
- `external_id`
- `metadata_json`
- `created_at`

### 6.7 `workflow_versions`

- `workflow_id`
- `version`
- `definition_yaml`
- `created_at`

### 6.8 `audit_logs`

- `audit_id`
- `case_id`
- `actor_type`
- `actor_id`
- `action`
- `before_json`
- `after_json`
- `created_at`

## 7. Execution Contracts

### 7.1 Planner Request

Inputs:

- system prompt
- workflow step
- case memory
- observation
- tool registry subset
- policy summary

Output:

- objective
- one next action
- rationale
- approval required flag
- expected state transition

### 7.2 Tool Request

Normalized request shape:

```yaml
tool_request:
  request_id: TR-001
  case_id: CASE-2026-0041
  tool_name: draft_outlook_mail
  mode: draft
  input: {}
```

### 7.3 Tool Result

```yaml
tool_result:
  request_id: TR-001
  success: true
  output: {}
  memory_patch: {}
  emitted_events: []
```

## 8. Deployment Topology

### 8.1 Recommended

- `apps/orchestrator` on an internal Linux or Windows server
- `apps/approval-ui` on internal web infrastructure
- workers on Windows VMs or operator desktops
- UiPath for robot execution if adopted
- internal database for case state
- internal LLM gateway reachable through HTTP

### 8.2 Windows Runtime Needs

- Outlook profile configured
- browser profile/session configured
- corporate certificate trust installed
- stable desktop session for UI automation if needed

## 9. First Implementable Vertical Slice

Build in this order:

1. contracts package
2. orchestrator case + event + expectation core
3. approval request/decision loop
4. legacy LLM adapter
5. Outlook worker for draft/send/watch
6. shipment workflow v1

Do not start with Cube or physical receipt first.

## 10. Non-Goals For V1

- full autonomous multi-action execution
- desktop vision-first automation
- dynamic workflow generation at runtime
- direct commit actions without approval
