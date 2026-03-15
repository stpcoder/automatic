# Decision Checklist

## 1. Decisions Needed Before Coding

These decisions should be confirmed before the first implementation sprint.

## 2. Product and Runtime

- Is `UiPath Automation Suite / Orchestrator` approved?
- If not, what replaces robot scheduling, worker control, and approvals?
- Will Windows workers run on VMs, shared desktops, or dedicated robots?

## 3. Outlook

- Is `Classic Outlook` available in production?
- If not, is `Microsoft 365 / Graph` allowed?
- What mailbox scope will the worker monitor?
- What are the retention and audit requirements for sent mail drafts and previews?

## 4. Cube

- Is there an official API or bot framework?
- If not, is Cube web-based or Windows desktop?
- Are incoming message events required, or is send-only enough for v1?

## 5. Web Systems

- Which systems are in v1?
- Which systems can be automated by DOM-first harness?
- Which systems need Playwright fallback?
- Which systems have approval-sensitive final buttons?

## 6. LLM

- What exact endpoint shape does the internal API support?
- Does it support function/tool calling?
- What context length is safe?
- What timeout and retry budgets are acceptable?

## 7. Security and Governance

- Where are credentials stored?
- Who can approve external sends?
- What audit artifacts must be retained?
- Which actions are strictly blocked from autonomous commit?

## 8. Workflow Authoring

- Who owns workflow YAML changes?
- Who owns templates and contacts?
- Who approves checklist changes?

## 9. V1 Boundary

For the first implementation, confirm:

- shipment workflow only or shipment + sample intake
- Outlook only or Outlook + Cube
- preview only or full commit after approval
