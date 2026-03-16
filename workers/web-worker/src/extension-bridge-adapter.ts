import { browserBridgeCoordinator } from "../../../packages/browser-bridge/src/index.js";

import { getWebSystemDefinition } from "./system-definitions.js";
import type { ClickResult, FillResult, PageObservation, PreviewResult, SubmitResult, WebAdapter } from "./types.js";

export class ExtensionBridgeAdapter implements WebAdapter {
  readonly harnessName = "extension_bridge";

  async openSystem(systemId: string, _pageId?: string, sessionId?: string): Promise<PageObservation> {
    const observation = await browserBridgeCoordinator.waitForObservation(systemId, undefined, sessionId);
    return this.toPageObservation(systemId, observation, sessionId);
  }

  async observe(systemId: string, sessionId?: string): Promise<PageObservation> {
    const observation = await browserBridgeCoordinator.waitForObservation(systemId, undefined, sessionId);
    return this.toPageObservation(systemId, observation, sessionId);
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
      interactiveElements: Array.isArray(payload.interactiveElements)
        ? (payload.interactiveElements as PageObservation["interactiveElements"])
        : [],
      finalActionButton:
        typeof payload.finalActionButton === "string" ? payload.finalActionButton : definition.finalActionButton
    };
  }
}
