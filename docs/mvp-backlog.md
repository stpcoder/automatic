# MVP Backlog

## 1. Objective

Deliver a minimum usable system that can:

- create a case
- draft a vendor email
- require human approval before send
- wait for vendor reply
- resume on reply
- extract customs number
- prepare the next system-entry draft

## 2. Milestones

### M1. Contracts and Skeleton

Tasks:

- define canonical schemas for case, event, expectation, approval, planner output
- create repo module skeleton
- define workflow versioning rules

Acceptance:

- schemas exist and example payloads validate conceptually

### M2. Orchestrator Core

Tasks:

- implement case creation
- implement state transitions
- implement expectation registration
- implement event ingestion
- implement expectation matching

Acceptance:

- a case can move from `READY` to `WAITING_EMAIL` and back to `READY`

### M3. Approval Flow

Tasks:

- create approval entity
- generate approval previews
- store approval decisions
- block commit actions until approved

Acceptance:

- send actions are impossible without an approval record in `approved` state

### M4. LLM Adapter

Tasks:

- create normalized planner request/response interface
- implement legacy chat-completions request builder
- add malformed JSON fallback
- add one-action-per-turn enforcement

Acceptance:

- planner and extractor prompts can be sent through the internal endpoint

### M5. Outlook Worker

Tasks:

- draft mail tool
- send mail tool
- incoming email normalization
- reply event correlation

Acceptance:

- vendor request mail can be drafted, approved, sent, and correlated with a reply

### M6. Shipment Workflow V1

Tasks:

- encode shipment workflow definition
- load workflow from registry
- create first checklist set
- define customs-number expectation logic

Acceptance:

- customs-number wait/resume path works end-to-end on a test case

## 3. Post-MVP Milestones

### M7. Web Worker

- open page
- reduced DOM observation
- form fill
- preview capture
- approval-gated submit

### M8. Sample Intake

- shift file parse
- assignee resolution
- Cube message draft/send
- physical receipt task lifecycle

### M9. Operations

- escalations
- operator dashboard
- audit exports

## 4. Work Breakdown By Role

### Platform

- environment setup
- DB
- deployment
- worker runtime

### Backend

- orchestrator
- policy engine
- workflow loader
- event matcher

### AI

- prompts
- extraction schemas
- adapter fallback

### RPA/Desktop

- Outlook
- web runner
- Cube

### Operations

- approval routing
- runbook
- user onboarding

## 5. Testing Strategy

### Unit Level

- event matcher
- approval evaluator
- checklist engine
- state transitions

### Integration Level

- orchestrator to LLM adapter
- orchestrator to Outlook worker
- approval to commit loop

### UAT Level

- end-to-end shipment test
- operator approval flow
- reply-driven resume flow
