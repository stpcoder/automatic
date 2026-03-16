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

  window.__SKH_AGENT_EXTENSION_ACTIVE__ = true;
  const sessionId = `ext-tab-${config.tabId}`;
  const parentSessionId = config.openerTabId ? `ext-tab-${config.openerTabId}` : undefined;
  const pollMs = Number(config.pollMs || 1000);
  const observationChangeTimeoutMs = Number(config.observationChangeTimeoutMs || 4000);
  const pointerMoveDurationMs = Number(config.pointerMoveDurationMs || 450);
  const pointerClickDurationMs = Number(config.pointerClickDurationMs || 260);
  const showPointerOverlay = Boolean(config.showPointerOverlay);
  const overlayState = createPointerOverlay();
  let system = null;
  let bootstrapWaitLogged = false;
  let systemWaitLogged = false;

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

    for (const field of system?.fields || []) {
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
        sessionId,
        parentSessionId,
        systemId: system?.system_id ?? "unknown",
        pageId: "live_page",
        url: location.href,
        title: document.title,
        pageText,
        interactiveElements: controls,
        finalActionButton: system?.final_action_button ?? "Submit"
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
        parent_session_id: parentSessionId,
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
    animateInteraction(control, "type").catch(() => undefined);
    control.focus();
    control.value = value;
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function resolveButtonCandidates(targetKey) {
    const normalizedTarget = normalize(targetKey);
    const matched = (system?.buttons || []).find((button) =>
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
    return animateInteraction(target, "click").then(() => {
      target.click();
      return target;
    });
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
          ? String(command.payload.expected_button || system?.final_action_button || "submit")
          : String(command.payload.target_key || "");
      const previousSignature = observationSignature();
      await completeCommand(command.command_id, true, {
        accepted: true,
        target_key: targetKey
      });
      await clickTarget(targetKey);
      await waitForObservationChange(previousSignature);
      return;
    }
  }

  function createPointerOverlay() {
    if (!showPointerOverlay || document.getElementById("__skh-agent-pointer__")) {
      return {
        pointer: document.getElementById("__skh-agent-pointer__"),
        label: document.getElementById("__skh-agent-pointer-label__")
      };
    }

    const pointer = document.createElement("div");
    pointer.id = "__skh-agent-pointer__";
    pointer.style.position = "fixed";
    pointer.style.left = "0";
    pointer.style.top = "0";
    pointer.style.width = "28px";
    pointer.style.height = "28px";
    pointer.style.borderRadius = "999px";
    pointer.style.background = "radial-gradient(circle at 35% 35%, rgba(255,255,255,0.95), rgba(35,84,255,0.9))";
    pointer.style.boxShadow = "0 10px 30px rgba(35,84,255,0.35)";
    pointer.style.border = "2px solid rgba(255,255,255,0.95)";
    pointer.style.transform = "translate(-50%, -50%) scale(0.75)";
    pointer.style.opacity = "0";
    pointer.style.pointerEvents = "none";
    pointer.style.transition = "opacity 180ms ease, transform 180ms ease";
    pointer.style.zIndex = "2147483647";

    const label = document.createElement("div");
    label.id = "__skh-agent-pointer-label__";
    label.style.position = "fixed";
    label.style.left = "0";
    label.style.top = "0";
    label.style.padding = "6px 10px";
    label.style.borderRadius = "999px";
    label.style.background = "rgba(17,24,39,0.88)";
    label.style.color = "#fff";
    label.style.font = "12px/1.2 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif";
    label.style.transform = "translate(18px, -10px)";
    label.style.opacity = "0";
    label.style.pointerEvents = "none";
    label.style.transition = "opacity 180ms ease";
    label.style.zIndex = "2147483647";

    document.documentElement.appendChild(pointer);
    document.documentElement.appendChild(label);
    return { pointer, label };
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function animateInteraction(element, mode) {
    if (!showPointerOverlay || !overlayState.pointer || !overlayState.label) {
      if (typeof element.scrollIntoView === "function") {
        element.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
        await sleep(220);
      }
      return;
    }

    if (typeof element.scrollIntoView === "function") {
      element.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      await sleep(220);
    }

    const rect = element.getBoundingClientRect();
    const pointer = overlayState.pointer;
    const label = overlayState.label;
    const targetX = rect.left + rect.width / 2;
    const targetY = rect.top + Math.min(Math.max(rect.height / 2, 16), Math.max(rect.height - 8, 16));
    const caption = mode === "click" ? "click" : "type";
    label.textContent = caption;
    label.style.left = `${targetX}px`;
    label.style.top = `${targetY}px`;
    label.style.opacity = "1";
    pointer.style.opacity = "1";
    pointer.style.transform = "translate(-50%, -50%) scale(1)";
    pointer.animate(
      [
        { left: pointer.style.left || "32px", top: pointer.style.top || "32px" },
        { left: `${targetX}px`, top: `${targetY}px` }
      ],
      {
        duration: pointerMoveDurationMs,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        fill: "forwards"
      }
    );
    pointer.style.left = `${targetX}px`;
    pointer.style.top = `${targetY}px`;
    await sleep(pointerMoveDurationMs);

    if (mode === "click") {
      const ripple = document.createElement("div");
      ripple.style.position = "fixed";
      ripple.style.left = `${targetX}px`;
      ripple.style.top = `${targetY}px`;
      ripple.style.width = "18px";
      ripple.style.height = "18px";
      ripple.style.borderRadius = "999px";
      ripple.style.border = "2px solid rgba(35,84,255,0.85)";
      ripple.style.background = "rgba(35,84,255,0.12)";
      ripple.style.transform = "translate(-50%, -50%) scale(0.8)";
      ripple.style.pointerEvents = "none";
      ripple.style.zIndex = "2147483647";
      document.documentElement.appendChild(ripple);
      ripple.animate(
        [
          { transform: "translate(-50%, -50%) scale(0.8)", opacity: 0.95 },
          { transform: "translate(-50%, -50%) scale(2.2)", opacity: 0 }
        ],
        {
          duration: pointerClickDurationMs,
          easing: "ease-out",
          fill: "forwards"
        }
      );
      pointer.animate(
        [
          { transform: "translate(-50%, -50%) scale(1)" },
          { transform: "translate(-50%, -50%) scale(0.88)" },
          { transform: "translate(-50%, -50%) scale(1)" }
        ],
        {
          duration: pointerClickDurationMs,
          easing: "ease-out"
        }
      );
      await sleep(pointerClickDurationMs);
      ripple.remove();
    } else {
      await sleep(100);
    }

    label.style.opacity = "0";
  }

  async function fetchBootstrap() {
    const response = await fetch(`${config.serverOrigin}/bridge/extension-bootstrap`, {
      cache: "no-store"
    }).catch(() => null);
    if (!response || !response.ok) {
      return null;
    }

    return response.json();
  }

  async function ensureActiveSystem() {
    while (true) {
      const bootstrap = await fetchBootstrap();
      if (!bootstrap) {
        if (!bootstrapWaitLogged) {
          bootstrapWaitLogged = true;
          console.info("[skh-agent-extension] waiting for local agent server", config.serverOrigin);
        }
        await sleep(Math.max(pollMs, 1500));
        continue;
      }

      bootstrapWaitLogged = false;
      const matchedSystem = matchSystem(location.href, bootstrap.systems ?? []);
      if (!matchedSystem) {
        if (!systemWaitLogged) {
          systemWaitLogged = true;
          console.info("[skh-agent-extension] waiting for supported page", location.href);
        }
        await sleep(Math.max(pollMs, 1500));
        continue;
      }

      systemWaitLogged = false;
      return matchedSystem;
    }
  }

  while (true) {
    try {
      system = await ensureActiveSystem();
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
