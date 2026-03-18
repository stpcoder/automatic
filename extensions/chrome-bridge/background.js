const DEFAULT_CONFIG = {
  enabled: true,
  serverOrigin: "http://127.0.0.1:43117",
  pollMs: 1000,
  observationChangeTimeoutMs: 4000,
  showPointerOverlay: true,
  pointerMoveDurationMs: 450,
  pointerClickDurationMs: 260
};

const TASK_ALARM_NAME = "skh-agent-task-poll";
const TASK_POLL_MINUTES = 0.02;

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(DEFAULT_CONFIG);
  await chrome.storage.local.set({ ...DEFAULT_CONFIG, ...current });
  chrome.alarms.create(TASK_ALARM_NAME, { periodInMinutes: TASK_POLL_MINUTES });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(TASK_ALARM_NAME, { periodInMinutes: TASK_POLL_MINUTES });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") {
    return false;
  }

  if (message.type === "skh:get-config") {
    chrome.storage.local.get(DEFAULT_CONFIG).then((config) => {
      sendResponse({
        ...DEFAULT_CONFIG,
        ...config,
        tabId: sender.tab?.id ?? null,
        openerTabId: sender.tab?.openerTabId ?? null
      });
    });
    return true;
  }

  if (message.type === "skh:set-config") {
    chrome.storage.local.set(message.payload ?? {}).then(async () => {
      const updated = await chrome.storage.local.get(DEFAULT_CONFIG);
      sendResponse(updated);
    });
    return true;
  }

  if (message.type === "skh:process-tasks") {
    processPendingTasks()
      .then(() => sendResponse({ ok: true }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        })
      );
    return true;
  }

  if (message.type === "skh:bridge-bootstrap") {
    withConfig((config) => bridgeFetchJson(config.serverOrigin, "/bridge/extension-bootstrap"))
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        })
      );
    return true;
  }

  if (message.type === "skh:bridge-register-session") {
    withConfig((config) =>
      bridgeFetchJson(config.serverOrigin, "/bridge/sessions/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message.payload ?? {})
      })
    )
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        })
      );
    return true;
  }

  if (message.type === "skh:bridge-push-observation") {
    const sessionId = String(message.sessionId || "");
    withConfig((config) =>
      bridgeFetchJson(config.serverOrigin, `/bridge/sessions/${encodeURIComponent(sessionId)}/snapshot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message.payload ?? {})
      })
    )
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        })
      );
    return true;
  }

  if (message.type === "skh:bridge-pull-commands") {
    const sessionId = String(message.sessionId || "");
    withConfig((config) =>
      bridgeFetchJson(config.serverOrigin, `/bridge/sessions/${encodeURIComponent(sessionId)}/commands`)
    )
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        })
      );
    return true;
  }

  if (message.type === "skh:bridge-complete-command") {
    const sessionId = String(message.sessionId || "");
    const commandId = String(message.commandId || "");
    withConfig((config) =>
      bridgeFetchJson(
        config.serverOrigin,
        `/bridge/sessions/${encodeURIComponent(sessionId)}/commands/${encodeURIComponent(commandId)}/result`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(message.payload ?? {})
        }
      )
    )
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        })
      );
    return true;
  }

  return false;
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== TASK_ALARM_NAME) {
    return;
  }
  await processPendingTasks();
});

chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo) => {
  if (changeInfo.status === "complete") {
    await processPendingTasks().catch(() => null);
  }
});

async function processPendingTasks() {
  const config = await chrome.storage.local.get(DEFAULT_CONFIG);
  if (!config.enabled || !config.serverOrigin) {
    return;
  }

  const tasks = await bridgeFetchJson(config.serverOrigin, "/bridge/extension/tasks").catch(() => null);
  if (!tasks) {
    return;
  }
  for (const task of tasks) {
    await handleTask(config.serverOrigin, task).catch(async (error) => {
      await bridgeFetchJson(config.serverOrigin, `/bridge/extension/tasks/${task.task_id}/result`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error)
        })
      }).catch(() => null);
    });
  }
}

async function handleTask(serverOrigin, task) {
  if (task.type !== "open_tab") {
    return;
  }

  const url = typeof task.payload?.url === "string" ? task.payload.url : "";
  if (!url) {
    throw new Error("open_tab task missing url");
  }

  const tab = await chrome.tabs.create({ url, active: true });
  await bridgeFetchJson(serverOrigin, `/bridge/extension/tasks/${task.task_id}/result`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      success: true,
      result: {
        tabId: tab.id ?? null,
        url
      }
    })
  });
}

async function withConfig(handler) {
  const config = await chrome.storage.local.get(DEFAULT_CONFIG);
  if (!config.enabled || !config.serverOrigin) {
    throw new Error("Extension bridge is disabled or server origin is missing");
  }
  return handler(config);
}

async function bridgeFetchJson(serverOrigin, path, init = {}) {
  const response = await fetch(`${serverOrigin}${path}`, {
    cache: "no-store",
    ...init
  }).catch((error) => {
    throw new Error(error instanceof Error ? error.message : String(error));
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Bridge request failed (${response.status} ${response.statusText}): ${text}`.trim());
  }

  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
