# Runtime Spec

## 1. Purpose

Define how prompts, memory, observations, tools, approvals, and step execution are formatted.

This runtime follows the same core principle as `Page Agent` style systems:

- the harness reads the environment
- the harness exposes a bounded tool list
- the model only sees the harness output
- the model only acts by selecting a registered tool

## 2. Runtime Inputs

Every agent turn should receive these inputs:

1. `system_prompt`
2. `workflow_step`
3. `case_memory`
4. `observation`
5. `tool_registry`
6. `approval_context`
7. `policy_summary`

## 3. System Prompt Format

The system prompt should define:

- role
- operating rules
- planning rules
- memory rules
- completion rules
- safety rules

Required rules:

- Use only tools from the registry.
- Never assume unseen state.
- Do not bypass approval policy.
- Update memory only with verified facts.
- Move to waiting state when the required event has not yet arrived.

## 4. Observation Format

Observation is a structured summary of the current channel.

```yaml
observation:
  timestamp: "2026-03-15T10:02:31+09:00"
  channel: web
  context:
    system_id: security_portal
    page_id: export_registration
    url: https://security.internal/register
    title: Export Registration
  visible_state:
    summary: >
      Registration form is open. Traveler information is filled.
      Customs number field is empty.
    interactive_elements:
      - index: 0
        type: input
        label: Traveler Name
        value: Kim
      - index: 1
        type: input
        label: Customs Number
        value: ""
      - index: 2
        type: button
        label: Save Draft
      - index: 3
        type: button
        label: Submit
  checklist_result:
    passed:
      - traveler_name_present
    failed:
      - customs_number_present
```

The LLM should not receive raw screens by default. It should receive structured summaries first.

## 5. Tool Registry Format

Each tool should include:

- `name`
- `description`
- `mode`: `draft`, `preview`, or `commit`
- `inputs`
- `side_effects`
- `success_signal`
- `approval_required`
- `idempotent`

The LLM should not see any tool that is not actually available in the current environment.

## 6. Memory Format

### 6.1 User Memory

Stores persistent user preferences:

- signature
- default approvers
- common recipients
- default language

### 6.2 Org Memory

Stores organizational constants:

- systems
- URLs
- login types
- teams
- templates
- shift file format

### 6.3 Workflow Memory

Stores reusable business logic:

- step definitions
- checklists
- policies
- timeout rules

### 6.4 Case Memory

Stores current business instance:

- workflow id
- current state
- current step
- verified facts
- completed steps
- expectations
- linked artifacts

## 7. Planning Output Format

Each turn should produce a minimal planner output:

```yaml
planner_output:
  objective: Obtain customs number and continue registration
  current_state: WAITING_EMAIL
  decision:
    - check whether the incoming email matches expectation EXP-01
    - extract customs number if present
    - stay waiting if not present
  next_action:
    tool: extract_email_fields
    input:
      fields:
        - customs_number
  requires_approval: false
  expected_transition: READY
```

One turn should choose exactly one actionable next step.

## 8. Approval Context Format

```yaml
approval_context:
  required: true
  action_type: send_outlook_mail
  preview:
    subject: "[CASE-2026-0041] 통관번호 요청"
    recipients:
      to:
        - vendor@example.com
    body_markdown: |
      ...
  checklist:
    - recipient_verified
    - deadline_included
    - case_id_included
```

Approval UI should display:

- preview
- checklist pass/fail
- policy reason
- resulting side effects

## 9. Execution Loop

Recommended loop:

1. Load case memory
2. Load workflow step
3. Collect observation
4. Run checklist engine
5. Build planner prompt
6. Select one tool action
7. Execute tool
8. Validate result
9. Patch memory
10. Transition state
11. Stop on `WAITING_*`, `APPROVAL_REQUIRED`, `COMPLETED`, or `FAILED`

## 10. Page-Agent Style Harnessing

The web harness should follow these rules:

- extract a reduced DOM view
- assign stable indexes to interactive elements
- include scroll hints and page position
- surface only allowed custom tools
- block arbitrary JS execution by default

This keeps the web layer bounded:

- read website through harness
- plan from structured page state
- act only via registered tools

That is the correct operating model for internal systems.
