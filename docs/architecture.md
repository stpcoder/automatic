# Architecture

## 1. Goal

Build a workflow agent system for internal operations that can:

- access internal web systems
- work with Windows Outlook
- send chat messages through tools such as Cube
- read shift files and route tasks to the correct person
- pause on missing data or external replies
- resume automatically on events
- enforce human approval before irreversible actions

The system should not be a single monolithic agent. It should be a controlled orchestration layer with bounded execution tools.

## 2. Core Architecture

### 2.1 Layers

1. `Workflow Registry`
   - Stores workflow definitions, step checklists, approval rules, templates, and system mappings.
2. `Case Orchestrator`
   - Owns state transitions, event matching, pending/resume, deadlines, retries, and escalation.
3. `Policy Engine`
   - Enforces human-in-the-loop approval on final actions.
4. `Tool Harness`
   - Provides bounded tools for Outlook, web, Cube, files, and Windows apps.
5. `LLM Adapter`
   - Normalizes requests to internal OpenAI-compatible endpoints, including legacy chat-completions style APIs.
6. `Memory Store`
   - Holds user memory, org memory, workflow memory, case memory, and audit logs.
7. `Approval UI`
   - Presents previews, checklists, and final approval prompts before commit actions.

### 2.2 High-Level Flow

1. Trigger arrives.
2. Case is created or resumed.
3. Current step is loaded from workflow registry.
4. Harness collects structured observation from the current channel.
5. Checklist engine validates preconditions and required fields.
6. LLM plans the next bounded action.
7. Tool runs in draft or preview mode.
8. If action is irreversible, policy engine moves the case to `APPROVAL_REQUIRED`.
9. User approves or rejects.
10. Commit tool runs.
11. Case transitions to next step or waiting state.

## 3. State Model

Recommended case states:

- `READY`
- `RUNNING`
- `DRAFT_READY`
- `APPROVAL_REQUIRED`
- `WAITING_EMAIL`
- `WAITING_CHAT`
- `WAITING_HUMAN`
- `WAITING_SYSTEM`
- `COMPLETED`
- `FAILED`
- `ESCALATED`

Waiting states are valid business states. They are not failures.

## 4. Event Model

Supported events:

- `incoming_email`
- `incoming_chat`
- `web_status_changed`
- `approval_granted`
- `approval_rejected`
- `human_task_confirmed`
- `deadline_passed`
- `manual_resume`

Events should be matched against `expectations`, not handled ad hoc.

## 5. Human-In-The-Loop Policy

All final actions must be split into `draft/preview` and `commit`.

Mandatory approval gates:

- external email send
- external chat send
- internal system final save when it creates or changes records
- approval draft submission
- DHL final shipment submission
- security portal final registration

Recommended split:

- `draft_outlook_mail` -> `approve_outlook_mail_send` -> `send_outlook_mail`
- `fill_web_form` -> `preview_web_submission` -> `approve_web_submit` -> `submit_web_form`
- `draft_approval_document` -> `approve_approval_submission` -> `submit_approval_document`

## 6. Product Strategy

### 6.1 Recommended Core Product

Use an existing product for Windows automation and operations:

- `UiPath Automation Suite / Orchestrator`

Use custom services only for:

- workflow registry
- case state and expectations
- policy engine
- legacy LLM adapter
- system-specific prompt/templates/checklists

### 6.2 Why

- Windows automation is hard to reproduce safely from scratch.
- Outlook and desktop automation are better served by mature RPA tooling.
- Queues, scheduling, retries, operator visibility, and approvals already exist in products like UiPath.
- Custom development should focus on enterprise logic, not generic robot plumbing.

## 7. Windows Execution Strategy

### 7.1 Outlook

Preferred order:

1. `Classic Outlook` with COM/OOM if available
2. `Microsoft 365 / Graph` if New Outlook is enforced and policy allows it
3. UI automation fallback only if neither path is available

### 7.2 Web Systems

Preferred order:

1. `Page Agent` style DOM-first harness for structured internal systems
2. `Playwright` fallback for unstable or richer workflows
3. Vision fallback only for controls not exposed through DOM/UIA

### 7.3 Cube and Other Desktop Apps

Preferred order:

1. official API or bot integration
2. web automation if the client is web-based
3. Windows UI automation if it is a desktop app

## 8. Reference Runtime Contract

The LLM never directly controls the machine.

It receives:

- system prompt
- case memory
- workflow step definition
- structured observation
- tool registry

It produces:

- short plan
- one bounded next action
- rationale
- expected transition

The harness is the only layer that can touch the real systems.
