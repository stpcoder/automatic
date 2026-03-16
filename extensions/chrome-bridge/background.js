const DEFAULT_CONFIG = {
  enabled: true,
  serverOrigin: "http://127.0.0.1:43117",
  pollMs: 1000,
  observationChangeTimeoutMs: 4000
};

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(DEFAULT_CONFIG);
  await chrome.storage.local.set({ ...DEFAULT_CONFIG, ...current });
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
        tabId: sender.tab?.id ?? null
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
