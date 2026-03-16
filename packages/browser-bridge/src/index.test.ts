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

test("browser bridge can follow navigation to a child session", async () => {
  const coordinator = new BrowserBridgeCoordinator();
  coordinator.registerSession({
    session_id: "parent-session",
    system_id: "naver_search",
    title: "NAVER",
    url: "https://www.naver.com"
  });

  coordinator.updateObservation("parent-session", {
    channel: "web",
    summary: "Naver search page",
    payload: {
      sessionId: "parent-session",
      systemId: "naver_search",
      title: "NAVER",
      url: "https://www.naver.com"
    }
  });

  setTimeout(() => {
    coordinator.registerSession({
      session_id: "child-session",
      parent_session_id: "parent-session",
      system_id: "naver_stock",
      title: "SK hynix : 네이버페이 증권",
      url: "https://finance.naver.com/item/main.naver?code=000660"
    });
    coordinator.updateObservation("child-session", {
      channel: "web",
      summary: "Stock page",
      payload: {
        sessionId: "child-session",
        parentSessionId: "parent-session",
        systemId: "naver_stock",
        title: "SK hynix : 네이버페이 증권",
        url: "https://finance.naver.com/item/main.naver?code=000660"
      }
    });
  }, 10);

  const followed = await coordinator.waitForNavigation("parent-session", 500);
  assert.equal(followed.session.session_id, "child-session");
  assert.equal(followed.session.parent_session_id, "parent-session");
});
