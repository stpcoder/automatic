const defaults = {
  enabled: true,
  serverOrigin: "http://127.0.0.1:43117",
  pollMs: 1000,
  observationChangeTimeoutMs: 4000
};

const serverOrigin = document.getElementById("serverOrigin");
const pollMs = document.getElementById("pollMs");
const observationChangeTimeoutMs = document.getElementById("observationChangeTimeoutMs");
const enabled = document.getElementById("enabled");
const status = document.getElementById("status");

chrome.storage.local.get(defaults).then((config) => {
  serverOrigin.value = config.serverOrigin;
  pollMs.value = String(config.pollMs);
  observationChangeTimeoutMs.value = String(config.observationChangeTimeoutMs);
  enabled.checked = Boolean(config.enabled);
});

document.getElementById("save").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({
    type: "skh:set-config",
    payload: {
      serverOrigin: serverOrigin.value.trim(),
      pollMs: Number(pollMs.value || defaults.pollMs),
      observationChangeTimeoutMs: Number(observationChangeTimeoutMs.value || defaults.observationChangeTimeoutMs),
      enabled: enabled.checked
    }
  });
  status.textContent = "Saved";
  setTimeout(() => {
    status.textContent = "";
  }, 1500);
});
