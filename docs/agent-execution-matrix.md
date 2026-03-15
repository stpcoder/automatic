# Agent Execution Matrix

## 1. Purpose

Define which agent is responsible for each step and what that agent is allowed to do.

## 2. Agents

### PlannerAgent

- Reads case memory, workflow step, observation, and policy summary
- Chooses the next bounded action
- Never commits final side effects directly

### OutlookAgent

- Drafts mail
- Sends mail only after approval
- Registers email reply expectations
- Preferred real path: `outlook_com`

### WebAgent

- Uses a Page-Agent-style DOM harness
- Reads structured page observations only
- Fills fields by semantic key
- Produces preview before final submit
- Submits only after approval
- Preferred real path: `bookmarklet_bridge`
- Optional real path: `live_chrome`

### CubeAgent

- Drafts and sends chat messages
- Supports approval gate before send
- Preferred real path: `bookmarklet_bridge`

### SchedulerAgent

- Evaluates waiting expectations
- Emits remind/escalate signals

## 3. Shipment Workflow Matrix

### collect_facts

- owner agent: `PlannerAgent`
- action: validate required facts in case memory
- commit allowed: no

### request_customs_number

- owner agents:
  - `OutlookAgent` for `draft_outlook_mail`
  - `PlannerAgent` for expectation registration decision
- commit action:
  - `send_outlook_mail`
- approval required: yes
- waiting target:
  - vendor email reply containing `customs_number`

### register_security_portal

- owner agent: `WebAgent`
- harness: `bookmarklet_bridge`
- draft action:
  - `open_system`
  - `fill_web_form`
  - `preview_web_submission`
- commit action:
  - `submit_web_form`
- approval required: yes

### create_dhl_shipment

- owner agent: `WebAgent`
- harness: `bookmarklet_bridge`
- draft action:
  - `open_system`
  - `fill_web_form`
  - `preview_web_submission`
- commit action:
  - `submit_web_form`
- approval required: yes

## 4. Sample Intake Matrix

### resolve_shift_assignee

- owner agent: `PlannerAgent`
- worker/tool:
  - `read_shift_file`

### notify_current_assignee

- owner agent: `CubeAgent`
- harness: `bookmarklet_bridge`
- draft action:
  - `draft_cube_message`
- commit action:
  - `send_cube_message`
- approval required: yes

### register_internal_intake

- owner agent: `WebAgent`
- harness: `bookmarklet_bridge`
- commit action:
  - `submit_web_form`
- approval required: yes

### create_physical_receipt_task

- owner agent: `PlannerAgent` or Human Task module
- commit action:
  - `create_human_task`
- approval required: yes
