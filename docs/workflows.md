# Workflow Library

## 1. Workflow Style

Each workflow should be defined as:

- trigger
- required inputs
- ordered steps
- preconditions
- checklist
- allowed tools
- approval rules
- waiting rules
- success criteria
- timeout and escalation rules

## 2. Overseas Equipment Shipment

### 2.1 Purpose

Ship equipment to an overseas traveler using DHL while coordinating vendor, security, and internal systems.

### 2.2 Typical Steps

1. Collect traveler and equipment facts
2. Validate shipment prerequisites
3. Draft vendor request for customs number
4. Approve and send email
5. Register email expectation
6. Wait for reply
7. Extract customs number
8. Draft security registration
9. Approve and save/submit security registration
10. Draft DHL shipment
11. Approve and submit DHL shipment
12. Notify traveler and internal stakeholders
13. Track shipment and manage exceptions

### 2.3 Waiting Example

After vendor request mail is sent:

- create expectation for incoming reply
- state becomes `WAITING_EMAIL`
- on matched reply, extract customs number
- if extracted, state becomes `READY`
- if not extracted, remain waiting and flag missing field

## 3. Sample Intake

### 3.1 Purpose

Receive a sample, notify the current shift owner, complete internal system entry, and coordinate physical handoff.

### 3.2 Typical Steps

1. Receive intake trigger
2. Read sample metadata
3. Read shift file
4. Resolve current assignee
5. Draft Cube message
6. Approve and send message
7. Draft internal web entry
8. Approve and save/submit internal entry
9. Create physical receipt task
10. Wait for receipt confirmation
11. Complete intake

### 3.3 Physical Task Pattern

Physical tasks must not be faked by the agent.

Instead:

- create task
- notify responsible person
- wait for explicit confirmation
- escalate if no response by SLA

## 4. Common Step Pattern

Every step should support the same lifecycle:

1. check preconditions
2. evaluate checklist
3. generate draft or preview
4. request approval if commit is needed
5. execute commit
6. save evidence
7. transition state

## 5. Event Resume Pattern

Resume rules should be deterministic:

- email: conversation id first, sender + normalized subject fallback
- chat: room/thread + sender
- system event: request id or record id
- physical task: task id + actor confirmation

## 6. Escalation Pattern

Each waiting step should define:

- `remind_after`
- `escalate_after`
- `escalate_to`

Example:

- remind vendor after 24h
- escalate to internal owner after 48h

## 7. Checklist Types

Use three checklist layers:

- `common`
  - recipient verified
  - case id included
  - approval required if external
- `domain`
  - customs number present
  - traveler destination present
  - sample id present
- `system`
  - target page is correct
  - required fields visible
  - final button preview matches expected action
