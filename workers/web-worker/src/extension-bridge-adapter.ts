import { browserBridgeCoordinator } from "../../../packages/browser-bridge/src/index.js";

import { getWebSystemDefinition } from "./system-definitions.js";
import type {
  ClickResult,
  FillResult,
  PageObservation,
  PreviewResult,
  ScrollResult,
  SubmitResult,
  TypeTextResult,
  WebAdapter,
  WebOpenSelection
} from "./types.js";

export class ExtensionBridgeAdapter implements WebAdapter {
  readonly harnessName = "extension_bridge";

  async openSystem(systemId: string, _pageId?: string, selection?: WebOpenSelection): Promise<PageObservation> {
    const resolvedSelection = selection ?? {};
    const selectorSystemId = systemId === "web_generic" || systemId === "unknown" ? undefined : systemId;
    if (resolvedSelection.targetUrl && resolvedSelection.openIfMissing) {
      const existing = browserBridgeCoordinator.getObservationBySelector({
        sessionId: resolvedSelection.sessionId,
        systemId: selectorSystemId,
        urlContains: resolvedSelection.urlContains ?? resolvedSelection.targetUrl,
        titleContains: resolvedSelection.titleContains
      });
      if (!existing) {
        browserBridgeCoordinator.enqueueOpenTab(resolvedSelection.targetUrl);
      }
    }

    const observation =
      resolvedSelection.sessionId || resolvedSelection.urlContains || resolvedSelection.titleContains || resolvedSelection.targetUrl
        ? await browserBridgeCoordinator.waitForObservationBySelector({
            sessionId: resolvedSelection.sessionId,
            systemId: selectorSystemId,
            urlContains: resolvedSelection.urlContains ?? resolvedSelection.targetUrl,
            titleContains: resolvedSelection.titleContains
          })
        : await browserBridgeCoordinator.waitForObservation(systemId);

    return this.toPageObservation(
      typeof observation.payload.systemId === "string" ? String(observation.payload.systemId) : systemId,
      observation,
      resolvedSelection.sessionId
    );
  }

  async observe(systemId: string, sessionId?: string): Promise<PageObservation> {
    const resolvedSystemId = systemId === "web_generic" || systemId === "unknown" ? undefined : systemId;
    const observation = resolvedSystemId
      ? await browserBridgeCoordinator.waitForObservation(resolvedSystemId, undefined, sessionId)
      : await browserBridgeCoordinator.waitForObservationBySelector({ sessionId });
    return this.toPageObservation(
      typeof observation.payload.systemId === "string" ? String(observation.payload.systemId) : systemId,
      observation,
      sessionId
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
      observation: await this.observe(systemId, sessionId)
    };
  }

  async typeText(
    systemId: string,
    text: string,
    sessionId?: string,
    targetKey?: string,
    submitKey?: string
  ): Promise<TypeTextResult> {
    const command = browserBridgeCoordinator.enqueueCommand(
      systemId,
      "type_text",
      {
        text,
        target_key: targetKey,
        submit_key: submitKey
      },
      sessionId
    );
    const result = await browserBridgeCoordinator.waitForCommandResult(systemId, command.command_id, undefined, sessionId);
    if (result.status === "failed") {
      throw new Error(result.error ?? `Extension bridge type_text failed for ${systemId}`);
    }
    return {
      typingId: `WEBTYPE-${crypto.randomUUID()}`,
      text,
      targetKey,
      observation: await this.observe(systemId, sessionId)
    };
  }

  async clickElement(systemId: string, targetKey: string, sessionId?: string): Promise<ClickResult> {
    const command = browserBridgeCoordinator.enqueueCommand(
      systemId,
      "click",
      {
        target_key: targetKey
      },
      sessionId
    );
    const result = await browserBridgeCoordinator.waitForCommandResult(systemId, command.command_id, undefined, sessionId);
    if (result.status === "failed") {
      throw new Error(result.error ?? `Extension bridge click failed for ${systemId}`);
    }
    return {
      clickId: `WEBCLICK-${crypto.randomUUID()}`,
      targetKey,
      observation: await this.observe(systemId, sessionId)
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
      observation: await this.observe(systemId, sessionId)
    };
  }

  async followNavigation(systemId: string, sessionId?: string): Promise<PageObservation> {
    if (!sessionId) {
      throw new Error("followNavigation requires session_id for extension-backed sessions");
    }
    const followed = await browserBridgeCoordinator.waitForNavigation(sessionId);
    return this.toPageObservation(
      typeof followed.observation.payload.systemId === "string" ? String(followed.observation.payload.systemId) : systemId,
      followed.observation,
      followed.session.session_id,
      followed.session.parent_session_id
    );
  }

  async previewSubmission(systemId: string, sessionId?: string): Promise<PreviewResult> {
    return {
      previewId: `PREVIEW-${crypto.randomUUID()}`,
      observation: await this.observe(systemId, sessionId)
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
      observation: await this.observe(systemId, sessionId)
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
    return {
      sessionId: typeof payload.sessionId === "string" ? payload.sessionId : sessionId,
      parentSessionId: typeof payload.parentSessionId === "string" ? payload.parentSessionId : parentSessionId,
      systemId,
      pageId: typeof payload.pageId === "string" ? payload.pageId : definition.pageId,
      url: typeof payload.url === "string" ? payload.url : definition.url,
      title: typeof payload.title === "string" ? payload.title : definition.title,
      summary: observation.summary,
      pageText: typeof payload.pageText === "string" ? payload.pageText : undefined,
      visibleTextBlocks: Array.isArray(payload.visibleTextBlocks)
        ? (payload.visibleTextBlocks as string[])
        : undefined,
      semanticBlocks: Array.isArray(payload.semanticBlocks)
        ? (payload.semanticBlocks as PageObservation["semanticBlocks"])
        : undefined,
      interactiveElements: Array.isArray(payload.interactiveElements)
        ? (payload.interactiveElements as PageObservation["interactiveElements"])
        : [],
      finalActionButton:
        typeof payload.finalActionButton === "string" ? payload.finalActionButton : definition.finalActionButton
    };
  }
}
