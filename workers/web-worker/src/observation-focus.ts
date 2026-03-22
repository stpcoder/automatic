import type {
  ActionableCard,
  InteractiveElement,
  KeyMetric,
  ObservationFocus,
  PageObservation,
  SemanticBlock
} from "./types.js";

const METRIC_LABEL_PATTERN =
  /(현재가|전일대비|등락률|거래량|거래대금|시가총액|price|pricing|volume|market cap|change|open|high|low|seller|판매처|가격|할인|옵션)/i;

export function normalizeObservationFocus(input: unknown): ObservationFocus {
  const normalized = typeof input === "string" ? input.trim().toLowerCase() : "";
  switch (normalized) {
    case "cards":
    case "metrics":
    case "content":
    case "forms":
      return normalized;
    default:
      return "default";
  }
}

export function applyObservationFocus(
  observation: PageObservation,
  requestedFocus?: ObservationFocus
): PageObservation {
  const focus = normalizeObservationFocus(requestedFocus);
  const recommendation = recommendObservationFocus(observation);
  const base = cloneObservation(observation);
  const shaped = shapeObservation(base, focus);
  shaped.focusUsed = focus;
  shaped.recommendedFocus = recommendation.focus;
  shaped.focusReason = recommendation.reason;
  return shaped;
}

function cloneObservation(observation: PageObservation): PageObservation {
  return {
    ...observation,
    visibleTextBlocks: observation.visibleTextBlocks ? [...observation.visibleTextBlocks] : undefined,
    semanticBlocks: observation.semanticBlocks ? observation.semanticBlocks.map((block) => ({ ...block })) : undefined,
    keyMetrics: observation.keyMetrics ? observation.keyMetrics.map((metric) => ({ ...metric })) : undefined,
    actionableCards: observation.actionableCards ? observation.actionableCards.map((card) => ({ ...card })) : undefined,
    interactiveElements: observation.interactiveElements.map((element) => ({ ...element }))
  };
}

function recommendObservationFocus(observation: PageObservation): { focus: ObservationFocus; reason: string } {
  const titleUrlText = [observation.title, observation.url, observation.summary, observation.pageText]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ");
  const lowerText = titleUrlText.toLowerCase();
  const searchLikeContext =
    lowerText.includes("search") ||
    lowerText.includes("검색") ||
    lowerText.includes("results") ||
    lowerText.includes("shopping") ||
    lowerText.includes("스토어") ||
    lowerText.includes("news");
  const searchInputs = observation.interactiveElements.filter((element) =>
    element.semanticRole === "search_input" || element.semanticRole === "form_field"
  ).length;
  const resultLikeLinks = observation.interactiveElements.filter((element) =>
    element.type === "link" &&
    ["result_link", "detail_link"].includes(element.semanticRole ?? "unknown")
  ).length;
  const navLikeControls = observation.interactiveElements.filter((element) =>
    element.region === "header" ||
    element.region === "nav" ||
    element.semanticRole === "navigation_link"
  ).length;
  const paragraphBlocks = (observation.semanticBlocks ?? []).filter((block) =>
    block.type === "paragraph" || block.type === "summary"
  ).length;
  const metricSignals =
    (observation.keyMetrics?.length ?? 0) +
    (observation.semanticBlocks ?? []).filter((block) => typeof block.text === "string" && METRIC_LABEL_PATTERN.test(block.text))
      .length;
  const cardSignals = (observation.actionableCards?.length ?? 0) + resultLikeLinks;
  const contentHeavy = paragraphBlocks >= 6 && !searchLikeContext;

  if (
    metricSignals > 0 &&
    (lowerText.includes("finance") ||
      lowerText.includes("증권") ||
      lowerText.includes("주가") ||
      lowerText.includes("price") ||
      lowerText.includes("market") ||
      lowerText.includes("item/main"))
  ) {
    return {
      focus: "metrics",
      reason: "The page appears metric-heavy and already exposes finance/price signals."
    };
  }

  if (cardSignals > 0 && searchLikeContext && !contentHeavy) {
    return {
      focus: "cards",
      reason: "The page appears to be a results/listing view with selectable result links or cards."
    };
  }

  if (searchInputs > 0 && cardSignals === 0 && metricSignals === 0) {
    return {
      focus: "forms",
      reason: "The page is currently dominated by form/search inputs rather than result content."
    };
  }

  if (contentHeavy || (paragraphBlocks >= 4 && navLikeControls <= Math.max(2, paragraphBlocks))) {
    return {
      focus: "content",
      reason: "The page exposes article/document style paragraph content."
    };
  }

  if (navLikeControls >= Math.max(4, cardSignals + 2) && cardSignals > 0) {
    return {
      focus: "cards",
      reason: "Header or navigation controls dominate the page; cards focus may surface the primary results more clearly."
    };
  }

  return {
    focus: "default",
    reason: "Default balanced observation is still appropriate for this page."
  };
}

function shapeObservation(observation: PageObservation, focus: ObservationFocus): PageObservation {
  switch (focus) {
    case "cards":
      return shapeCardsObservation(observation);
    case "metrics":
      return shapeMetricsObservation(observation);
    case "content":
      return shapeContentObservation(observation);
    case "forms":
      return shapeFormsObservation(observation);
    default:
      return observation;
  }
}

function shapeCardsObservation(observation: PageObservation): PageObservation {
  const rawCards = dedupeCards([
    ...(observation.actionableCards ?? []),
    ...((observation.actionableCards?.length ?? 0) === 0 ? deriveCardsFromInteractiveElements(observation.interactiveElements) : [])
  ]);
  const actionableCards = rawCards.filter((card) => isUsefulListingCard(card, observation)).slice(0, 10);
  const preferredTargets = new Set(
    actionableCards.flatMap((card) => [card.targetKey, card.targetHandle]).filter((value): value is string => Boolean(value))
  );
  const interactiveElements = observation.interactiveElements
    .filter((element) =>
      preferredTargets.has(element.key) ||
      preferredTargets.has(String(element.handle ?? "")) ||
      (element.type === "link" && ["result_link", "detail_link"].includes(element.semanticRole ?? "unknown")) ||
      element.semanticRole === "primary_action"
    )
    .sort(sortByImportance)
    .slice(0, 12);
  const semanticBlocks = (observation.semanticBlocks ?? [])
    .filter((block) =>
      block.type === "result_item" ||
      block.type === "heading" ||
      block.type === "summary" ||
      block.type === "price" ||
      block.type === "label_value"
    )
    .sort((left, right) => right.importance - left.importance)
    .slice(0, 12);
  const visibleTextBlocks = collectCardText(actionableCards, semanticBlocks).slice(0, 12);
  return {
    ...observation,
    actionableCards,
    interactiveElements,
    semanticBlocks,
    visibleTextBlocks,
    pageText: visibleTextBlocks.join(" | ").slice(0, 2200),
    domOutline: compactDomOutline(observation.domOutline, preferredTargets, 1400),
    summary: buildFocusedSummary(observation, "cards", visibleTextBlocks)
  };
}

function shapeMetricsObservation(observation: PageObservation): PageObservation {
  const keyMetrics = dedupeMetrics([
    ...(observation.keyMetrics ?? []),
    ...deriveMetricsFromObservation(observation)
  ]).slice(0, 12);
  const semanticBlocks = (observation.semanticBlocks ?? [])
    .filter((block) =>
      block.type === "label_value" ||
      block.type === "price" ||
      METRIC_LABEL_PATTERN.test(block.text)
    )
    .sort((left, right) => right.importance - left.importance)
    .slice(0, 12);
  const interactiveElements = observation.interactiveElements
    .filter((element) =>
      element.semanticRole === "search_input" ||
      element.semanticRole === "form_field" ||
      element.semanticRole === "primary_action"
    )
    .sort(sortByImportance)
    .slice(0, 8);
  const visibleTextBlocks = [
    ...keyMetrics.map((metric) => [metric.label, metric.value, metric.unit].filter(Boolean).join(" ")),
    ...semanticBlocks.map((block) => block.text)
  ].slice(0, 14);
  return {
    ...observation,
    keyMetrics,
    semanticBlocks,
    interactiveElements,
    visibleTextBlocks,
    pageText: visibleTextBlocks.join(" | ").slice(0, 2000),
    domOutline: compactDomOutline(observation.domOutline, new Set(), 1200),
    summary: buildFocusedSummary(observation, "metrics", visibleTextBlocks)
  };
}

function shapeContentObservation(observation: PageObservation): PageObservation {
  const semanticBlocks = (observation.semanticBlocks ?? [])
    .filter((block) => block.type === "heading" || block.type === "paragraph" || block.type === "summary")
    .sort((left, right) => right.importance - left.importance)
    .slice(0, 14);
  const visibleTextBlocks =
    semanticBlocks.map((block) => block.text).filter((text) => text.trim().length > 0).slice(0, 14);
  const interactiveElements = observation.interactiveElements
    .filter((element) => element.semanticRole === "primary_action" || element.semanticRole === "detail_link")
    .sort(sortByImportance)
    .slice(0, 8);
  return {
    ...observation,
    semanticBlocks,
    interactiveElements,
    visibleTextBlocks,
    pageText: visibleTextBlocks.join(" ").slice(0, 2600),
    domOutline: compactDomOutline(observation.domOutline, new Set(), 1200),
    summary: buildFocusedSummary(observation, "content", visibleTextBlocks)
  };
}

function shapeFormsObservation(observation: PageObservation): PageObservation {
  const interactiveElements = observation.interactiveElements
    .filter((element) =>
      element.semanticRole === "search_input" ||
      element.semanticRole === "form_field" ||
      element.type === "input" ||
      element.type === "select" ||
      element.semanticRole === "primary_action"
    )
    .sort(sortByImportance)
    .slice(0, 12);
  const visibleTextBlocks = interactiveElements
    .map((element) => {
      const value = typeof element.value === "string" && element.value.trim().length > 0 ? ` = ${element.value.trim()}` : "";
      return `${element.label || element.key}${value}`;
    })
    .slice(0, 12);
  const semanticBlocks = (observation.semanticBlocks ?? [])
    .filter((block) => block.type === "form_area" || block.type === "heading" || block.type === "summary")
    .sort((left, right) => right.importance - left.importance)
    .slice(0, 8);
  return {
    ...observation,
    interactiveElements,
    semanticBlocks,
    visibleTextBlocks,
    pageText: visibleTextBlocks.join(" | ").slice(0, 1600),
    domOutline: compactDomOutline(
      observation.domOutline,
      new Set(interactiveElements.flatMap((element) => [element.key, String(element.handle ?? "")])),
      1200
    ),
    summary: buildFocusedSummary(observation, "forms", visibleTextBlocks)
  };
}

function deriveCardsFromInteractiveElements(interactiveElements: InteractiveElement[]): ActionableCard[] {
  return interactiveElements
    .filter((element) =>
      element.type === "link" &&
      ["result_link", "detail_link"].includes(element.semanticRole ?? "unknown") &&
      typeof element.label === "string" &&
      element.label.trim().length >= 6 &&
      (!element.href || !/([?&](q|query|sort|filter|topic|tag)=|\/search\?)/i.test(element.href))
    )
    .sort(sortByImportance)
    .map((element, index) => ({
      id: element.key || `derived-card-${index + 1}`,
      type: element.semanticRole === "detail_link" ? "article" : "search_result",
      title: element.label.trim(),
      summary: typeof element.nearbyText === "string" ? element.nearbyText.trim() : undefined,
      href: element.href,
      targetKey: element.key,
      targetHandle: element.handle,
      importance: typeof element.importance === "number" ? element.importance : 0.7
    }));
}

function isUsefulListingCard(card: ActionableCard, observation: PageObservation): boolean {
  const title = card.title.trim();
  const summary = typeof card.summary === "string" ? card.summary.trim() : "";
  const lowerUrl = `${observation.url || ""} ${observation.title || ""}`.toLowerCase();
  const searchLikeContext =
    lowerUrl.includes("search") ||
    lowerUrl.includes("검색") ||
    lowerUrl.includes("results") ||
    lowerUrl.includes("shopping") ||
    lowerUrl.includes("news");
  const contentHeavy = ((observation.semanticBlocks ?? []).filter((block) => block.type === "paragraph").length >= 4);

  if (/^\[\d+\]$/.test(title)) {
    return false;
  }
  if (/^jump up\b/i.test(title)) {
    return false;
  }
  if (title.length <= 3 && summary.length === 0) {
    return false;
  }
  if (!searchLikeContext && contentHeavy) {
    return Boolean(summary) && summary.length >= 24;
  }
  return true;
}

function deriveMetricsFromObservation(observation: PageObservation): KeyMetric[] {
  const metrics: KeyMetric[] = [];
  const seen = new Set<string>();
  const metricTexts = [
    ...(observation.semanticBlocks ?? []).map((block) => block.text),
    ...(observation.visibleTextBlocks ?? []),
    observation.pageText ?? ""
  ];
  for (const text of metricTexts) {
    if (typeof text !== "string" || !METRIC_LABEL_PATTERN.test(text)) {
      continue;
    }
    const matches = text.matchAll(
      /(현재가|전일대비|등락률|거래량|거래대금|시가총액|price|pricing|volume|market cap|change|open|high|low|seller|판매처|가격|할인|옵션)\s*[:：]?\s*([^\s][^|,]{0,80})/gi
    );
    for (const match of matches) {
      const label = match[1]?.trim();
      const value = match[2]?.trim();
      if (!label || !value) {
        continue;
      }
      const key = `${label.toLowerCase()}::${value.toLowerCase()}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      metrics.push({
        label,
        value,
        importance: inferMetricImportance(label),
        context: text.slice(0, 140)
      });
    }
  }
  return metrics.sort((left, right) => right.importance - left.importance);
}

function inferMetricImportance(label: string): number {
  const normalized = label.toLowerCase();
  if (/(현재가|price|가격)/i.test(normalized)) {
    return 0.96;
  }
  if (/(전일대비|등락률|change)/i.test(normalized)) {
    return 0.92;
  }
  if (/(거래량|volume)/i.test(normalized)) {
    return 0.9;
  }
  if (/(시가총액|market cap)/i.test(normalized)) {
    return 0.88;
  }
  return 0.76;
}

function dedupeCards(cards: ActionableCard[]): ActionableCard[] {
  const seen = new Set<string>();
  return cards.filter((card) => {
    const key = `${card.targetKey ?? ""}::${card.href ?? ""}::${card.title.toLowerCase()}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  }).sort((left, right) => right.importance - left.importance);
}

function dedupeMetrics(metrics: KeyMetric[]): KeyMetric[] {
  const seen = new Set<string>();
  return metrics.filter((metric) => {
    const key = `${metric.label.toLowerCase()}::${metric.value.toLowerCase()}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  }).sort((left, right) => right.importance - left.importance);
}

function collectCardText(cards: ActionableCard[], semanticBlocks: SemanticBlock[]): string[] {
  return [
    ...cards.flatMap((card) => [card.title, card.subtitle, card.source, card.summary]).filter(
      (value): value is string => typeof value === "string" && value.trim().length > 0
    ),
    ...semanticBlocks.map((block) => block.text)
  ];
}

function compactDomOutline(
  domOutline: string | undefined,
  preferredTargets: Set<string>,
  limit: number
): string | undefined {
  if (typeof domOutline !== "string" || domOutline.trim().length === 0) {
    return domOutline;
  }
  const lines = domOutline.split("\n");
  const preferredLines = lines.filter((line) =>
    Array.from(preferredTargets).some((target) => target && line.includes(target))
  );
  const remainder = lines.filter((line) => !preferredLines.includes(line));
  return [...preferredLines, ...remainder].join("\n").slice(0, limit);
}

function buildFocusedSummary(
  observation: PageObservation,
  focus: ObservationFocus,
  snippets: string[]
): string {
  const topSnippet = snippets.filter((snippet) => snippet.trim().length > 0).slice(0, 3).join(" | ");
  const focusLabel = focus === "default" ? "" : `[focus=${focus}] `;
  return `${focusLabel}${observation.title}. ${topSnippet}`.slice(0, 280);
}

function sortByImportance(
  left: { importance?: number; index?: number },
  right: { importance?: number; index?: number }
): number {
  const importanceDelta = Number(right.importance ?? 0) - Number(left.importance ?? 0);
  if (importanceDelta !== 0) {
    return importanceDelta;
  }
  return Number(left.index ?? 0) - Number(right.index ?? 0);
}
