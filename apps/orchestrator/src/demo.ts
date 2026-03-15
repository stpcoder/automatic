import { OrchestratorService } from "./orchestrator.js";

async function main(): Promise<void> {
  const orchestrator = await OrchestratorService.createDefault();

  const record = orchestrator.createCase({
    workflow_id: "overseas_equipment_shipment",
    facts: {
      case_id: "CASE-DEMO-001",
      traveler_name: "Kim",
      destination_country: "Germany",
      equipment_list: [{ serial_number: "SN123", asset_tag: "AT-001" }],
      vendor_email: "vendor@example.com",
      due_date: "2026-03-20",
      receiver_address: "Berlin Office"
    }
  });

  console.log("CASE_CREATED", record);

  let result = await orchestrator.advanceCase(record.case_id);
  console.log("STEP_1", result);

  result = await orchestrator.advanceCase(record.case_id);
  console.log("STEP_2", result);

  const approval = result.approval ?? orchestrator.listApprovals(record.case_id)[0];
  if (!approval) {
    throw new Error("Expected approval to exist");
  }

  const approved = orchestrator.applyApprovalDecision(approval.approval_id, {
    decision: "approve",
    actor: "operator@example.com"
  });
  console.log("APPROVED", approved);

  result = await orchestrator.advanceCase(record.case_id);
  console.log("STEP_3", result);

  result = orchestrator.ingestIncomingEmail(record.case_id, {
    sender: "vendor@example.com",
    subject: "[CASE-DEMO-001] Re: 통관번호 요청",
    conversation_id: String(result.expectation?.matcher.conversation_id ?? orchestrator.listArtifacts(record.case_id).find((artifact) => artifact.kind === "sent_mail")?.metadata.conversation_id),
    extracted_fields: {
      customs_number: "GB-8839-22"
    }
  });
  console.log("EMAIL_RESUME", result);

  result = await orchestrator.advanceCase(record.case_id);
  console.log("STEP_4", result);

  const finalState = orchestrator.getCase(record.case_id);
  console.log("FINAL_CASE", finalState);
}

await main();
