# Operator Runbook

## 1. Purpose

This document defines how an operator reviews, approves, resumes, and audits cases.

## 2. Daily Operations

Operators should review these queues:

- `APPROVAL_REQUIRED`
- `WAITING_EMAIL`
- `WAITING_CHAT`
- `WAITING_HUMAN`
- `ESCALATED`
- `FAILED`

## 3. Approval Review

Before approving any action, the operator must verify:

- case id is correct
- target system or recipient is correct
- checklist passes
- preview content matches the intended business action
- no unexpected sensitive data is present

## 4. Rework vs Reject

- `request_revision`
  - use when the draft is directionally correct but needs edits
- `reject`
  - use when the action should not happen at all

## 5. Resume Operations

Resume is permitted when:

- a matched event arrives
- an operator manually confirms missing information
- a blocking issue has been corrected

Manual resume should always append an audit event.

## 6. Escalation

Escalate when:

- reminder threshold has passed and no answer arrived
- the external party replied without required fields more than once
- a system is unavailable beyond SLA
- a human task is unconfirmed beyond SLA

## 7. Audit Expectations

Every commit action should log:

- actor
- case id
- action type
- preview snapshot reference
- approval decision
- resulting record id or message id
