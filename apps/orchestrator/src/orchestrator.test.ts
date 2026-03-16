import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { OrchestratorService } from "./orchestrator.js";
import { SqliteStore } from "./sqlite-store.js";
import { WorkflowRegistry } from "../../../packages/workflow-registry/src/index.js";
import { CompositeToolExecutor } from "./tool-executors.js";

test("shipment workflow pauses for approval and resumes on email reply", async () => {
  const orchestrator = await OrchestratorService.createDefault();
  const record = orchestrator.createCase({
    workflow_id: "overseas_equipment_shipment",
    facts: {
      case_id: "CASE-TEST-001",
      traveler_name: "Kim",
      destination_country: "Germany",
      equipment_list: [{ serial_number: "SN123", asset_tag: "AT-001" }],
      vendor_email: "vendor@example.com",
      due_date: "2026-03-20",
      receiver_address: "Berlin Office"
    }
  });

  const firstAdvance = await orchestrator.advanceCase(record.case_id);
  assert.equal(firstAdvance.caseRecord.state, "DRAFT_READY");

  const secondAdvance = await orchestrator.advanceCase(record.case_id);
  assert.equal(secondAdvance.caseRecord.state, "APPROVAL_REQUIRED");
  assert.ok(secondAdvance.approval);

  orchestrator.applyApprovalDecision(secondAdvance.approval!.approval_id, {
    decision: "approve",
    actor: "tester@example.com"
  });

  const thirdAdvance = await orchestrator.advanceCase(record.case_id);
  assert.equal(thirdAdvance.caseRecord.state, "WAITING_EMAIL");
  assert.ok(thirdAdvance.expectation);

  const resumed = orchestrator.ingestIncomingEmail(record.case_id, {
    sender: "vendor@example.com",
    subject: "Re: customs number",
    conversation_id: thirdAdvance.expectation!.matcher.conversation_id,
    extracted_fields: {
      customs_number: "GB-8839-22"
    }
  });
  assert.equal(resumed.caseRecord.state, "READY");
  assert.equal(resumed.caseRecord.facts.customs_number, "GB-8839-22");

  const fourthAdvance = await orchestrator.advanceCase(record.case_id);
  assert.equal(fourthAdvance.caseRecord.current_step_id, "register_security_portal");
  assert.equal(fourthAdvance.caseRecord.state, "DRAFT_READY");
});

test("approval rejection moves the case to failed", async () => {
  const orchestrator = await OrchestratorService.createDefault();
  const record = orchestrator.createCase({
    workflow_id: "overseas_equipment_shipment",
    facts: {
      case_id: "CASE-TEST-REJECT",
      traveler_name: "Kim",
      destination_country: "Germany",
      equipment_list: [{ serial_number: "SN123", asset_tag: "AT-001" }],
      vendor_email: "vendor@example.com",
      due_date: "2026-03-20",
      receiver_address: "Berlin Office"
    }
  });

  await orchestrator.advanceCase(record.case_id);
  const approvalStep = await orchestrator.advanceCase(record.case_id);
  assert.ok(approvalStep.approval);

  orchestrator.applyApprovalDecision(approvalStep.approval!.approval_id, {
    decision: "reject",
    actor: "tester@example.com"
  });

  assert.equal(orchestrator.getCase(record.case_id).state, "FAILED");
});

test("unmatched email does not resume the waiting case", async () => {
  const orchestrator = await OrchestratorService.createDefault();
  const record = orchestrator.createCase({
    workflow_id: "overseas_equipment_shipment",
    facts: {
      case_id: "CASE-TEST-IGNORE",
      traveler_name: "Kim",
      destination_country: "Germany",
      equipment_list: [{ serial_number: "SN123", asset_tag: "AT-001" }],
      vendor_email: "vendor@example.com",
      due_date: "2026-03-20",
      receiver_address: "Berlin Office"
    }
  });

  await orchestrator.advanceCase(record.case_id);
  const approvalStep = await orchestrator.advanceCase(record.case_id);
  orchestrator.applyApprovalDecision(approvalStep.approval!.approval_id, {
    decision: "approve",
    actor: "tester@example.com"
  });
  const waitingStep = await orchestrator.advanceCase(record.case_id);
  assert.equal(waitingStep.caseRecord.state, "WAITING_EMAIL");

  const unmatched = orchestrator.ingestIncomingEmail(record.case_id, {
    sender: "other@example.com",
    subject: "Re: customs number",
    conversation_id: "OTHER-CONV",
    extracted_fields: {
      customs_number: "GB-8839-22"
    }
  });

  assert.equal(unmatched.action, "email_ignored");
  assert.equal(orchestrator.getCase(record.case_id).state, "WAITING_EMAIL");
});

test("security portal step also requires approval before submit", async () => {
  const orchestrator = await OrchestratorService.createDefault();
  const record = orchestrator.createCase({
    workflow_id: "overseas_equipment_shipment",
    facts: {
      case_id: "CASE-TEST-WEB",
      traveler_name: "Kim",
      destination_country: "Germany",
      equipment_list: [{ serial_number: "SN123", asset_tag: "AT-001" }],
      vendor_email: "vendor@example.com",
      due_date: "2026-03-20",
      receiver_address: "Berlin Office"
    }
  });

  await orchestrator.advanceCase(record.case_id);
  const vendorApproval = await orchestrator.advanceCase(record.case_id);
  orchestrator.applyApprovalDecision(vendorApproval.approval!.approval_id, {
    decision: "approve",
    actor: "tester@example.com"
  });
  const waitingStep = await orchestrator.advanceCase(record.case_id);
  const resumed = orchestrator.ingestIncomingEmail(record.case_id, {
    sender: "vendor@example.com",
    subject: "Re: customs number",
    conversation_id: waitingStep.expectation!.matcher.conversation_id,
    extracted_fields: {
      customs_number: "GB-8839-22"
    }
  });
  assert.equal(resumed.caseRecord.current_step_id, "register_security_portal");

  const draftSecurity = await orchestrator.advanceCase(record.case_id);
  assert.equal(draftSecurity.caseRecord.state, "DRAFT_READY");
  assert.equal(draftSecurity.caseRecord.current_step_id, "register_security_portal");

  const approveSecurity = await orchestrator.advanceCase(record.case_id);
  assert.equal(approveSecurity.caseRecord.state, "APPROVAL_REQUIRED");
  assert.equal(approveSecurity.approval?.action_type, "submit_web_form");
});

test("sqlite store persists cases across orchestrator instances", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "skh-agent-sqlite-"));
  const dbPath = path.join(tempDir, "orchestrator.sqlite");
  const registry = await WorkflowRegistry.fromExampleDirectory(path.resolve(process.cwd(), "examples"));

  const first = new OrchestratorService(new SqliteStore(dbPath), {
    registry,
    toolExecutor: new CompositeToolExecutor()
  });

  const created = first.createCase({
    workflow_id: "overseas_equipment_shipment",
    facts: {
      case_id: "CASE-SQLITE-001",
      traveler_name: "Kim",
      destination_country: "Germany",
      equipment_list: [{ serial_number: "SN123", asset_tag: "AT-001" }],
      vendor_email: "vendor@example.com",
      due_date: "2026-03-20",
      receiver_address: "Berlin Office"
    }
  });

  await first.advanceCase(created.case_id);

  const second = new OrchestratorService(new SqliteStore(dbPath), {
    registry,
    toolExecutor: new CompositeToolExecutor()
  });

  const loaded = second.getCase(created.case_id);
  assert.equal(loaded.case_id, created.case_id);
  assert.equal(loaded.current_step_id, "request_customs_number");
  assert.equal(loaded.state, "DRAFT_READY");

  rmSync(tempDir, { recursive: true, force: true });
});
