import test from "node:test";
import assert from "node:assert/strict";

import { OrchestratorService } from "./orchestrator.js";

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
