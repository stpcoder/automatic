import { buildHarnessPage } from "./system-definitions.js";
import type { FillResult, HarnessPageDefinition, PageObservation, PreviewResult, SubmitResult, WebAdapter } from "./types.js";

interface SessionState {
  systemId: string;
  page: HarnessPageDefinition;
}

export class PageAgentDomAdapter implements WebAdapter {
  readonly harnessName = "page_agent_dom";
  private readonly sessions = new Map<string, SessionState>();

  async openSystem(systemId: string, pageId?: string): Promise<PageObservation> {
    const page = this.buildDefaultPage(systemId, pageId);
    this.sessions.set(systemId, { systemId, page });
    return this.observe(systemId);
  }

  async observe(systemId: string): Promise<PageObservation> {
    const session = this.getOrCreateSession(systemId);
    return this.toObservation(session.page, systemId);
  }

  async fillForm(systemId: string, values: Record<string, unknown>): Promise<FillResult> {
    const session = this.getOrCreateSession(systemId);
    const updatedElements = session.page.interactiveElements.map((element) => {
      if (element.type !== "input" && element.type !== "select") {
        return element;
      }
      const nextValue = values[element.key];
      if (nextValue === undefined) {
        return element;
      }
      return {
        ...element,
        value: this.stringifyValue(nextValue)
      };
    });

    session.page = {
      ...session.page,
      interactiveElements: updatedElements,
      summary: `${session.page.title} draft updated with ${Object.keys(values).length} fields.`
    };
    this.sessions.set(systemId, session);

    return {
      draftId: `WEBDRAFT-${crypto.randomUUID()}`,
      filledFields: values,
      observation: this.toObservation(session.page, systemId)
    };
  }

  async previewSubmission(systemId: string): Promise<PreviewResult> {
    const session = this.getOrCreateSession(systemId);
    return {
      previewId: `PREVIEW-${crypto.randomUUID()}`,
      observation: this.toObservation(session.page, systemId)
    };
  }

  async submit(systemId: string, expectedButton: string): Promise<SubmitResult> {
    const session = this.getOrCreateSession(systemId);
    if (session.page.finalActionButton !== expectedButton) {
      throw new Error(
        `Expected final action button ${expectedButton} but found ${session.page.finalActionButton ?? "none"}`
      );
    }

    const missingRequired = session.page.interactiveElements.filter(
      (element) => element.required && (element.value === undefined || element.value === "")
    );
    if (missingRequired.length > 0) {
      throw new Error(`Missing required fields: ${missingRequired.map((field) => field.key).join(", ")}`);
    }

    session.page = {
      ...session.page,
      summary: `${session.page.title} submitted successfully.`
    };
    this.sessions.set(systemId, session);

    return {
      recordId: `REC-${crypto.randomUUID()}`,
      observation: this.toObservation(session.page, systemId)
    };
  }

  private getSession(systemId: string): SessionState {
    const session = this.sessions.get(systemId);
    if (!session) {
      throw new Error(`No DOM harness session for system ${systemId}`);
    }
    return session;
  }

  private getOrCreateSession(systemId: string): SessionState {
    const existing = this.sessions.get(systemId);
    if (existing) {
      return existing;
    }
    const page = this.buildDefaultPage(systemId);
    const created = { systemId, page };
    this.sessions.set(systemId, created);
    return created;
  }

  private toObservation(page: HarnessPageDefinition, systemId: string): PageObservation {
    return {
      systemId,
      pageId: page.pageId,
      url: page.url,
      title: page.title,
      summary: page.summary,
      interactiveElements: page.interactiveElements,
      finalActionButton: page.finalActionButton
    };
  }

  private buildDefaultPage(systemId: string, pageId?: string): HarnessPageDefinition {
    return buildHarnessPage(systemId, pageId);
  }

  private stringifyValue(value: unknown): string {
    if (typeof value === "string") {
      return value;
    }
    return JSON.stringify(value);
  }
}
