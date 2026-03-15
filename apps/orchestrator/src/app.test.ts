import test from "node:test";
import assert from "node:assert/strict";

import { createApp } from "./app.js";

test("http api creates, advances, approves, and resumes a shipment case", async () => {
  const app = await createApp();

  const createResponse = await app.inject({
    method: "POST",
    url: "/cases",
    payload: {
      workflow_id: "overseas_equipment_shipment",
      facts: {
        case_id: "CASE-API-001",
        traveler_name: "Kim",
        destination_country: "Germany",
        equipment_list: [{ serial_number: "SN123", asset_tag: "AT-001" }],
        vendor_email: "vendor@example.com",
        due_date: "2026-03-20",
        receiver_address: "Berlin Office"
      }
    }
  });

  assert.equal(createResponse.statusCode, 201);
  const created = createResponse.json();
  const caseId = created.case_id as string;

  const firstAdvance = await app.inject({
    method: "POST",
    url: `/cases/${caseId}/advance`
  });
  assert.equal(firstAdvance.statusCode, 200);
  assert.equal(firstAdvance.json().caseRecord.state, "DRAFT_READY");

  const secondAdvance = await app.inject({
    method: "POST",
    url: `/cases/${caseId}/advance`
  });
  const approvalId = secondAdvance.json().approval.approval_id as string;
  assert.equal(secondAdvance.json().caseRecord.state, "APPROVAL_REQUIRED");

  const approveResponse = await app.inject({
    method: "POST",
    url: `/approvals/${approvalId}/decision`,
    payload: {
      decision: "approve",
      actor: "tester@example.com"
    }
  });
  assert.equal(approveResponse.statusCode, 200);

  const thirdAdvance = await app.inject({
    method: "POST",
    url: `/cases/${caseId}/advance`
  });
  assert.equal(thirdAdvance.json().caseRecord.state, "WAITING_EMAIL");
  const conversationId = thirdAdvance.json().expectation.matcher.conversation_id as string;

  const emailResponse = await app.inject({
    method: "POST",
    url: `/cases/${caseId}/events/email`,
    payload: {
      sender: "vendor@example.com",
      subject: "Re: customs number",
      conversation_id: conversationId,
      extracted_fields: {
        customs_number: "GB-8839-22"
      }
    }
  });
  assert.equal(emailResponse.json().caseRecord.current_step_id, "register_security_portal");
  assert.equal(emailResponse.json().caseRecord.facts.customs_number, "GB-8839-22");

  await app.close();
});
