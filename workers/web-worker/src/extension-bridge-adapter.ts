import { browserBridgeCoordinator } from "../../../packages/browser-bridge/src/index.js";

import { applyObservationFocus } from "./observation-focus.js";
import { getWebSystemDefinition } from "./system-definitions.js";
import type {
  ActionableCard,
  ClickResult,
  FillResult,
  HistoryNavigationResult,
  InteractiveElement,
  KeyMetric,
  ObservationOptions,
  PageObservation,
  PreviewResult,
  ScrollResult,
  SubmitResult,
  WebAdapter,
  WebOpenSelection
} from "./types.js";

export class ExtensionBridgeAdapter implements WebAdapter {
  readonly harnessName = "extension_bridge";
  private readonly clickNavigationTimeoutMs = Number(process.env.BRIDGE_CLICK_NAVIGATION_TIMEOUT_MS ?? "3500");
  private readonly clickObservationTimeoutMs = Number(process.env.BRIDGE_CLICK_OBSERVATION_TIMEOUT_MS ?? "3500");
  private readonly followNavigationTimeoutMs = Number(process.env.BRIDGE_FOLLOW_NAVIGATION_TIMEOUT_MS ?? "2500");
  private readonly followObservationTimeoutMs = Number(process.env.BRIDGE_FOLLOW_OBSERVATION_TIMEOUT_MS ?? "2500");

  async openSystem(systemId: string, _pageId?: string, selection?: WebOpenSelection): Promise<PageObservation> {
    const resolvedSelection = selection ?? {};
    const resolvedSystemId = normalizeExtensionBridgeSystemId(systemId);
    const selectorSystemId = resolvedSystemId === "web_generic" ? undefined : resolvedSystemId;
    const hasExplicitTarget =
      Boolean(resolvedSelection.targetUrl) ||
      Boolean(resolvedSelection.urlContains) ||
      Boolean(resolvedSelection.titleContains);
    const selectorSessionId = hasExplicitTarget ? undefined : resolvedSelection.sessionId;
    if (resolvedSelection.targetUrl && resolvedSelection.openIfMissing) {
      const selector = {
        sessionId: selectorSessionId,
        systemId: selectorSystemId,
        urlContains: resolvedSelection.urlContains ?? resolvedSelection.targetUrl,
        titleContains: resolvedSelection.titleContains
      };
      const existingObservation = browserBridgeCoordinator.getObservationBySelector(selector);
      const existingSession = browserBridgeCoordinator.getSessionBySelector(selector);
      if (!existingObservation && !existingSession) {
        browserBridgeCoordinator.enqueueOpenTab(resolvedSelection.targetUrl);
      }
    }

    const observation =
      resolvedSelection.sessionId || resolvedSelection.urlContains || resolvedSelection.titleContains || resolvedSelection.targetUrl
        ? await browserBridgeCoordinator.waitForObservationBySelector({
            sessionId: selectorSessionId,
            systemId: selectorSystemId,
            urlContains: resolvedSelection.urlContains ?? resolvedSelection.targetUrl,
            titleContains: resolvedSelection.titleContains
          })
        : await browserBridgeCoordinator.waitForObservation(resolvedSystemId);

    return applyObservationFocus(
      this.toPageObservation(
        typeof observation.payload.systemId === "string" ? String(observation.payload.systemId) : resolvedSystemId,
        observation,
        resolvedSelection.sessionId
      ),
      "default"
    );
  }

  async observe(systemId: string, sessionId?: string, options?: ObservationOptions): Promise<PageObservation> {
    const normalizedSystemId = normalizeExtensionBridgeSystemId(systemId);
    const selectorSystemId = normalizedSystemId === "web_generic" ? undefined : normalizedSystemId;
    const observation = selectorSystemId
      ? await browserBridgeCoordinator.waitForObservation(selectorSystemId, undefined, sessionId)
      : await browserBridgeCoordinator.waitForObservationBySelector({ sessionId });
    return applyObservationFocus(
      this.toPageObservation(
        typeof observation.payload.systemId === "string" ? String(observation.payload.systemId) : normalizedSystemId,
        observation,
        sessionId
      ),
      options?.focus
    );
  }

  async fillForm(systemId: string, values: Record<string, unknown>, sessionId?: string): Promise<FillResult> {
    const command = browserBridgeCoordinator.enqueueCommand(
      systemId,
      "fill",
      {
        field_values: values
      },
      sessionId
    );
    const result = await browserBridgeCoordinator.waitForCommandResult(systemId, command.command_id, undefined, sessionId);
    if (result.status === "failed") {
      throw new Error(result.error ?? `Extension bridge fill failed for ${systemId}`);
    }
    return {
      draftId: `WEBDRAFT-${crypto.randomUUID()}`,
      filledFields: values,
      observation: await this.observe(systemId, sessionId, { focus: "default" })
    };
  }

  async clickElement(systemId: string, targetKey: string, sessionId?: string, targetHandle?: string): Promise<ClickResult> {
    const baselineUpdatedAt =
      sessionId ? browserBridgeCoordinator.getSessionInfo(sessionId)?.updated_at : undefined;
    const baselineObservation =
      sessionId ? browserBridgeCoordinator.getObservationBySession(sessionId) : undefined;
    const command = browserBridgeCoordinator.enqueueCommand(
      systemId,
      "click",
      {
        target_key: targetKey,
        target_handle: targetHandle
      },
      sessionId
    );
    const result = await browserBridgeCoordinator.waitForCommandResult(systemId, command.command_id, undefined, sessionId);
    if (result.status === "failed") {
      throw new Error(result.error ?? `Extension bridge click failed for ${systemId}`);
    }
    const targetResult =
      result.result && typeof result.result.target === "object" && result.result.target !== null
        ? (result.result.target as Record<string, unknown>)
        : undefined;
    const expectedNavigationUrl = typeof targetResult?.href === "string" ? targetResult.href : undefined;
    const observation =
      sessionId
        ? await this.observeAfterClick(systemId, sessionId, baselineUpdatedAt, expectedNavigationUrl)
        : await this.observe(systemId, sessionId, { focus: "default" });
    const baselinePage =
      baselineObservation
        ? this.toPageObservation(
            typeof baselineObservation.payload.systemId === "string" ? String(baselineObservation.payload.systemId) : systemId,
            baselineObservation,
            sessionId
          )
        : undefined;
    const navigationEvent = buildClickNavigationEvent(targetResult, baselinePage, observation);
    return {
      clickId: `WEBCLICK-${crypto.randomUUID()}`,
      targetKey,
      targetHandle,
      previousPage: baselinePage
        ? {
            sessionId: baselinePage.sessionId,
            title: baselinePage.title,
            url: baselinePage.url,
            summary: baselinePage.summary
          }
        : undefined,
      target: targetResult
        ? {
            handle: typeof targetResult.handle === "string" ? targetResult.handle : undefined,
            key: typeof targetResult.key === "string" ? targetResult.key : targetKey,
            label: typeof targetResult.label === "string" ? targetResult.label : targetKey,
            href: typeof targetResult.href === "string" ? targetResult.href : undefined,
            semanticRole: isInteractiveSemanticRole(targetResult.semanticRole) ? targetResult.semanticRole : undefined,
            domPath: typeof targetResult.domPath === "string" ? targetResult.domPath : undefined,
            nearbyText: typeof targetResult.nearbyText === "string" ? targetResult.nearbyText : undefined
          }
        : undefined,
      navigationEvent,
      observation
    };
  }

  async scrollPage(systemId: string, direction: "up" | "down", amount = 0.75, sessionId?: string): Promise<ScrollResult> {
    const command = browserBridgeCoordinator.enqueueCommand(
      systemId,
      "scroll",
      {
        direction,
        amount
      },
      sessionId
    );
    const result = await browserBridgeCoordinator.waitForCommandResult(systemId, command.command_id, undefined, sessionId);
    if (result.status === "failed") {
      throw new Error(result.error ?? `Extension bridge scroll failed for ${systemId}`);
    }
    return {
      scrollId: `WEBSCROLL-${crypto.randomUUID()}`,
      observation: await this.observe(systemId, sessionId, { focus: "default" })
    };
  }

  async navigateHistory(
    systemId: string,
    direction: "back" | "forward",
    sessionId?: string
  ): Promise<HistoryNavigationResult> {
    if (!sessionId) {
      throw new Error("navigateHistory requires session_id for extension-backed sessions");
    }
    const baselineUpdatedAt = browserBridgeCoordinator.getSessionInfo(sessionId)?.updated_at;
    const command = browserBridgeCoordinator.enqueueCommand(
      systemId,
      "history",
      {
        direction
      },
      sessionId
    );
    const result = await browserBridgeCoordinator.waitForCommandResult(systemId, command.command_id, undefined, sessionId);
    if (result.status === "failed") {
      throw new Error(result.error ?? `Extension bridge history navigation failed for ${systemId}`);
    }
    const observation = await this.observeAfterClick(systemId, sessionId, baselineUpdatedAt);
    return {
      navigationId: `WEBNAV-${crypto.randomUUID()}`,
      direction,
      observation
    };
  }

  async followNavigation(systemId: string, sessionId?: string, options?: ObservationOptions): Promise<PageObservation> {
    if (!sessionId) {
      throw new Error("followNavigation requires session_id for extension-backed sessions");
    }
    const baselineUpdatedAt = browserBridgeCoordinator.getSessionInfo(sessionId)?.updated_at;
    try {
      const followed = await browserBridgeCoordinator.waitForNavigation(sessionId, this.followNavigationTimeoutMs);
      return applyObservationFocus(
        this.toPageObservation(
          typeof followed.observation.payload.systemId === "string" ? String(followed.observation.payload.systemId) : systemId,
          followed.observation,
          followed.session.session_id,
          followed.session.parent_session_id
        ),
        options?.focus
      );
    } catch {
      if (baselineUpdatedAt) {
        try {
          const updated = await browserBridgeCoordinator.waitForUpdatedObservation(
            sessionId,
            baselineUpdatedAt,
            this.followObservationTimeoutMs
          );
          return applyObservationFocus(
            this.toPageObservation(
              typeof updated.observation.payload.systemId === "string" ? String(updated.observation.payload.systemId) : systemId,
              updated.observation,
              updated.session.session_id,
              updated.session.parent_session_id
            ),
            options?.focus
          );
        } catch {
          // Fall through to the current visible observation. follow_web_navigation
          // should attach to whatever page is currently visible, even if the
          // navigation already settled before this tool was called.
        }
      }
      return this.observe(systemId, sessionId, options);
    }
  }

  async previewSubmission(systemId: string, sessionId?: string): Promise<PreviewResult> {
    return {
      previewId: `PREVIEW-${crypto.randomUUID()}`,
      observation: await this.observe(systemId, sessionId, { focus: "default" })
    };
  }

  async submit(systemId: string, expectedButton: string, sessionId?: string): Promise<SubmitResult> {
    const command = browserBridgeCoordinator.enqueueCommand(
      systemId,
      "submit",
      {
        expected_button: expectedButton
      },
      sessionId
    );
    const result = await browserBridgeCoordinator.waitForCommandResult(systemId, command.command_id, undefined, sessionId);
    if (result.status === "failed") {
      throw new Error(result.error ?? `Extension bridge submit failed for ${systemId}`);
    }
    return {
      recordId: `REC-${crypto.randomUUID()}`,
      observation: await this.observe(systemId, sessionId, { focus: "default" })
    };
  }

  private toPageObservation(
    systemId: string,
    observation: { payload: Record<string, unknown>; summary: string },
    sessionId?: string,
    parentSessionId?: string
  ): PageObservation {
    const definition = getWebSystemDefinition(systemId);
    const payload = observation.payload;
    const semanticBlocks = Array.isArray(payload.semanticBlocks)
      ? (payload.semanticBlocks as PageObservation["semanticBlocks"])
      : undefined;
    const interactiveElements = Array.isArray(payload.interactiveElements)
      ? (payload.interactiveElements as PageObservation["interactiveElements"])
      : [];
    const pageText = typeof payload.pageText === "string" ? payload.pageText : undefined;
    const keyMetrics = Array.isArray(payload.keyMetrics)
      ? (payload.keyMetrics as KeyMetric[])
      : deriveKeyMetricsFallback(semanticBlocks, pageText);
    const actionableCards = Array.isArray(payload.actionableCards)
      ? (payload.actionableCards as ActionableCard[])
      : deriveActionableCardsFallback(interactiveElements);
    return {
      sessionId: typeof payload.sessionId === "string" ? payload.sessionId : sessionId,
      parentSessionId: typeof payload.parentSessionId === "string" ? payload.parentSessionId : parentSessionId,
      systemId,
      pageId: typeof payload.pageId === "string" ? payload.pageId : definition.pageId,
      url: typeof payload.url === "string" ? payload.url : definition.url,
      title: typeof payload.title === "string" ? payload.title : definition.title,
      summary: observation.summary,
      pageText,
      domOutline: typeof payload.domOutline === "string" ? payload.domOutline : undefined,
      visibleTextBlocks: Array.isArray(payload.visibleTextBlocks)
        ? (payload.visibleTextBlocks as string[])
        : undefined,
      semanticBlocks,
      keyMetrics,
      actionableCards,
      interactiveElements,
      finalActionButton:
        typeof payload.finalActionButton === "string" ? payload.finalActionButton : definition.finalActionButton
    };
  }

  private async observeAfterClick(
    systemId: string,
    sessionId: string,
    baselineUpdatedAt?: string,
    expectedNavigationUrl?: string
  ): Promise<PageObservation> {
    try {
      const followed = await browserBridgeCoordinator.waitForNavigation(
        sessionId,
        this.clickNavigationTimeoutMs,
        expectedNavigationUrl
      );
      return applyObservationFocus(
        this.toPageObservation(
          typeof followed.observation.payload.systemId === "string" ? String(followed.observation.payload.systemId) : systemId,
          followed.observation,
          followed.session.session_id,
          followed.session.parent_session_id
        ),
        "default"
      );
    } catch {
      if (baselineUpdatedAt) {
        try {
          const updated = await browserBridgeCoordinator.waitForUpdatedObservation(
            sessionId,
            baselineUpdatedAt,
            this.clickObservationTimeoutMs
          );
          return applyObservationFocus(
            this.toPageObservation(
              typeof updated.observation.payload.systemId === "string" ? String(updated.observation.payload.systemId) : systemId,
              updated.observation,
              updated.session.session_id,
              updated.session.parent_session_id
            ),
            "default"
          );
        } catch {
          // Fall through to the latest visible observation.
        }
      }
      return this.observe(systemId, sessionId, { focus: "default" });
    }
  }
}

function normalizeExtensionBridgeSystemId(systemId: string): string {
  const normalized = String(systemId || "").trim();
  if (!normalized || normalized === "unknown" || normalized === "default") {
    return "web_generic";
  }
  return normalized;
}

function shouldRequireNavigationAfterClick(target: Record<string, unknown>): boolean {
  const href = typeof target.href === "string" ? target.href.trim() : "";
  const semanticRole = typeof target.semanticRole === "string" ? target.semanticRole : "";
  if (href && /^javascript:/i.test(href)) {
    return false;
  }
  return Boolean(href) || semanticRole === "result_link" || semanticRole === "detail_link";
}

function buildClickNavigationEvent(
  target: Record<string, unknown> | undefined,
  baseline: PageObservation | undefined,
  current: PageObservation
): ClickResult["navigationEvent"] | undefined {
  const expectedNavigation = target ? shouldRequireNavigationAfterClick(target) : false;
  const newSessionOpened = Boolean(baseline?.sessionId && current.sessionId && baseline.sessionId !== current.sessionId);
  const currentSessionChanged = Boolean(
    baseline &&
      baseline.sessionId &&
      current.sessionId === baseline.sessionId &&
      didObservationMeaningfullyChange(baseline, current)
  );

  let kind: NonNullable<ClickResult["navigationEvent"]>["kind"] = "none";
  if (newSessionOpened) {
    kind = "child_session";
  } else if (currentSessionChanged) {
    kind = "same_session";
  } else if (expectedNavigation) {
    kind = "none";
  } else if (!baseline) {
    kind = "uncertain";
  }

  return {
    kind,
    expectedNavigation,
    matchedExpectation: expectedNavigation ? kind === "same_session" || kind === "child_session" : true,
    currentSessionChanged,
    newSessionOpened,
    fromSessionId: baseline?.sessionId,
    toSessionId: current.sessionId,
    fromUrl: baseline?.url,
    toUrl: current.url,
    fromTitle: baseline?.title,
    toTitle: current.title
  };
}

function didObservationMeaningfullyChange(baseline: PageObservation, current: PageObservation): boolean {
  if (baseline.sessionId !== current.sessionId) {
    return true;
  }
  if (baseline.url !== current.url || baseline.title !== current.title) {
    return true;
  }
  const baselineSignature = buildObservationComparisonSignature(baseline);
  const currentSignature = buildObservationComparisonSignature(current);
  return baselineSignature !== currentSignature;
}

function buildObservationComparisonSignature(observation: PageObservation): string {
  return [
    observation.url,
    observation.title,
    observation.summary.slice(0, 180),
    observation.pageText?.slice(0, 300) ?? "",
    observation.domOutline?.slice(0, 400) ?? ""
  ].join("|");
}

const METRIC_LABEL_PATTERN =
  /(현재가|전일대비|등락률|거래량|거래대금|시가총액|price|volume|market cap|change|open|high|low)/i;

function deriveKeyMetricsFallback(
  semanticBlocks: PageObservation["semanticBlocks"] | undefined,
  pageText: string | undefined
): KeyMetric[] {
  const metrics: KeyMetric[] = [];
  const seen = new Set<string>();

  const addMetric = (label: string, value: string, importance: number, context?: string) => {
    const normalizedLabel = label.trim();
    const normalizedValue = value.trim();
    if (!normalizedLabel || !normalizedValue) {
      return;
    }
    const key = `${normalizedLabel.toLowerCase()}::${normalizedValue.toLowerCase()}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    metrics.push({ label: normalizedLabel, value: normalizedValue, importance, context });
  };

  for (const block of semanticBlocks ?? []) {
    const text = typeof block?.text === "string" ? block.text.replace(/\s+/g, " ").trim() : "";
    if (!text || !METRIC_LABEL_PATTERN.test(text)) {
      continue;
    }
    const metricMatch = text.match(
      /(현재가|전일대비|등락률|거래량|거래대금|시가총액|price|volume|market cap|change|open|high|low)\s*[:：]?\s*([^\s][^|,]{0,80})/i
    );
    if (metricMatch) {
      addMetric(metricMatch[1], metricMatch[2], typeof block.importance === "number" ? block.importance : 0.75, text);
    }
    if (metrics.length >= 8) {
      break;
    }
  }

  if (metrics.length === 0 && pageText) {
    const matches = pageText.matchAll(
      /(현재가|전일대비|등락률|거래량|거래대금|시가총액|price|volume|market cap|change|open|high|low)\s*[:：]?\s*([^\s][^|,]{0,60})/gi
    );
    for (const match of matches) {
      addMetric(match[1], match[2], 0.6, pageText.slice(0, 160));
      if (metrics.length >= 6) {
        break;
      }
    }
  }

  return metrics.slice(0, 8);
}

function deriveActionableCardsFallback(interactiveElements: InteractiveElement[]): ActionableCard[] {
  const cards: ActionableCard[] = [];
  const seen = new Set<string>();

  for (const element of interactiveElements) {
    if (element.type !== "link") {
      continue;
    }
    if (!["result_link", "detail_link"].includes(element.semanticRole ?? "unknown")) {
      continue;
    }
    const title = typeof element.label === "string" ? element.label.trim() : "";
    if (!title || title.length < 6) {
      continue;
    }
    const dedupeKey = `${element.key}::${element.href ?? ""}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    cards.push({
      id: element.key || `card-${cards.length + 1}`,
      type: element.semanticRole === "detail_link" ? "article" : "search_result",
      title,
      summary: typeof element.nearbyText === "string" ? element.nearbyText.trim() : undefined,
      href: element.href,
      targetKey: element.key,
      targetHandle: element.handle,
      importance: typeof element.importance === "number" ? element.importance : element.semanticRole === "detail_link" ? 0.85 : 0.8
    });
    if (cards.length >= 8) {
      break;
    }
  }

  return cards;
}

function isInteractiveSemanticRole(value: unknown): value is NonNullable<InteractiveElement["semanticRole"]> {
  return (
    typeof value === "string" &&
    [
      "search_input",
      "form_field",
      "primary_action",
      "secondary_action",
      "result_link",
      "detail_link",
      "navigation_link",
      "unknown"
    ].includes(value)
  );
}
