import test from "node:test";
import assert from "node:assert/strict";

import { OutlookWorker } from "./index.js";

test("outlook worker drafts, sends, reads, replies, previews, and watches replies", async () => {
  const worker = new OutlookWorker();

  const draft = await worker.execute({
    request_id: "TR-1",
    case_id: "CASE-1",
    step_id: "request_customs_number",
    tool_name: "draft_outlook_mail",
    mode: "draft",
    input: {
      template_id: "request_customs_number",
      to: ["vendor@example.com"],
      cc: [],
      variables: {}
    }
  });

  assert.equal(draft.success, true);
  assert.ok(draft.output.draft_id);

  const send = await worker.execute({
    request_id: "TR-2",
    case_id: "CASE-1",
    step_id: "request_customs_number",
    tool_name: "send_outlook_mail",
    mode: "commit",
    input: {
      draft_id: draft.output.draft_id
    }
  });

  assert.equal(send.success, true);
  assert.ok(send.output.conversation_id);
  assert.ok(send.output.message_id);

  const readMail = await worker.execute({
    request_id: "TR-READ-1",
    case_id: "CASE-1",
    step_id: "read_mail",
    tool_name: "read_outlook_mail",
    mode: "preview",
    input: {
      entry_id: send.output.message_id
    }
  });

  assert.equal(readMail.success, true);
  assert.equal(readMail.output.artifact_kind, "mail_detail");
  assert.equal(readMail.output.entry_id, send.output.message_id);

  const readConversation = await worker.execute({
    request_id: "TR-CONV-1",
    case_id: "CASE-1",
    step_id: "read_conversation",
    tool_name: "read_outlook_conversation",
    mode: "preview",
    input: {
      conversation_id: send.output.conversation_id
    }
  });

  assert.equal(readConversation.success, true);
  assert.equal(readConversation.output.artifact_kind, "mail_conversation");
  assert.ok(Array.isArray(readConversation.output.messages));

  const reply = await worker.execute({
    request_id: "TR-REPLY-1",
    case_id: "CASE-1",
    step_id: "reply_mail",
    tool_name: "reply_outlook_mail",
    mode: "draft",
    input: {
      conversation_id: send.output.conversation_id,
      body_text: "확인했습니다."
    }
  });

  assert.equal(reply.success, true);
  assert.equal(reply.output.artifact_kind, "mail_draft");
  assert.ok(reply.output.draft_id);

  const updateDraft = await worker.execute({
    request_id: "TR-UPD-1",
    case_id: "CASE-1",
    step_id: "update_draft",
    tool_name: "update_outlook_draft",
    mode: "draft",
    input: {
      draft_id: reply.output.draft_id,
      subject: "Re: updated",
      body_text: "본문 수정"
    }
  });

  assert.equal(updateDraft.success, true);
  assert.equal(updateDraft.output.subject, "Re: updated");

  const previewDraft = await worker.execute({
    request_id: "TR-PREV-1",
    case_id: "CASE-1",
    step_id: "preview_draft",
    tool_name: "preview_outlook_draft",
    mode: "preview",
    input: {
      draft_id: reply.output.draft_id
    }
  });

  assert.equal(previewDraft.success, true);
  assert.equal(previewDraft.output.artifact_kind, "mail_draft_preview");
  assert.equal(previewDraft.output.subject, "Re: updated");

  const watch = await worker.execute({
    request_id: "TR-3",
    case_id: "CASE-1",
    step_id: "request_customs_number",
    tool_name: "watch_email_reply",
    mode: "preview",
    input: {
      conversation_id: send.output.conversation_id
    }
  });

  assert.equal(watch.success, true);
  assert.equal(watch.output.expectation_registered, true);

  const search = await worker.execute({
    request_id: "TR-4",
    case_id: "CASE-1",
    step_id: "search_mail",
    tool_name: "search_outlook_mail",
    mode: "preview",
    input: {
      keyword: "ae school",
      max_results: 10
    }
  });

  assert.equal(search.success, true);
  assert.equal(search.output.artifact_kind, "mail_search");
  assert.equal(search.output.keyword, "ae school");
  assert.ok(Array.isArray(search.output.messages));
});
