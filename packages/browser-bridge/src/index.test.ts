import test from "node:test";
import assert from "node:assert/strict";

import { BrowserBridgeCoordinator } from "./index.js";

test("browser bridge registers sessions and observations", async () => {
  const coordinator = new BrowserBridgeCoordinator();
  coordinator.registerSession({
    session_id: "session-1",
    system_id: "security_portal",
    title: "Security",
    url: "https://security.internal"
  });

  coordinator.updateObservation("session-1", {
    channel: "web",
    summary: "Security export registration form is open.",
    payload: {
      title: "Export Registration",
      url: "https://security.internal/export-registration",
      interactiveElements: []
    }
  });

  const observation = await coordinator.waitForObservation("security_portal", 100);
  assert.equal(observation.payload.title, "Export Registration");
});

test("browser bridge completes queued commands", async () => {
  const coordinator = new BrowserBridgeCoordinator();
  coordinator.registerSession({
    session_id: "session-2",
    system_id: "dhl"
  });

  const command = coordinator.enqueueCommand("dhl", "fill", { field_values: { customs_number: "GB-1" } });
  const pending = coordinator.pullPendingCommands("session-2");
  assert.equal(pending.length, 1);
  assert.equal(pending[0].command_id, command.command_id);

  coordinator.completeCommand("session-2", command.command_id, {
    success: true,
    result: { updated: true }
  });

  const result = await coordinator.waitForCommandResult("dhl", command.command_id, 100);
  assert.equal(result.status, "completed");
});
