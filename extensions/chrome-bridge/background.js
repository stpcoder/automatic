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

  return false;
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== TASK_ALARM_NAME) {
    return;
  }
  await processPendingTasks();
});

async function processPendingTasks() {
  const config = await chrome.storage.local.get(DEFAULT_CONFIG);
  if (!config.enabled || !config.serverOrigin) {
    return;
  }

  const tasksResponse = await fetch(`${config.serverOrigin}/bridge/extension/tasks`, {
    cache: "no-store"
  }).catch(() => null);
  if (!tasksResponse || !tasksResponse.ok) {
    return;
  }

  const tasks = await tasksResponse.json();
  for (const task of tasks) {
    await handleTask(config.serverOrigin, task).catch(async (error) => {
      await fetch(`${config.serverOrigin}/bridge/extension/tasks/${task.task_id}/result`, {
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
  await fetch(`${serverOrigin}/bridge/extension/tasks/${task.task_id}/result`, {
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
