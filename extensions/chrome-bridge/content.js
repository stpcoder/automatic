(async function () {
  if (window.top !== window) {
    return;
  }

  if (window.__SKH_AGENT_EXTENSION_ACTIVE__) {
    return;
  }

  let extensionContextInvalidated = false;
  let pointerStateSaveTimer = null;

  function isExtensionContextInvalidatedError(error) {
    const message = error instanceof Error ? error.message : String(error || "");
    return /Extension context invalidated/i.test(message);
  }

  function markExtensionContextInvalidated(error) {
    if (!isExtensionContextInvalidatedError(error)) {
      return false;
    }
    extensionContextInvalidated = true;
    if (pointerStateSaveTimer) {
      window.clearTimeout(pointerStateSaveTimer);
      pointerStateSaveTimer = null;
    }
    return true;
  }

  async function safeSendMessage(message) {
    try {
      return await chrome.runtime.sendMessage(message);
    } catch (error) {
      if (markExtensionContextInvalidated(error)) {
        return null;
      }
      throw error;
    }
  }

  async function callBridge(message) {
    const response = await safeSendMessage(message);
    if (!response || response.ok !== true) {
      throw new Error(response?.error || "Bridge proxy request failed");
    }
    return response.result;
  }

  async function safeStorageGet(keys) {
    try {
      return await chrome.storage.local.get(keys);
    } catch (error) {
      if (markExtensionContextInvalidated(error)) {
        return null;
      }
      throw error;
    }
  }

  async function safeStorageSet(value) {
    try {
      await chrome.storage.local.set(value);
      return;
    } catch (error) {
      if (!markExtensionContextInvalidated(error)) {
        throw error;
      }
    }
  }

  const config = await safeSendMessage({ type: "skh:get-config" });
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

  function compactText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
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

  function getLinkHost(element) {
    const href = element instanceof HTMLAnchorElement ? element.href : "";
    if (!href) {
      return "";
    }
    try {
      return new URL(href, location.href).host.toLowerCase();
    } catch {
      return "";
    }
  }

  function isSocialOrVideoHost(host) {
    return /(youtube\.com|youtu\.be|instagram\.com|facebook\.com|x\.com|twitter\.com|tiktok\.com|linkedin\.com|threads\.net)/i.test(host);
  }

  function hasResultLikeContext(text) {
    return /검색 결과|result|article|headline|뉴스|기사|주가|가격|시세|product|quote|detail/i.test(normalize(text));
  }

  function hasProductLikeContext(text) {
    return /(product|상품|판매처|구매|쇼핑|스토어|무료배송|할인|리뷰|옵션|장바구니|price|가격|krw|원|ssd|ram|tb|gb|hynix|memory)/i.test(normalize(text));
  }

  function hasMetricLikeContext(text) {
    return /(현재가|전일대비|전일가|시가|고가|저가|거래량|거래대금|시가총액|가격|price|quote|volume|market cap|from)/i.test(normalize(text));
  }

  function hasCardLikeContext(text) {
    return hasResultLikeContext(text) || hasProductLikeContext(text) || hasMetricLikeContext(text);
  }

  function hasArticleLikeContext(text) {
    return /(언론사|기자|뉴스|기사|headline|article|published|updated|minutes ago|hours ago|일 전|시간 전)/i.test(normalize(text));
  }

  function hasChipLikeContext(text) {
    return /(정렬|sort|필터|filter|카테고리|category|주제|topic|태그|tag|옵션|option|전체|all|낮은 가격순|높은 가격순|리뷰 많은순|리뷰 좋은순|등록일순|인기순|최신순|관련 검색|연관 검색)/i.test(
      normalize(text)
    );
  }

  function countMetadataSignals(text) {
    const compact = compactText(text);
    if (!compact) {
      return 0;
    }
    let score = 0;
    if (/[+\-]?\s*[0-9][0-9,.\s]*(?:원|krw|usd|eur|달러|백만|억|%|퍼센트)/i.test(compact)) {
      score += 1;
    }
    if (/(무료배송|배송비|delivery|shipping)/i.test(compact)) {
      score += 1;
    }
    if (/(리뷰|review|평점|rating|별점)/i.test(compact)) {
      score += 1;
    }
    if (/(판매처|seller|merchant|store|shop|스토어|공식몰|스마트스토어|brand)/i.test(compact)) {
      score += 1;
    }
    if (/(분 전|시간 전|일 전|month|months|day|days|hour|hours|published|updated)/i.test(compact)) {
      score += 1;
    }
    return score;
  }

  function isLikelyUtilityLink(text, href) {
    const normalized = normalize(text);
    const normalizedHref = normalize(href);
    return /(도움말|help|privacy|약관|login|로그인|가입|공지|센터|서비스 더보기|더보기|option|옵션|설정)/i.test(normalized) ||
      /(help|privacy|policy|login|signin|signup|account)/i.test(normalizedHref);
  }

  function isLikelyChipOrFilterLink(text, href, containerText) {
    const compact = compactText(text);
    const normalizedHref = normalize(href);
    const surrounding = compactText(containerText);
    if (!compact) {
      return false;
    }
    if (compact.length <= 24 && hasChipLikeContext(compact)) {
      return true;
    }
    if (compact.length <= 20 && /^[\w가-힣.+#&/-]+$/.test(compact) && countMetadataSignals(surrounding) === 0) {
      if (normalizedHref.includes("query=") || normalizedHref.includes("search?")) {
        return true;
      }
    }
    return false;
  }

  function isLikelyRefinementLink(element, href) {
    if (!(element instanceof HTMLAnchorElement) || !href) {
      return false;
    }
    try {
      const currentUrl = new URL(location.href);
      const targetUrl = new URL(href, location.href);
      if (currentUrl.origin !== targetUrl.origin) {
        return false;
      }
      if (currentUrl.pathname !== targetUrl.pathname) {
        return false;
      }
      const currentQuery = currentUrl.searchParams.toString();
      const targetQuery = targetUrl.searchParams.toString();
      return currentQuery !== targetQuery;
    } catch {
      return false;
    }
  }

  function getRepeatingSiblingCount(container) {
    if (!(container instanceof HTMLElement) || !container.parentElement) {
      return 0;
    }
    const tagName = container.tagName;
    return Array.from(container.parentElement.children).filter((child) => {
      return child instanceof HTMLElement && child.tagName === tagName && isVisibleElement(child);
    }).length;
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
    const tagName = element.tagName.toLowerCase();
    if ((tagName === "div" || tagName === "span" || tagName === "em" || tagName === "small") && !isSemanticLeafTextElement(element, text)) {
      return false;
    }
    return isMainContentContainer(element) || isElementNearViewportCenter(element);
  }

  function isSemanticLeafTextElement(element, text) {
    const normalized = normalize(text);
    const meaningfulChildren = Array.from(element.children).filter((child) => {
      if (!(child instanceof HTMLElement) || !isVisibleElement(child)) {
        return false;
      }
      const childText = String(child.innerText || child.textContent || "").replace(/\s+/g, " ").trim();
      return childText.length >= 2 && !isUtilityText(childText);
    });

    if (/[0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?\s*(krw|원|usd|eur|\$)?/i.test(text)) {
      return true;
    }
    if (/(현재가|주가|시세|가격|price|quote|headline|뉴스|article)/i.test(normalized)) {
      return true;
    }
    if (meaningfulChildren.length === 0) {
      return text.length <= 220;
    }
    if (meaningfulChildren.length === 1) {
      const childText = String(meaningfulChildren[0].innerText || meaningfulChildren[0].textContent || "").replace(/\s+/g, " ").trim();
      if (normalize(childText) === normalized) {
        return false;
      }
    }
    return text.length <= 80 && meaningfulChildren.length <= 2;
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
    const nearbyText = extractNearbyText(element);
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
    if (tagName === "a") {
      const host = getLinkHost(element);
      const iconLike = text.length <= 3 && !/[가-힣a-z0-9]{2,}/i.test(text);
      if (isSocialOrVideoHost(host) && !hasResultLikeContext(nearbyText)) {
        return false;
      }
      if (iconLike && !hasResultLikeContext(nearbyText)) {
        return false;
      }
      if (isMainContentContainer(element) && hasCardLikeContext(`${text} ${nearbyText}`)) {
        return true;
      }
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
      element.closest("article, li, [role='listitem'], section, main"),
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

  function findCardContainer(element) {
    const candidates = [
      element.closest("article"),
      element.closest("[role='listitem']"),
      element.closest("li"),
      element.closest("section"),
      element.closest("div")
    ].filter(Boolean);

    for (const candidate of candidates) {
      if (!(candidate instanceof HTMLElement) || !isVisibleElement(candidate)) {
        continue;
      }
      if (isUtilityContainer(candidate) && !isMainContentContainer(candidate)) {
        continue;
      }
      const text = compactText(candidate.innerText || candidate.textContent || "");
      if (text.length < 12 || text.length > 800) {
        continue;
      }
      if (!hasCardLikeContext(text)) {
        continue;
      }
      if (candidate.tagName.toLowerCase() === "div") {
        const linkCount = candidate.querySelectorAll("a[href]").length;
        const childCount = candidate.children.length;
        if (linkCount > 10 && countMetadataSignals(text) === 0) {
          continue;
        }
        if (childCount <= 1 && countMetadataSignals(text) === 0) {
          continue;
        }
      }
      return candidate;
    }
    return null;
  }

  function isStructuredCardContainer(container) {
    if (!(container instanceof HTMLElement)) {
      return false;
    }
    const tagName = container.tagName.toLowerCase();
    if (tagName === "article" || tagName === "li" || container.getAttribute("role") === "listitem") {
      return true;
    }
    if (container.closest("p")) {
      return false;
    }
    const childCount = container.children.length;
    const linkCount = container.querySelectorAll("a[href]").length;
    const text = compactText(container.innerText || container.textContent || "");
    const repeatingSiblings = getRepeatingSiblingCount(container);
    return (childCount >= 2 && linkCount >= 1 && countMetadataSignals(text) > 0) || repeatingSiblings >= 3;
  }

  function extractCardTitle(control, container) {
    const heading = container?.querySelector("h1, h2, h3, h4, strong, b");
    const headingText = compactText(heading?.innerText || heading?.textContent || "");
    if (headingText && headingText.length >= 4 && headingText.length <= 140) {
      return headingText;
    }
    return compactText(control.label).slice(0, 140);
  }

  function extractCardSummary(title, containerText) {
    if (!containerText) {
      return "";
    }
    const cleaned = compactText(containerText).replace(title, "").trim();
    return cleaned.slice(0, 220);
  }

  function extractCardMetrics(containerText) {
    const matches = compactText(containerText).match(/[+\-]?\s*[0-9][0-9,.\s]*(?:원|krw|usd|eur|달러|백만|억|%|퍼센트)/gi) || [];
    return matches.slice(0, 3).join(" | ");
  }

  function scorePrimaryCardLink(control, containerText) {
    let score = Number(control.importance || 0.5);
    const normalizedLabel = normalize(control.label);
    const normalizedNearby = normalize(containerText || control.nearbyText || "");
    if (control.semanticRole === "result_link") {
      score += 0.35;
    }
    if (control.semanticRole === "detail_link") {
      score += 0.2;
    }
    if (hasArticleLikeContext(`${normalizedLabel} ${normalizedNearby}`)) {
      score += 0.15;
    }
    if (countMetadataSignals(normalizedNearby) > 0) {
      score += 0.15;
    }
    if (normalizedLabel.length <= 2) {
      score -= 0.25;
    }
    if (isLikelyChipOrFilterLink(control.label, control.href, containerText)) {
      score -= 0.5;
    }
    if (isLikelyRefinementLink(control.element, control.href) && countMetadataSignals(containerText) === 0) {
      score -= 0.45;
    }
    return score;
  }

  function buildContainerKey(container, control) {
    if (container instanceof HTMLElement) {
      return `container:${buildDomPath(container)}`;
    }
    return `link:${normalize(control.href || control.key || control.label)}`;
  }

  function inferInteractiveSemanticRole(element, type, label, nearbyText) {
    const normalizedLabel = normalize(label);
    const normalizedNearby = normalize(nearbyText);
    const host = getLinkHost(element);

    if (type === "input" || type === "select") {
      if (/search|검색|찾기|query/.test(normalizedLabel) || /search|검색/.test(normalizedNearby)) {
        return "search_input";
      }
      return "form_field";
    }

    if (type === "link") {
      if (isSocialOrVideoHost(host)) {
        return "navigation_link";
      }
      if (
        /result|article|detail|상세|기사|바로가기|go to|read more/.test(normalizedLabel) ||
        /검색 결과|result/.test(normalizedNearby) ||
        hasProductLikeContext(`${normalizedLabel} ${normalizedNearby}`)
      ) {
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
    const host = getLinkHost(element);

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
    if (/search|검색 결과|price|가격|주가|headline|뉴스|result|상품|article/.test(normalizedNearby) || hasProductLikeContext(normalizedNearby)) {
      score += 0.06;
    }
    if (type === "link" && hasProductLikeContext(`${normalizedLabel} ${normalizedNearby}`)) {
      score += 0.12;
    }
    if (type === "link" && isSocialOrVideoHost(host)) {
      score -= 0.28;
    }
    if (type === "link" && !hasResultLikeContext(normalizedNearby) && /instagram|youtube|facebook|x|twitter|tiktok/i.test(normalizedLabel)) {
      score -= 0.2;
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
    if (/(현재가|주가|시세|가격|price|quote)/i.test(normalized)) {
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
      score += 0.28;
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
    const primarySelectors = "main h1, main h2, main h3, main h4, main h5, main p, main label, main button, main a, main th, main td, main li, main strong, main b, main em, main span, main div, main [role='button'], main [role='link'], article h1, article h2, article h3, article p, article a, article li, article strong, article em, article span, article div, section h1, section h2, section h3, section p, section a, section li, section span, section div, form label, form button, form p, form span, form div, form [role='button'], [role='main'] h1, [role='main'] h2, [role='main'] p, [role='main'] span, [role='main'] div, [role='search'] label, [role='search'] button, [role='search'] span";
    const fallbackSelectors = "h1,h2,h3,h4,h5,p,label,button,a,th,td,li,strong,b,em,span,div,[role='button'],[role='link']";
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
      if (unique.length >= 60) {
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

  function extractKeyMetrics(orderedBlocks) {
    const metrics = [];
    const seen = new Set();

    function pushMetric(label, value, options = {}) {
      const cleanLabel = compactText(label).replace(/[:：]$/, "");
      const cleanValue = compactText(value);
      if (!cleanLabel || !cleanValue) {
        return;
      }
      const dedupeKey = `${normalize(cleanLabel)}|${normalize(cleanValue)}`;
      if (seen.has(dedupeKey)) {
        return;
      }
      seen.add(dedupeKey);
      metrics.push({
        label: cleanLabel,
        value: cleanValue,
        unit: options.unit,
        context: options.context ? compactText(options.context).slice(0, 120) : undefined,
        importance: options.importance || 0.7
      });
    }

    const definitionLists = Array.from(document.querySelectorAll("dl"));
    for (const list of definitionLists) {
      if (!isVisibleElement(list)) {
        continue;
      }
      const terms = Array.from(list.querySelectorAll("dt"));
      for (const term of terms) {
        const label = compactText(term.innerText || term.textContent || "");
        const valueNode = term.nextElementSibling;
        const value = valueNode ? compactText(valueNode.innerText || valueNode.textContent || "") : "";
        if (label && value && (hasMetricLikeContext(label) || /[0-9]/.test(value))) {
          pushMetric(label, value, {
            importance: hasMetricLikeContext(label) ? 0.94 : 0.76,
            context: compactText(list.innerText || list.textContent || "")
          });
        }
      }
    }

    const tableRows = Array.from(document.querySelectorAll("table tr"));
    for (const row of tableRows) {
      if (!isVisibleElement(row)) {
        continue;
      }
      const header = row.querySelector("th");
      const cells = Array.from(row.querySelectorAll("td"));
      const label = compactText(header?.innerText || header?.textContent || "");
      const value = compactText(cells[0]?.innerText || cells[0]?.textContent || "");
      if (label && value && (hasMetricLikeContext(label) || /[0-9]/.test(value))) {
        pushMetric(label, value, {
          importance: hasMetricLikeContext(label) ? 0.92 : 0.74,
          context: compactText(row.innerText || row.textContent || "")
        });
      }
    }

    const metricPattern = /(현재가|전일대비|전일가|시가|고가|저가|거래량|거래대금|시가총액(?:\(억\))?|price|quote|volume|market cap|from)\s*[:：]?\s*([+\-]?\s*[0-9][0-9,.\s]*(?:원|krw|usd|eur|달러|백만|억|%|퍼센트)?)/gi;
    for (const block of orderedBlocks) {
      if (!block || typeof block.text !== "string") {
        continue;
      }
      let match;
      while ((match = metricPattern.exec(block.text)) !== null) {
        pushMetric(match[1], match[2], {
          importance: Math.max(0.8, Number(block.importance || 0.7)),
          context: block.text
        });
      }
    }

    return metrics
      .sort((left, right) => Number(right.importance || 0) - Number(left.importance || 0))
      .slice(0, 12);
  }

  function inferActionableCardType(control, nearbyText) {
    const normalizedNearby = normalize(nearbyText);
    const normalizedLabel = normalize(control.label);
    const combined = `${normalizedLabel} ${normalizedNearby}`;
    if (/뉴스|기사|article|headline|기자|언론사/.test(combined) || hasArticleLikeContext(combined)) {
      return "article";
    }
    if (/product|제품|모델|구입|쇼핑|compare|비교/.test(combined) || hasProductLikeContext(combined)) {
      return "product";
    }
    if (/quote|price|현재가|주가|시세|거래량/.test(combined)) {
      return "metric_panel";
    }
    if (control.semanticRole === "result_link") {
      return "search_result";
    }
    return "generic";
  }

  function extractCardSource(text) {
    const compact = compactText(text);
    if (!compact) {
      return "";
    }
    const newsMatch = compact.match(/([가-힣A-Za-z0-9·&.\-]+)\s+\d+(?:분|시간|일|주|개월|month|months|day|days|hour|hours)/i);
    if (newsMatch) {
      return newsMatch[1];
    }
    const publisherMatch = compact.match(/(연합뉴스|노컷뉴스|파이낸셜뉴스|한국경제|조선비즈|매일경제|Reuters|Bloomberg|Apple)/i);
    if (publisherMatch) {
      return publisherMatch[1];
    }
    return "";
  }

  function buildActionableCards(controls) {
    const grouped = new Map();
    for (const control of controls) {
      if (
        control.type !== "link" ||
        !control.href ||
        control.href.startsWith("javascript:") ||
        isLikelyUtilityLink(control.label, control.href)
      ) {
        continue;
      }

      const container = findCardContainer(control.element);
      const containerText = compactText(container?.innerText || container?.textContent || "");
      const nearbyText = containerText || control.nearbyText || "";
      if (isLikelyChipOrFilterLink(control.label, control.href, nearbyText)) {
        continue;
      }
      if (isLikelyRefinementLink(control.element, control.href) && countMetadataSignals(nearbyText) === 0) {
        continue;
      }
      const promote =
        control.semanticRole === "result_link" ||
        control.semanticRole === "detail_link" ||
        hasResultLikeContext(`${control.label} ${nearbyText}`) ||
        hasProductLikeContext(`${control.label} ${nearbyText}`) ||
        hasMetricLikeContext(`${control.label} ${nearbyText}`);
      if (!promote) {
        continue;
      }
      const metadataSignals = countMetadataSignals(nearbyText);
      if (!isStructuredCardContainer(container) && metadataSignals === 0 && !hasArticleLikeContext(nearbyText)) {
        continue;
      }
      const groupKey = buildContainerKey(container, control);
      const entry = grouped.get(groupKey) || { container, containerText: nearbyText, controls: [] };
      entry.controls.push(control);
      grouped.set(groupKey, entry);
    }

    const cards = [];
    const seen = new Set();
    for (const entry of grouped.values()) {
      const control = entry.controls
        .slice()
        .sort((left, right) => scorePrimaryCardLink(right, entry.containerText) - scorePrimaryCardLink(left, entry.containerText))[0];
      if (!control) {
        continue;
      }
      const title = extractCardTitle(control, entry.container);
      if (!title) {
        continue;
      }
      if (isLikelyChipOrFilterLink(title, control.href, entry.containerText) && countMetadataSignals(entry.containerText) === 0) {
        continue;
      }
      const metrics = extractCardMetrics(entry.containerText);
      const summary = extractCardSummary(title, entry.containerText);
      const dedupeKey = normalize(control.href || title);
      if (!dedupeKey || seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);

      const source = extractCardSource(entry.containerText);
      cards.push({
        id: `card-${cards.length + 1}`,
        type: inferActionableCardType(control, entry.containerText),
        title,
        subtitle: source || undefined,
        summary: (metrics ? `${metrics}${summary ? ` | ${summary}` : ""}` : summary) || undefined,
        source: source || undefined,
        href: control.href,
        targetKey: control.key,
        targetHandle: control.handle,
        importance: Math.max(0.6, Number(control.importance || 0.6)) + (entry.container ? 0.05 : 0)
      });
    }

    return cards
      .sort((left, right) => Number(right.importance || 0) - Number(left.importance || 0))
      .slice(0, 8);
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
    return controls.sort((left, right) => {
      const leftRoleBoost = left.semanticRole === "result_link" || left.semanticRole === "detail_link" ? 1 : 0;
      const rightRoleBoost = right.semanticRole === "result_link" || right.semanticRole === "detail_link" ? 1 : 0;
      if (leftRoleBoost !== rightRoleBoost) {
        return rightRoleBoost - leftRoleBoost;
      }
      const importanceDelta = Number(right.importance || 0) - Number(left.importance || 0);
      if (importanceDelta !== 0) {
        return importanceDelta;
      }
      return left.index - right.index;
    });
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
      "main h1, main h2, main h3, main p, main label, main button, main a, main li, main span, main div, article h1, article h2, article h3, article p, article a, article li, article span, article div, section h1, section h2, section h3, section p, section a, section li, section span, section div, form label, form input, form textarea, form select, form button, form span, [role='main'] h1, [role='main'] h2, [role='main'] p, [role='main'] span, [role='main'] div, [role='search'] input, [role='search'] textarea, [role='search'] button, [role='search'] a, [role='search'] span";

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
      if (lines.length >= 90) {
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
    const keyMetrics = extractKeyMetrics(orderedBlocks);
    const actionableCards = buildActionableCards(controls);
    const pageText = orderedBlocks.map((block) => block.text).join(" ").slice(0, 4000);
    const domOutline = buildDomOutline(controls, orderedBlocks);
    return {
      channel: "web",
      summary: `${document.title}. ${[
        keyMetrics
          .slice(0, 3)
          .map((metric) => `${metric.label} ${metric.value}`)
          .join(" | "),
        actionableCards
          .slice(0, 2)
          .map((card) => card.title)
          .join(" | "),
        orderedBlocks
          .slice(0, 3)
          .map((block) => block.text)
          .join(" | ")
      ]
        .filter(Boolean)
        .join(" | ")
        .slice(0, 280)}`,
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
        keyMetrics,
        actionableCards,
        interactiveElements: controls.map(({ element, ...control }) => control),
        finalActionButton: system?.final_action_button ?? "Submit"
      }
    };
  }

  function observationSignature() {
    return [location.href, document.title, getPageText().slice(0, 200)].join("|");
  }

  async function registerSession() {
    await callBridge({
      type: "skh:bridge-register-session",
      payload: {
        session_id: sessionId,
        parent_session_id: parentSessionId,
        system_id: system.system_id,
        title: document.title,
        url: location.href
      }
    });
  }

  async function pushObservation() {
    await callBridge({
      type: "skh:bridge-push-observation",
      sessionId,
      payload: buildObservation()
    });
  }

  async function pullCommands() {
    const commands = await callBridge({
      type: "skh:bridge-pull-commands",
      sessionId
    });
    return Array.isArray(commands) ? commands : [];
  }

  async function completeCommand(commandId, success, result, error) {
    await callBridge({
      type: "skh:bridge-complete-command",
      sessionId,
      commandId,
      payload: { success, result, error }
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
    const byKey = buttons.find((candidate) => normalize(candidate.key) === normalizedTargetKey);
    const byLabel = buttons.find((candidate) => candidates.includes(normalize(candidate.label)));
    const byHandle = buttons.find((candidate) => String(candidate.handle) === String(targetHandle || ""));
    const resolved =
      byKey ||
      byLabel ||
      (byHandle && candidateMatchesTarget(byHandle, normalizedTargetKey, candidates) ? byHandle : undefined) ||
      (!normalizedTargetKey ? byHandle : undefined);
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

  function candidateMatchesTarget(candidate, normalizedTargetKey, labelCandidates) {
    if (!candidate) {
      return false;
    }
    const candidateKey = normalize(candidate.key);
    const candidateLabel = normalize(candidate.label);
    const candidateNearbyText = normalize(candidate.nearbyText || "");
    if (normalizedTargetKey && candidateKey === normalizedTargetKey) {
      return true;
    }
    if (labelCandidates.includes(candidateLabel)) {
      return true;
    }
    return Boolean(normalizedTargetKey && candidateNearbyText.includes(normalizedTargetKey));
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

    if (command.type === "history") {
      const direction = command.payload.direction === "forward" ? "forward" : "back";
      const previousSignature = observationSignature();
      await completeCommand(command.command_id, true, {
        accepted: true,
        direction
      });
      setAgentState("reading", direction === "back" ? "back" : "forward");
      if (direction === "forward") {
        window.history.forward();
      } else {
        window.history.back();
      }
      await waitForObservationChange(previousSignature);
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
          href: target.href,
          semanticRole: target.semanticRole,
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
      currentX: 34,
      currentY: 34,
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
        currentX: 34,
        currentY: 34,
        idleTimer: null
      };
    }

    const existingOverlay = getExistingPointerOverlay();
    if (existingOverlay) {
      return existingOverlay;
    }

    const pointer = safeCreateOverlayElement("div");
    const halo = safeCreateOverlayElement("div");
    const label = safeCreateOverlayElement("div");
    const reader = safeCreateOverlayElement("div");
    if (!pointer || !halo || !label || !reader || !document.documentElement) {
      return {
        pointer: null,
        label: null,
        halo: null,
        reader: null,
        state: "idle",
        homeX: 34,
        homeY: 34,
        currentX: 34,
        currentY: 34,
        idleTimer: null
      };
    }

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
    const state = {
      pointer,
      label,
      halo,
      reader,
      state: "idle",
      homeX: 34,
      homeY: 34,
      currentX: 34,
      currentY: 34,
      idleTimer: null
    };
    positionOverlay(state, state.homeX, state.homeY);
    restorePointerState(state).catch(() => undefined);
    startIdleAnimation(state);
    return state;
  }

  function safeCreateOverlayElement(tagName) {
    try {
      const element = document.createElement(tagName);
      return element instanceof HTMLElement ? element : null;
    } catch {
      return null;
    }
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
        { left: `${overlayState.currentX ?? overlayState.homeX ?? 32}px`, top: `${overlayState.currentY ?? overlayState.homeY ?? 32}px` },
        { left: `${targetX}px`, top: `${targetY}px` }
      ],
      {
        duration: pointerMoveDurationMs,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        fill: "forwards"
      }
    );
    positionOverlay(overlayState, targetX, targetY, { persist: true, makeHome: true });
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

  function persistPointerState(state) {
    if (!showPointerOverlay || !state || typeof chrome?.storage?.local?.set !== "function") {
      return;
    }
    if (extensionContextInvalidated) {
      return;
    }
    if (pointerStateSaveTimer) {
      window.clearTimeout(pointerStateSaveTimer);
    }
    pointerStateSaveTimer = window.setTimeout(() => {
      void safeStorageSet({
        [`skh-pointer-state:${sessionId}`]: {
          x: state.currentX,
          y: state.currentY,
          homeX: state.homeX,
          homeY: state.homeY,
          updatedAt: Date.now()
        }
      }).catch(() => undefined);
      pointerStateSaveTimer = null;
    }, 30);
  }

  async function restorePointerState(state) {
    if (!showPointerOverlay || !state || typeof chrome?.storage?.local?.get !== "function") {
      return;
    }
    if (extensionContextInvalidated) {
      return;
    }
    const currentKey = `skh-pointer-state:${sessionId}`;
    const parentKey = parentSessionId ? `skh-pointer-state:${parentSessionId}` : null;
    const stored = await safeStorageGet(parentKey ? [currentKey, parentKey] : [currentKey]);
    if (!stored) {
      return;
    }
    const snapshot = stored[currentKey] || (parentKey ? stored[parentKey] : null);
    if (!snapshot || typeof snapshot.x !== "number" || typeof snapshot.y !== "number") {
      return;
    }
    state.homeX = typeof snapshot.homeX === "number" ? snapshot.homeX : snapshot.x;
    state.homeY = typeof snapshot.homeY === "number" ? snapshot.homeY : snapshot.y;
    positionOverlay(state, snapshot.x, snapshot.y);
  }

  function positionOverlay(state, x, y, options = {}) {
    const { persist = false, makeHome = false } = options;
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
    state.currentX = x;
    state.currentY = y;
    if (makeHome) {
      state.homeX = x;
      state.homeY = y;
    }
    if (persist) {
      persistPointerState(state);
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
      positionOverlay(state, driftX, driftY, { persist: true });
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
    const bootstrap = await callBridge({ type: "skh:bridge-bootstrap" }).catch(() => null);
    if (!bootstrap) {
      return null;
    }

    return bootstrap;
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
        const genericSystem = findGenericSystem(bootstrap.systems ?? []);
        if (genericSystem) {
          systemWaitLogged = false;
          return genericSystem;
        }
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
    if (extensionContextInvalidated) {
      break;
    }
    try {
      await safeSendMessage({ type: "skh:process-tasks" });
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
    } catch (error) {
      if (markExtensionContextInvalidated(error)) {
        break;
      }
      // no-op: avoid noisy console output in user pages
    }

    setAgentState("reading", "reading");
    await sleep(pollMs);
  }
})();

function matchSystem(url, systems) {
  return systems.find((system) => (system.url_patterns || []).some((pattern) => matchesUrlPattern(url, pattern)));
}

function findGenericSystem(systems) {
  return (
    systems.find((system) => system.system_id === "web_generic") || {
      system_id: "web_generic",
      title: "Generic Web Page",
      url_patterns: [],
      final_action_button: "Submit",
      fields: [],
      buttons: [],
      result_indicators: []
    }
  );
}

function matchesUrlPattern(url, pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(url);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
