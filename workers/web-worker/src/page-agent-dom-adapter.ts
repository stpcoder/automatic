import { buildHarnessPage } from "./system-definitions.js";
import type { ClickResult, FillResult, HarnessPageDefinition, PageObservation, PreviewResult, SubmitResult, WebAdapter } from "./types.js";

interface SessionState {
  sessionId: string;
  parentSessionId?: string;
  systemId: string;
  page: HarnessPageDefinition;
}

export class PageAgentDomAdapter implements WebAdapter {
  readonly harnessName = "page_agent_dom";
  private readonly sessions = new Map<string, SessionState>();

  async openSystem(systemId: string, pageId?: string): Promise<PageObservation> {
    const page = this.buildDefaultPage(systemId, pageId);
    this.sessions.set(systemId, { sessionId: `page-agent-${crypto.randomUUID()}`, systemId, page });
    const session = this.getSession(systemId);
    return this.toObservation(session.page, systemId, session.sessionId, session.parentSessionId);
  }

  async observe(systemId: string): Promise<PageObservation> {
    const session = this.getOrCreateSession(systemId);
    return this.toObservation(session.page, systemId, session.sessionId, session.parentSessionId);
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
      observation: this.toObservation(session.page, systemId, session.sessionId, session.parentSessionId)
    };
  }

  async clickElement(systemId: string, targetKey: string): Promise<ClickResult> {
    const session = this.getOrCreateSession(systemId);
    const target = session.page.interactiveElements.find((element) => element.type === "button" && element.key === targetKey);
    if (!target) {
      throw new Error(`No clickable element found for key ${targetKey}`);
    }

    if (systemId === "naver_search" && targetKey === "search") {
      const queryValue = session.page.interactiveElements.find((element) => element.key === "query")?.value ?? "";
      session.page = {
        ...session.page,
        title: "Naver Search Results",
        summary: `Naver search results loaded for ${queryValue}.`,
        interactiveElements: session.page.interactiveElements
      };
      this.sessions.set(systemId, session);
    }

    return {
      clickId: `WEBCLICK-${crypto.randomUUID()}`,
      targetKey,
      observation: this.toObservation(session.page, systemId, session.sessionId, session.parentSessionId)
    };
  }

  async previewSubmission(systemId: string): Promise<PreviewResult> {
    const session = this.getOrCreateSession(systemId);
    return {
      previewId: `PREVIEW-${crypto.randomUUID()}`,
      observation: this.toObservation(session.page, systemId, session.sessionId, session.parentSessionId)
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

    const queryValue = session.page.interactiveElements.find((element) => element.key === "query")?.value ?? "";
    session.page =
      systemId === "naver_search"
        ? {
            ...session.page,
            title: "Naver Search Results",
            summary: `Naver search results loaded for ${queryValue}.`,
            interactiveElements: session.page.interactiveElements
          }
        : {
            ...session.page,
            summary: `${session.page.title} submitted successfully.`
          };
    this.sessions.set(systemId, session);

    return {
      recordId: `REC-${crypto.randomUUID()}`,
      observation: this.toObservation(session.page, systemId, session.sessionId, session.parentSessionId)
    };
  }

  async followNavigation(systemId: string): Promise<PageObservation> {
    const session = this.getOrCreateSession(systemId);
    return this.toObservation(session.page, systemId, session.sessionId, session.parentSessionId);
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
    const created = { sessionId: `page-agent-${crypto.randomUUID()}`, systemId, page };
    this.sessions.set(systemId, created);
    return created;
  }

  private toObservation(
    page: HarnessPageDefinition,
    systemId: string,
    sessionId?: string,
    parentSessionId?: string
  ): PageObservation {
    const pageText =
      systemId === "naver_search" || systemId === "naver_stock"
        ? this.buildNaverPageText(page)
        : page.interactiveElements
            .map((element) => `${element.label}${element.value ? `: ${element.value}` : ""}`)
            .join(" | ");
    return {
      sessionId,
      parentSessionId,
      systemId,
      pageId: page.pageId,
      url: page.url,
      title: page.title,
      summary: page.summary,
      pageText,
      visibleTextBlocks: splitVisibleTextBlocks(pageText),
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

  private buildNaverPageText(page: HarnessPageDefinition): string {
    if (page.title === "Naver Finance - SK hynix") {
      return "Naver Finance SK hynix page. SK hynix 210,000 KRW. Day change +1.45%.";
    }
    const query = page.interactiveElements.find((element) => element.key === "query")?.value ?? "";
    if (page.title === "Naver Search Results") {
      return `Naver search results for ${query}. Stock result card shows SK hynix stock price 210,000 KRW. Related query SK hynix stock price.`;
    }
    return `Naver search home. Current query field value: ${query}.`;
  }
}

function splitVisibleTextBlocks(pageText: string): string[] {
  return pageText
    .split(/\s+\|\s+|(?<=[.!?])\s+/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .slice(0, 20);
}
