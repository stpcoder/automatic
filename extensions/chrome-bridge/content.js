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

  function getElementTextForKey(element) {
    return (
      getLabelText(element) ||
      element.getAttribute("title") ||
      element.innerText ||
      element.textContent ||
      ("value" in element ? element.value : "") ||
      element.name ||
      element.id ||
      ""
    );
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

    return slugify(getElementTextForKey(element));
  }

  function getPageText() {
    return collectVisibleTextBlocks().join(" ").slice(0, 4000);
  }

  function isVisibleElement(element) {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  }

  function isUtilityText(text) {
    const normalized = normalize(text);
    if (!normalized) {
      return true;
    }
    const utilityMarkers = [
      "바로가기",
      "건너뛰기",
      "skip to",
      "skip navigation",
      "서비스 메뉴",
      "service menu",
      "새소식",
      "news",
      "공지",
      "알림"
    ];
    return utilityMarkers.some((marker) => normalized.includes(marker));
  }

  function isUtilityContainer(element) {
    return Boolean(
      element.closest("header, nav, footer, aside, [role='navigation'], [role='banner'], [data-skip], .skip, .blind, .u_skip")
    );
  }

  function isMainContentContainer(element) {
    return Boolean(
      element.closest("main, article, section, form, [role='main'], [role='search'], [role='dialog'], #content, #container, #wrap")
    );
  }

  function inferRegion(element) {
    if (element.closest("main, article, [role='main'], form, section")) {
      return "main";
    }
    if (element.closest("header, [role='banner']")) {
      return "header";
    }
    if (element.closest("nav, [role='navigation']")) {
      return "nav";
    }
    if (element.closest("footer")) {
      return "footer";
    }
    if (element.closest("aside")) {
      return "aside";
    }
    return "unknown";
  }

  function clampScore(value) {
    return Math.max(0.05, Math.min(0.99, Math.round(value * 100) / 100));
  }

  function isElementNearViewportCenter(element) {
    const rect = element.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    if (viewportHeight <= 0) {
      return true;
    }
    return rect.top < viewportHeight * 0.9 && rect.bottom > viewportHeight * 0.05;
  }

  function shouldIncludeTextElement(element, text) {
    if (!isVisibleElement(element)) {
      return false;
    }
    if (!text || text.length < 2) {
      return false;
    }
    if (isUtilityText(text)) {
      return false;
    }
    if (isUtilityContainer(element) && !isMainContentContainer(element)) {
      return false;
    }
    return isMainContentContainer(element) || isElementNearViewportCenter(element);
  }

  function shouldIncludeInteractiveElement(element) {
    if (!isVisibleElement(element)) {
      return false;
    }

    if (element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true") {
      return false;
    }

    const tagName = element.tagName.toLowerCase();
    const text = String(getElementTextForKey(element)).replace(/\s+/g, " ").trim();
    const structuralContainer = element.closest("form, [role='search'], [role='dialog'], main, article, section");
    const utilityOnly = isUtilityContainer(element) && !isMainContentContainer(element);

    if (utilityOnly) {
      return false;
    }

    if (tagName === "input" || tagName === "textarea" || tagName === "select") {
      return Boolean(structuralContainer || isElementNearViewportCenter(element));
    }

    if (tagName === "button" && !text) {
      const ariaLabel = String(element.getAttribute("aria-label") || "").trim();
      return Boolean(ariaLabel) && (Boolean(structuralContainer) || isElementNearViewportCenter(element));
    }

    if (!text || text.length < 2) {
      return false;
    }
    if (isUtilityText(text)) {
      return false;
    }
    return Boolean(structuralContainer || isElementNearViewportCenter(element));
  }

  function buildDomPath(element) {
    const parts = [];
    let current = element;
    let depth = 0;
    while (current && current.nodeType === Node.ELEMENT_NODE && depth < 5) {
      const tag = current.tagName.toLowerCase();
      if (current.id) {
        parts.unshift(`${tag}#${current.id}`);
        break;
      }
      const parent = current.parentElement;
      if (!parent) {
        parts.unshift(tag);
        break;
      }
      const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
      const index = siblings.indexOf(current) + 1;
      parts.unshift(`${tag}:nth-of-type(${index})`);
      current = parent;
      depth += 1;
    }
    return parts.join(" > ").slice(0, 180);
  }

  function extractNearbyText(element) {
    const candidates = [
      element.closest("form, section, article, li, tr, td, th, div, fieldset"),
      element.parentElement
    ].filter(Boolean);

    for (const candidate of candidates) {
      const text = String(candidate.innerText || candidate.textContent || "").replace(/\s+/g, " ").trim();
      if (text && text.length >= 4 && !isUtilityText(text)) {
        return text.slice(0, 180);
      }
    }
    return "";
  }

  function inferInteractiveSemanticRole(element, type, label, nearbyText) {
    const normalizedLabel = normalize(label);
    const normalizedNearby = normalize(nearbyText);

    if (type === "input" || type === "select") {
      if (/search|검색|찾기|query/.test(normalizedLabel) || /search|검색/.test(normalizedNearby)) {
        return "search_input";
      }
      return "form_field";
    }

    if (type === "link") {
      if (/result|article|detail|상세|기사|바로가기|go to|read more/.test(normalizedLabel) || /검색 결과|result/.test(normalizedNearby)) {
        return "result_link";
      }
      if (/next|more|자세히|더보기|open|열기/.test(normalizedLabel)) {
        return "detail_link";
      }
      return "navigation_link";
    }

    if (/search|검색|submit|조회|확인|등록|apply|continue|next|send|open|go/.test(normalizedLabel)) {
      return "primary_action";
    }
    if (/close|cancel|dismiss|back|취소|닫기|뒤로/.test(normalizedLabel)) {
      return "secondary_action";
    }
    return "unknown";
  }

  function computeInteractiveImportance(element, type, label, nearbyText) {
    let score = 0.45;
    const normalizedLabel = normalize(label);
    const normalizedNearby = normalize(nearbyText);
    const region = inferRegion(element);

    if (region === "main") {
      score += 0.22;
    }
    if (isElementNearViewportCenter(element)) {
      score += 0.1;
    }
    if (type === "input" || type === "select") {
      score += 0.12;
    }
    if (type === "button") {
      score += 0.08;
    }
    if (element.closest("form, [role='search'], [role='dialog'], article, section, main")) {
      score += 0.08;
    }
    if (/search|검색|submit|조회|확인|등록|price|가격|주가|시세|article|뉴스|headline/.test(normalizedLabel)) {
      score += 0.12;
    }
    if (/search|검색 결과|price|가격|주가|headline|뉴스|result|상품|article/.test(normalizedNearby)) {
      score += 0.06;
    }
    if (isUtilityContainer(element) && !isMainContentContainer(element)) {
      score -= 0.3;
    }
    return clampScore(score);
  }

  function inferBlockType(element, text) {
    const normalized = normalize(text);
    const tagName = element.tagName.toLowerCase();
    if (/[0-9]{1,3}(?:,[0-9]{3})+\s*(krw|원|usd|eur|\$)/i.test(text)) {
      return "price";
    }
    if (tagName === "h1" || tagName === "h2" || tagName === "h3") {
      return "heading";
    }
    if (tagName === "li" || tagName === "a" || /기사|article|headline|검색 결과|result|상품|product/.test(normalized)) {
      return "result_item";
    }
    if (tagName === "label" || /:/.test(text)) {
      return "label_value";
    }
    if (tagName === "form" || element.closest("form, [role='search']")) {
      return "form_area";
    }
    if (text.length <= 120) {
      return "summary";
    }
    return "paragraph";
  }

  function computeBlockImportance(element, text, blockType) {
    let score = 0.4;
    const region = inferRegion(element);

    if (region === "main") {
      score += 0.22;
    }
    if (isElementNearViewportCenter(element)) {
      score += 0.08;
    }
    if (blockType === "heading" || blockType === "price") {
      score += 0.2;
    }
    if (blockType === "result_item" || blockType === "label_value") {
      score += 0.12;
    }
    if (element.closest("article, main, section, form, [role='main'], [role='search']")) {
      score += 0.08;
    }
    if (/검색|search|뉴스|headline|price|가격|주가|시세/.test(normalize(text))) {
      score += 0.08;
    }
    return clampScore(score);
  }

  function collectSemanticBlocksInDomOrder() {
    const primarySelectors = "main h1, main h2, main h3, main h4, main h5, main p, main label, main button, main a, main th, main td, main li, main strong, main b, main [role='button'], main [role='link'], article h1, article h2, article h3, article p, article a, article li, form label, form button, form p, form [role='button'], [role='main'] h1, [role='main'] h2, [role='main'] p, [role='search'] label, [role='search'] button";
    const fallbackSelectors = "h1,h2,h3,h4,h5,p,label,button,a,th,td,li,strong,b,[role='button'],[role='link']";
    const primaryCandidates = Array.from(document.querySelectorAll(primarySelectors));
    const fallbackCandidates = primaryCandidates.length >= 8 ? [] : Array.from(document.querySelectorAll(fallbackSelectors));
    const candidates = [...primaryCandidates, ...fallbackCandidates]
      .map((element) => ({
        element,
        text: String(element.innerText || element.textContent || "").replace(/\s+/g, " ").trim()
      }))
      .filter(({ element, text }) => shouldIncludeTextElement(element, text))
      .map(({ element, text }, index) => {
        const blockType = inferBlockType(element, text);
        return {
          id: `block-${index + 1}`,
          type: blockType,
          text,
          title: /^h[1-3]$/i.test(element.tagName) ? text : undefined,
          region: inferRegion(element),
          importance: computeBlockImportance(element, text, blockType),
          relatedKeys: []
        };
      });

    const unique = [];
    const seen = new Set();
    for (const candidate of candidates) {
      const normalized = normalize(candidate.text);
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      unique.push(candidate);
      if (unique.length >= 40) {
        break;
      }
    }
    return unique;
  }

  function collectSemanticBlocks() {
    return collectSemanticBlocksInDomOrder().slice().sort((left, right) => right.importance - left.importance);
  }

  function collectVisibleTextBlocks() {
    return collectSemanticBlocks().map((block) => block.text);
  }

  function buildInteractiveCandidates() {
    const controls = Array.from(document.querySelectorAll("input, textarea, select, button, a[href], [role='button'], [role='link']"))
      .filter((element) => shouldIncludeInteractiveElement(element))
      .map((element, index) => {
        const tagName = element.tagName.toLowerCase();
        const type =
          tagName === "a"
            ? "link"
            : tagName === "button" || element.type === "submit" || element.type === "button"
            ? "button"
            : tagName === "select"
            ? "select"
            : "input";
        const label = getElementTextForKey(element) || "Field";
        const nearbyText = extractNearbyText(element);
        return {
          element,
          index,
          handle: String(index + 1),
          type,
          key: resolveSemanticKey(element),
          label,
          value: "value" in element ? element.value || "" : "",
          required: element.hasAttribute("required") || element.getAttribute("aria-required") === "true",
          action: type === "input" ? "type" : type === "select" ? "select" : "click",
          href: element instanceof HTMLAnchorElement ? element.href : "",
          region: inferRegion(element),
          semanticRole: inferInteractiveSemanticRole(element, type, label, nearbyText),
          importance: computeInteractiveImportance(element, type, label, nearbyText),
          nearbyText,
          domPath: buildDomPath(element)
        };
      });

    const seen = new Map();
    for (const control of controls) {
      const currentCount = seen.get(control.key) || 0;
      seen.set(control.key, currentCount + 1);
      if (currentCount > 0) {
        control.key = `${control.key}_${currentCount + 1}`;
      }
    }
    return controls;
  }

  function buildDomOutline(controls, orderedBlocks) {
    const blockMap = new Map();
    for (const block of orderedBlocks) {
      const normalizedText = normalize(block.text);
      if (normalizedText && !blockMap.has(normalizedText)) {
        blockMap.set(normalizedText, block);
      }
    }

    const lines = [];
    const seenLines = new Set();
    const outlineSelectors =
      "main h1, main h2, main h3, main p, main label, main button, main a, main li, article h1, article h2, article h3, article p, article a, article li, form label, form input, form textarea, form select, form button, [role='main'] h1, [role='main'] h2, [role='main'] p, [role='search'] input, [role='search'] textarea, [role='search'] button, [role='search'] a";

    const controlMap = new Map(controls.map((control) => [control.element, control]));
    const outlineCandidates = Array.from(document.querySelectorAll(outlineSelectors));

    for (const element of outlineCandidates) {
      if (!isVisibleElement(element)) {
        continue;
      }

      const control = controlMap.get(element);
      if (control) {
        const attrs = [`key=${control.key}`, `type=${control.type}`];
        if (control.semanticRole && control.semanticRole !== "unknown") {
          attrs.push(`role=${control.semanticRole}`);
        }
        const line = `[${control.handle}]<${control.type} ${attrs.join(" ")}>${control.label || control.key} />`;
        if (!seenLines.has(line)) {
          seenLines.add(line);
          lines.push(line);
        }
        if (control.nearbyText && control.nearbyText.length >= 4) {
          const nearbyLine = `  ${control.nearbyText}`;
          if (!seenLines.has(nearbyLine)) {
            seenLines.add(nearbyLine);
            lines.push(nearbyLine);
          }
        }
        continue;
      }

      const text = String(element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
      if (!shouldIncludeTextElement(element, text)) {
        continue;
      }
      const normalizedText = normalize(text);
      const block = blockMap.get(normalizedText);
      const line = block ? block.text : text;
      if (line && !seenLines.has(line)) {
        seenLines.add(line);
        lines.push(line);
      }
      if (lines.length >= 60) {
        break;
      }
    }

    return lines.join("\n").slice(0, 4000);
  }

  function buildObservation() {
    const controls = buildInteractiveCandidates();
    const orderedBlocks = collectSemanticBlocksInDomOrder();
    const semanticBlocks = orderedBlocks.slice().sort((left, right) => right.importance - left.importance);
    const visibleTextBlocks = orderedBlocks.map((block) => block.text);
    const pageText = orderedBlocks.map((block) => block.text).join(" ").slice(0, 4000);
    const domOutline = buildDomOutline(controls, orderedBlocks);
    return {
      channel: "web",
      summary: `${document.title}. ${orderedBlocks
        .slice(0, 5)
        .map((block) => block.text)
        .join(" | ")
        .slice(0, 240)}`,
      payload: {
        sessionId,
        parentSessionId,
        systemId: system?.system_id ?? "unknown",
        pageId: "live_page",
        url: location.href,
        title: document.title,
        pageText,
        domOutline,
        visibleTextBlocks,
        semanticBlocks,
        interactiveElements: controls.map(({ element, ...control }) => control),
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
    return buildInteractiveCandidates().find(
      (candidate) => (candidate.type === "input" || candidate.type === "select") && candidate.key === key
    )?.element;
  }

  function setControlValue(control, value) {
    setAgentState("typing", "typing");
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

  function resolveClickTarget(targetKey, targetHandle) {
    const candidates = resolveButtonCandidates(targetKey);
    const normalizedTargetKey = normalize(targetKey);
    const buttons = buildInteractiveCandidates().filter((candidate) => candidate.type === "button" || candidate.type === "link");
    const resolved =
      buttons.find((candidate) => String(candidate.handle) === String(targetHandle || "")) ||
      buttons.find((candidate) => normalize(candidate.key) === normalizedTargetKey) ||
      buttons.find((candidate) => candidates.includes(normalize(candidate.label)));
    if (!resolved) {
      const available = buttons
        .slice(0, 8)
        .map((candidate) => `${candidate.key}:${candidate.label}`)
        .join(" | ");
      throw new Error(`Clickable element not found: ${targetKey}. Available clickable candidates: ${available}`);
    }
    return resolved;
  }

  function clickTarget(targetKey, targetHandle) {
    const resolved = resolveClickTarget(targetKey, targetHandle);
    const target = resolved.element;
    setAgentState("acting", "click");
    return animateInteraction(target, "click").then(() => {
      simulateClickSequence(target);
      return resolved;
    });
  }

  function dispatchPointerLikeEvent(element, type) {
    try {
      element.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window
        })
      );
    } catch {
      // ignore synthetic event failures and continue
    }
  }

  function simulateClickSequence(element) {
    dispatchPointerLikeEvent(element, "mouseenter");
    dispatchPointerLikeEvent(element, "mouseover");
    dispatchPointerLikeEvent(element, "mousemove");
    dispatchPointerLikeEvent(element, "mousedown");

    if (typeof element.focus === "function") {
      try {
        element.focus({ preventScroll: true });
      } catch {
        try {
          element.focus();
        } catch {
          // ignore focus failures
        }
      }
    }

    dispatchPointerLikeEvent(element, "mouseup");
    dispatchPointerLikeEvent(element, "click");

    if (typeof element.click === "function") {
      try {
        element.click();
      } catch {
        // ignore native click failures after synthetic dispatch
      }
    }
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

    if (command.type === "scroll") {
      const direction = command.payload.direction === "up" ? "up" : "down";
      const amount = typeof command.payload.amount === "number" ? command.payload.amount : 0.75;
      setAgentState("reading", "scroll");
      const delta = Math.max(120, Math.floor(window.innerHeight * amount)) * (direction === "up" ? -1 : 1);
      window.scrollBy({ top: delta, behavior: "smooth" });
      await sleep(450);
      await completeCommand(command.command_id, true, { observation: buildObservation().payload, direction, amount });
      return;
    }

    if (command.type === "click" || command.type === "submit") {
      const targetKey =
        command.type === "submit"
          ? String(command.payload.expected_button || system?.final_action_button || "submit")
          : String(command.payload.target_key || "");
      const targetHandle = String(command.payload.target_handle || "");
      const previousSignature = observationSignature();
      const target = resolveClickTarget(targetKey, targetHandle);
      await completeCommand(command.command_id, true, {
        accepted: true,
        target_key: targetKey,
        target_handle: targetHandle,
        target: {
          handle: target.handle,
          key: target.key,
          label: target.label,
          domPath: target.domPath,
          nearbyText: target.nearbyText
        }
      });
      await clickTarget(targetKey, targetHandle);
      await waitForObservationChange(previousSignature);
      return;
    }
  }

  function removeOverlayElement(id) {
    const element = document.getElementById(id);
    if (element?.parentNode) {
      element.parentNode.removeChild(element);
    }
  }

  function getExistingPointerOverlay() {
    const pointer = document.getElementById("__skh-agent-pointer__");
    const label = document.getElementById("__skh-agent-pointer-label__");
    const halo = document.getElementById("__skh-agent-pointer-halo__");
    const reader = document.getElementById("__skh-agent-reader__");

    if (!pointer && !label && !halo && !reader) {
      return null;
    }

    // Old or partially mounted overlays can survive extension reloads and
    // cause runtime errors when later code assumes every node exists.
    if (!pointer || !label || !halo || !reader) {
      removeOverlayElement("__skh-agent-pointer__");
      removeOverlayElement("__skh-agent-pointer-label__");
      removeOverlayElement("__skh-agent-pointer-halo__");
      removeOverlayElement("__skh-agent-reader__");
      return null;
    }

    return {
      pointer,
      label,
      halo,
      reader,
      state: "idle",
      homeX: 34,
      homeY: 34,
      idleTimer: null
    };
  }

  function createPointerOverlay() {
    if (!showPointerOverlay) {
      return {
        pointer: null,
        label: null,
        halo: null,
        reader: null,
        state: "idle",
        homeX: 34,
        homeY: 34,
        idleTimer: null
      };
    }

    const existingOverlay = getExistingPointerOverlay();
    if (existingOverlay) {
      return existingOverlay;
    }

    const pointer = document.createElement("div");
    pointer.id = "__skh-agent-pointer__";
    pointer.style.position = "fixed";
    pointer.style.left = "0";
    pointer.style.top = "0";
    pointer.style.width = "24px";
    pointer.style.height = "30px";
    pointer.style.transform = "translate(-30%, -18%)";
    pointer.style.opacity = "0.96";
    pointer.style.pointerEvents = "none";
    pointer.style.transition = "opacity 180ms ease, transform 180ms ease, left 180ms ease, top 180ms ease";
    pointer.style.zIndex = "2147483647";
    pointer.innerHTML =
      '<svg viewBox="0 0 24 32" width="24" height="32" aria-hidden="true">' +
      '<path d="M4 2 L4 26 L10 20 L14 29 L18 27 L14 18 L22 18 Z" fill="rgba(255,255,255,0.98)" stroke="rgba(35,84,255,0.95)" stroke-width="1.8" stroke-linejoin="round"/>' +
      "</svg>";

    const halo = document.createElement("div");
    halo.id = "__skh-agent-pointer-halo__";
    halo.style.position = "fixed";
    halo.style.left = "0";
    halo.style.top = "0";
    halo.style.width = "44px";
    halo.style.height = "44px";
    halo.style.borderRadius = "999px";
    halo.style.background = "radial-gradient(circle, rgba(35,84,255,0.22), rgba(35,84,255,0.02) 68%, transparent 72%)";
    halo.style.transform = "translate(-50%, -50%) scale(0.9)";
    halo.style.opacity = "0.72";
    halo.style.pointerEvents = "none";
    halo.style.transition = "opacity 180ms ease, transform 180ms ease, left 180ms ease, top 180ms ease";
    halo.style.zIndex = "2147483646";

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
    label.style.transform = "translate(16px, -12px)";
    label.style.opacity = "0.92";
    label.style.pointerEvents = "none";
    label.style.transition = "opacity 180ms ease";
    label.style.zIndex = "2147483647";
    label.textContent = "reading";

    const reader = document.createElement("div");
    reader.id = "__skh-agent-reader__";
    reader.style.position = "fixed";
    reader.style.left = "0";
    reader.style.top = "0";
    reader.style.width = "72px";
    reader.style.height = "72px";
    reader.style.borderRadius = "999px";
    reader.style.border = "1px solid rgba(35,84,255,0.18)";
    reader.style.background = "conic-gradient(from 0deg, rgba(35,84,255,0.18), rgba(35,84,255,0.02), rgba(35,84,255,0.18))";
    reader.style.transform = "translate(-50%, -50%) scale(0.85)";
    reader.style.opacity = "0.0";
    reader.style.pointerEvents = "none";
    reader.style.zIndex = "2147483645";

    document.documentElement.appendChild(reader);
    document.documentElement.appendChild(halo);
    document.documentElement.appendChild(pointer);
    document.documentElement.appendChild(label);
    const state = { pointer, label, halo, reader, state: "idle", homeX: 34, homeY: 34, idleTimer: null };
    positionOverlay(state, state.homeX, state.homeY);
    startIdleAnimation(state);
    return state;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function animateInteraction(element, mode) {
    if (!showPointerOverlay || !overlayState || !overlayState.pointer || !overlayState.label) {
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
    const halo = overlayState.halo;
    const targetX = rect.left + rect.width / 2;
    const targetY = rect.top + Math.min(Math.max(rect.height / 2, 16), Math.max(rect.height - 8, 16));
    const caption = mode === "click" ? "click" : "type";
    stopIdleAnimation(overlayState);
    label.textContent = caption;
    label.style.left = `${targetX}px`;
    label.style.top = `${targetY}px`;
    label.style.opacity = "1";
    pointer.style.opacity = "1";
    pointer.style.transform = "translate(-30%, -18%) scale(1)";
    if (halo) {
      halo.style.opacity = "0.95";
      halo.style.transform = "translate(-50%, -50%) scale(1)";
    }
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
    positionOverlay(overlayState, targetX, targetY);
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
          { transform: "translate(-50%, -50%) scale(3.1)", opacity: 0 }
        ],
        {
          duration: pointerClickDurationMs + 120,
          easing: "ease-out",
          fill: "forwards"
        }
      );
      pointer.animate(
        [
          { transform: "translate(-30%, -18%) scale(1)" },
          { transform: "translate(-30%, -18%) scale(0.88)" },
          { transform: "translate(-30%, -18%) scale(1)" }
        ],
        {
          duration: pointerClickDurationMs,
          easing: "ease-out"
        }
      );
      await sleep(pointerClickDurationMs);
      ripple.remove();
    } else {
      pointer.animate(
        [
          { transform: "translate(-30%, -18%) scale(1)" },
          { transform: "translate(-30%, -18%) scale(0.96)" },
          { transform: "translate(-30%, -18%) scale(1)" }
        ],
        {
          duration: 240,
          easing: "ease-out"
        }
      );
      await sleep(140);
    }

    setAgentState("reading", "reading");
    startIdleAnimation(overlayState);
  }

  function positionOverlay(state, x, y) {
    if (state.pointer) {
      state.pointer.style.left = `${x}px`;
      state.pointer.style.top = `${y}px`;
    }
    if (state.halo) {
      state.halo.style.left = `${x}px`;
      state.halo.style.top = `${y}px`;
    }
    if (state.reader) {
      state.reader.style.left = `${x}px`;
      state.reader.style.top = `${y}px`;
    }
    if (state.label) {
      state.label.style.left = `${x}px`;
      state.label.style.top = `${y}px`;
    }
  }

  function setOverlayState(state, stateName, caption) {
    if (!showPointerOverlay || !state || !state.pointer || !state.label) {
      return;
    }
    state.state = stateName;
    state.label.textContent = caption;
    state.label.style.opacity = "0.92";
    state.pointer.style.opacity = "0.96";
    if (state.halo) {
      state.halo.style.opacity = stateName === "reading" ? "0.72" : "0.9";
    }
    if (state.reader) {
      state.reader.style.opacity = stateName === "reading" ? "0.35" : "0";
    }
  }

  function setAgentState(stateName, caption) {
    setOverlayState(overlayState, stateName, caption);
  }

  function startIdleAnimation(state) {
    if (!showPointerOverlay || !state || !state.pointer || state.idleTimer) {
      return;
    }
    setOverlayState(
      state,
      state.state === "typing" || state.state === "acting" ? state.state : "reading",
      state.label?.textContent || "reading"
    );
    state.idleTimer = window.setInterval(() => {
      if (!state.pointer) {
        return;
      }
      const driftX = state.state === "reading" ? state.homeX + 2 : state.homeX;
      const driftY = state.state === "reading" ? state.homeY + 1 : state.homeY;
      positionOverlay(state, driftX, driftY);
      state.pointer.animate(
        [
          { transform: "translate(-30%, -18%) scale(1)" },
          { transform: "translate(-30%, -18%) scale(0.97)" },
          { transform: "translate(-30%, -18%) scale(1)" }
        ],
        {
          duration: 1400,
          easing: "ease-in-out"
        }
      );
      if (state.halo) {
        state.halo.animate(
          [
            { transform: "translate(-50%, -50%) scale(0.92)", opacity: 0.55 },
            { transform: "translate(-50%, -50%) scale(1.08)", opacity: 0.82 },
            { transform: "translate(-50%, -50%) scale(0.92)", opacity: 0.55 }
          ],
          {
            duration: 1500,
            easing: "ease-in-out"
          }
        );
      }
      if (state.reader && state.state === "reading") {
        state.reader.animate(
          [
            { transform: "translate(-50%, -50%) scale(0.8) rotate(0deg)", opacity: 0.18 },
            { transform: "translate(-50%, -50%) scale(1.05) rotate(120deg)", opacity: 0.34 },
            { transform: "translate(-50%, -50%) scale(0.8) rotate(240deg)", opacity: 0.18 }
          ],
          {
            duration: 1800,
            easing: "linear"
          }
        );
      }
    }, 1600);
  }

  function stopIdleAnimation(state) {
    if (!state) {
      return;
    }
    if (state.idleTimer) {
      window.clearInterval(state.idleTimer);
      state.idleTimer = null;
    }
    if (state.reader) {
      state.reader.style.opacity = "0";
    }
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
      setAgentState("reading", "reading");
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
      setAgentState("reading", "reading");
      await pushObservation();
      setAgentState("reading", "reading");
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

    setAgentState("reading", "reading");
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
