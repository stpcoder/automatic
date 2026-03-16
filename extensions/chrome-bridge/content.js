(async function () {
  if (window.top !== window) {
    return;
  }

  if (window.__SKH_AGENT_EXTENSION_ACTIVE__) {
    return;
  }

  const config = await chrome.runtime.sendMessage({ type: "skh:get-config" });
  if (!config?.enabled || !config?.serverOrigin || !config?.tabId) {
    return;
  }

  const bootstrapResponse = await fetch(`${config.serverOrigin}/bridge/extension-bootstrap`).catch(() => null);
  if (!bootstrapResponse || !bootstrapResponse.ok) {
    return;
  }

  const bootstrap = await bootstrapResponse.json();
  const system = matchSystem(location.href, bootstrap.systems ?? []);
  if (!system) {
    return;
  }

  window.__SKH_AGENT_EXTENSION_ACTIVE__ = true;
  const sessionId = `ext-tab-${config.tabId}`;
  const pollMs = Number(config.pollMs || 1000);
  const observationChangeTimeoutMs = Number(config.observationChangeTimeoutMs || 4000);

  function normalize(value) {
    return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  }

  function slugify(value) {
    return normalize(value).replace(/[^a-z0-9가-힣]+/g, "_").replace(/^_+|_+$/g, "") || "field";
  }

  function getLabelText(element) {
    if (element.getAttribute("aria-label")) {
      return element.getAttribute("aria-label");
    }
    if (element.id) {
      const label = document.querySelector(`label[for="${element.id}"]`);
      if (label?.textContent) {
        return label.textContent.trim();
      }
    }
    const parentLabel = element.closest("label");
    if (parentLabel?.textContent) {
      return parentLabel.textContent.trim();
    }
    return element.getAttribute("placeholder") || element.name || element.id || "";
  }

  function resolveSemanticKey(element) {
    const candidates = [
      getLabelText(element),
      element.name,
      element.id,
      element.getAttribute("aria-label"),
      element.getAttribute("placeholder"),
      element.innerText,
      element.textContent
    ].map(normalize);

    for (const field of system.fields || []) {
      const aliases = [field.key, field.label].concat(field.aliases || []).map(normalize);
      if (aliases.some((alias) => candidates.includes(alias))) {
        return field.key;
      }
    }

    return slugify(getLabelText(element));
  }

  function getPageText() {
    const raw = document.body?.innerText ?? "";
    return raw.replace(/\s+/g, " ").trim().slice(0, 4000);
  }

  function buildObservation() {
    const controls = Array.from(document.querySelectorAll("input, textarea, select, button"))
      .filter((element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      })
      .map((element, index) => {
        const tagName = element.tagName.toLowerCase();
        const type =
          tagName === "button" || element.type === "submit" || element.type === "button"
            ? "button"
            : tagName === "select"
              ? "select"
              : "input";
        return {
          index,
          type,
          key: resolveSemanticKey(element),
          label: getLabelText(element) || element.innerText || element.textContent || "Field",
          value: "value" in element ? element.value || "" : "",
          required: element.hasAttribute("required") || element.getAttribute("aria-required") === "true"
        };
      });

    const pageText = getPageText();
    return {
      channel: "web",
      summary: `${document.title} observed through chrome extension. ${pageText.slice(0, 200)}`,
      payload: {
        systemId: system.system_id,
        pageId: "live_page",
        url: location.href,
        title: document.title,
        pageText,
        interactiveElements: controls,
        finalActionButton: system.final_action_button
      }
    };
  }

  function observationSignature() {
    return [location.href, document.title, getPageText().slice(0, 200)].join("|");
  }

  async function registerSession() {
    await fetch(`${config.serverOrigin}/bridge/sessions/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        system_id: system.system_id,
        title: document.title,
        url: location.href
      })
    });
  }

  async function pushObservation() {
    await fetch(`${config.serverOrigin}/bridge/sessions/${sessionId}/snapshot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildObservation())
    });
  }

  async function pullCommands() {
    const response = await fetch(`${config.serverOrigin}/bridge/sessions/${sessionId}/commands`);
    return response.json();
  }

  async function completeCommand(commandId, success, result, error) {
    await fetch(`${config.serverOrigin}/bridge/sessions/${sessionId}/commands/${commandId}/result`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ success, result, error })
    });
  }

  function findControlForKey(key) {
    return Array.from(document.querySelectorAll("input, textarea, select")).find(
      (control) => resolveSemanticKey(control) === key
    );
  }

  function setControlValue(control, value) {
    control.focus();
    control.value = value;
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function resolveButtonCandidates(targetKey) {
    const normalizedTarget = normalize(targetKey);
    const matched = (system.buttons || []).find((button) =>
      [button.key, button.label].concat(button.aliases || []).map(normalize).includes(normalizedTarget)
    );
    return matched ? [matched.label].concat(matched.aliases || []).map(normalize) : [normalizedTarget];
  }

  function clickTarget(targetKey) {
    const candidates = resolveButtonCandidates(targetKey);
    const buttons = Array.from(document.querySelectorAll("button, input[type='submit'], input[type='button'], a"));
    const target = buttons.find((button) => {
      const text = normalize(button.innerText || button.textContent || button.value);
      return candidates.includes(text) || normalize(resolveSemanticKey(button)) === normalize(targetKey);
    });
    if (!target) {
      throw new Error(`Clickable element not found: ${targetKey}`);
    }
    target.click();
  }

  async function waitForObservationChange(previousSignature) {
    const started = Date.now();
    while (Date.now() - started < observationChangeTimeoutMs) {
      await sleep(250);
      if (observationSignature() !== previousSignature) {
        return;
      }
    }
  }

  async function handleCommand(command) {
    if (command.type === "fill") {
      const values = command.payload.field_values || {};
      for (const [key, rawValue] of Object.entries(values)) {
        const control = findControlForKey(key);
        if (control) {
          setControlValue(control, String(rawValue));
        }
      }
      await completeCommand(command.command_id, true, { observation: buildObservation().payload });
      return;
    }

    if (command.type === "click" || command.type === "submit") {
      const targetKey =
        command.type === "submit"
          ? String(command.payload.expected_button || system.final_action_button || "submit")
          : String(command.payload.target_key || "");
      const previousSignature = observationSignature();
      await completeCommand(command.command_id, true, {
        accepted: true,
        target_key: targetKey
      });
      clickTarget(targetKey);
      await waitForObservationChange(previousSignature);
      return;
    }
  }

  while (true) {
    try {
      await registerSession();
      await pushObservation();
      const commands = await pullCommands();
      for (const command of commands) {
        try {
          await handleCommand(command);
        } catch (error) {
          await completeCommand(command.command_id, false, {}, error instanceof Error ? error.message : String(error));
        }
      }
    } catch (_error) {
      // no-op: avoid noisy console output in user pages
    }

    await sleep(pollMs);
  }
})();

function matchSystem(url, systems) {
  return systems.find((system) => (system.url_patterns || []).some((pattern) => matchesUrlPattern(url, pattern)));
}

function matchesUrlPattern(url, pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(url);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
