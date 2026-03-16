import test from "node:test";
import assert from "node:assert/strict";

import { browserBridgeCoordinator } from "../../../packages/browser-bridge/src/index.js";
import { CubeWorker } from "./index.js";

async function waitForPendingCommand(sessionId: string, timeoutMs = 1000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const pending = browserBridgeCoordinator.pullPendingCommands(sessionId);
    if (pending.length > 0) {
      return pending[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for pending command on ${sessionId}`);
}

test("cube worker drafts and sends messages", async () => {
  const worker = new CubeWorker();
  const draft = await worker.execute({
    request_id: "TR-1",
    case_id: "CASE-1",
    step_id: "notify_current_assignee",
    tool_name: "draft_cube_message",
    mode: "draft",
    input: {
      recipient: "operator-a"
    }
  });

  assert.equal(draft.success, true);
  assert.ok(draft.output.draft_id);

  const send = await worker.execute({
    request_id: "TR-2",
    case_id: "CASE-1",
    step_id: "notify_current_assignee",
    tool_name: "send_cube_message",
    mode: "commit",
    input: {
      draft_id: draft.output.draft_id
    }
  });

  assert.equal(send.success, true);
  assert.ok(send.output.message_id);
});

test("cube worker can send through extension bridge", async () => {
  process.env.CUBE_WORKER_ADAPTER = "extension_bridge";
  browserBridgeCoordinator.registerSession({
    session_id: "cube-session",
    system_id: "cube",
    title: "Cube",
    url: "https://cube.internal/chat"
  });
  browserBridgeCoordinator.updateObservation("cube-session", {
    channel: "web",
    summary: "Cube chat is ready.",
    payload: {
      title: "Cube Messenger",
      url: "https://cube.internal/chat",
      interactiveElements: [],
      finalActionButton: "Send"
    }
  });

  const worker = new CubeWorker();
  const draft = await worker.execute({
    request_id: "TR-3",
    case_id: "CASE-2",
    step_id: "notify_current_assignee",
    tool_name: "draft_cube_message",
    mode: "draft",
    input: {
      recipient: "operator-a",
      body: "Message body"
    }
  });

  const sendPromise = worker.execute({
    request_id: "TR-4",
    case_id: "CASE-2",
    step_id: "notify_current_assignee",
    tool_name: "send_cube_message",
    mode: "commit",
    input: {
      draft_id: draft.output.draft_id
    }
  });

  const fillCommand = await waitForPendingCommand("cube-session");
  browserBridgeCoordinator.completeCommand("cube-session", fillCommand.command_id, {
    success: true,
    result: {}
  });

  const submitCommand = await waitForPendingCommand("cube-session");
  browserBridgeCoordinator.completeCommand("cube-session", submitCommand.command_id, {
    success: true,
    result: {}
  });

  const send = await sendPromise;
  assert.equal(send.success, true);
  assert.ok(send.output.message_id);

  delete process.env.CUBE_WORKER_ADAPTER;
});
