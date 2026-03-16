import { browserBridgeCoordinator } from "../../../packages/browser-bridge/src/index.js";

import { getWebSystemDefinition } from "./system-definitions.js";
import type { ClickResult, FillResult, PageObservation, PreviewResult, SubmitResult, WebAdapter } from "./types.js";

export class BookmarkletBridgeAdapter implements WebAdapter {
  readonly harnessName = "bookmarklet_bridge";

  async openSystem(systemId: string): Promise<PageObservation> {
    const observation = await browserBridgeCoordinator.waitForObservation(systemId);
    return this.toPageObservation(systemId, observation);
  }

  async observe(systemId: string): Promise<PageObservation> {
    const observation = await browserBridgeCoordinator.waitForObservation(systemId);
    return this.toPageObservation(systemId, observation);
  }

  async fillForm(systemId: string, values: Record<string, unknown>): Promise<FillResult> {
    const command = browserBridgeCoordinator.enqueueCommand(systemId, "fill", {
      field_values: values
    });
    const result = await browserBridgeCoordinator.waitForCommandResult(systemId, command.command_id);
    if (result.status === "failed") {
      throw new Error(result.error ?? `Bookmarklet bridge fill failed for ${systemId}`);
    }
    return {
      draftId: `WEBDRAFT-${crypto.randomUUID()}`,
      filledFields: values,
      observation: await this.observe(systemId)
    };
  }

  async clickElement(systemId: string, targetKey: string): Promise<ClickResult> {
    const command = browserBridgeCoordinator.enqueueCommand(systemId, "click", {
      target_key: targetKey
    });
    const result = await browserBridgeCoordinator.waitForCommandResult(systemId, command.command_id);
    if (result.status === "failed") {
      throw new Error(result.error ?? `Bookmarklet bridge click failed for ${systemId}`);
    }
    return {
      clickId: `WEBCLICK-${crypto.randomUUID()}`,
      targetKey,
      observation: await this.observe(systemId)
    };
  }

  async previewSubmission(systemId: string): Promise<PreviewResult> {
    return {
      previewId: `PREVIEW-${crypto.randomUUID()}`,
      observation: await this.observe(systemId)
    };
  }

  async submit(systemId: string, expectedButton: string): Promise<SubmitResult> {
    const command = browserBridgeCoordinator.enqueueCommand(systemId, "submit", {
      expected_button: expectedButton
    });
    const result = await browserBridgeCoordinator.waitForCommandResult(systemId, command.command_id);
    if (result.status === "failed") {
      throw new Error(result.error ?? `Bookmarklet bridge submit failed for ${systemId}`);
    }
    return {
      recordId: `REC-${crypto.randomUUID()}`,
      observation: await this.observe(systemId)
    };
  }

  private toPageObservation(systemId: string, observation: { payload: Record<string, unknown>; summary: string }): PageObservation {
    const definition = getWebSystemDefinition(systemId);
    const payload = observation.payload;
    return {
      systemId,
      pageId: typeof payload.pageId === "string" ? payload.pageId : definition.pageId,
      url: typeof payload.url === "string" ? payload.url : definition.url,
      title: typeof payload.title === "string" ? payload.title : definition.title,
      summary: observation.summary,
      pageText: typeof payload.pageText === "string" ? payload.pageText : undefined,
      interactiveElements: Array.isArray(payload.interactiveElements)
        ? (payload.interactiveElements as PageObservation["interactiveElements"])
        : [],
      finalActionButton:
        typeof payload.finalActionButton === "string" ? payload.finalActionButton : definition.finalActionButton
    };
  }
}
