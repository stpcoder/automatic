import test from "node:test";
import assert from "node:assert/strict";

import { browserBridgeCoordinator } from "../../../packages/browser-bridge/src/index.js";

import { ExtensionBridgeAdapter } from "./extension-bridge-adapter.js";

test("extension adapter opens a new tab for an explicit target url even when a current session is provided", async () => {
  browserBridgeCoordinator.reset();

  browserBridgeCoordinator.registerSession({
    session_id: "session-naver",
    system_id: "web_generic",
    title: "NAVER",
    url: "https://www.naver.com"
  });
  browserBridgeCoordinator.updateObservation("session-naver", {
    channel: "web",
    summary: "네이버 메인 페이지",
    payload: {
      sessionId: "session-naver",
      systemId: "web_generic",
      pageId: "generic_page",
      title: "NAVER",
      url: "https://www.naver.com",
      summary: "네이버 메인 페이지",
      interactiveElements: []
    }
  });

  const adapter = new ExtensionBridgeAdapter();
  const openPromise = adapter.openSystem("web_generic", undefined, {
    sessionId: "session-naver",
    targetUrl: "https://www.google.com",
    urlContains: "google.com",
    titleContains: "Google",
    openIfMissing: true
  });

  await new Promise((resolve) => setTimeout(resolve, 20));

  const tasks = browserBridgeCoordinator.listBrowserTasks();
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0]?.type, "open_tab");
  assert.equal(tasks[0]?.payload.url, "https://www.google.com");

  browserBridgeCoordinator.registerSession({
    session_id: "session-google",
    parent_session_id: "session-naver",
    system_id: "web_generic",
    title: "Google",
    url: "https://www.google.com"
  });
  browserBridgeCoordinator.updateObservation("session-google", {
    channel: "web",
    summary: "Google 검색 페이지",
    payload: {
      sessionId: "session-google",
      parentSessionId: "session-naver",
      systemId: "web_generic",
      pageId: "generic_search_home",
      title: "Google",
      url: "https://www.google.com",
      summary: "Google 검색 페이지",
      interactiveElements: []
    }
  });

  const observation = await openPromise;
  assert.equal(observation.sessionId, "session-google");
  assert.equal(observation.parentSessionId, "session-naver");
  assert.equal(observation.url, "https://www.google.com");
  assert.equal(observation.title, "Google");
});

test("extension adapter opens a new tab for an explicit target url without requiring a pinned current session", async () => {
  browserBridgeCoordinator.reset();

  const adapter = new ExtensionBridgeAdapter();
  const openPromise = adapter.openSystem("web_generic", undefined, {
    targetUrl: "https://www.google.com",
    urlContains: "google.com",
    titleContains: "Google",
    openIfMissing: true
  });

  await new Promise((resolve) => setTimeout(resolve, 20));

  const tasks = browserBridgeCoordinator.listBrowserTasks();
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0]?.type, "open_tab");
  assert.equal(tasks[0]?.payload.url, "https://www.google.com");

  browserBridgeCoordinator.registerSession({
    session_id: "session-google",
    system_id: "web_generic",
    title: "Google",
    url: "https://www.google.com"
  });
  browserBridgeCoordinator.updateObservation("session-google", {
    channel: "web",
    summary: "Google 검색 페이지",
    payload: {
      sessionId: "session-google",
      systemId: "web_generic",
      pageId: "generic_search_home",
      title: "Google",
      url: "https://www.google.com",
      summary: "Google 검색 페이지",
      interactiveElements: []
    }
  });

  const observation = await openPromise;
  assert.equal(observation.sessionId, "session-google");
  assert.equal(observation.url, "https://www.google.com");
  assert.equal(observation.title, "Google");
});
