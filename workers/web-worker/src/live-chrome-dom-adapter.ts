import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";

import { mapLiveDomElements, type LiveDomElementSnapshot, normalizeDomText } from "./dom-mapping.js";
import { getWebSystemDefinition, matchWebSystemByUrl, type WebSystemDefinition } from "./system-definitions.js";
import type { ClickResult, FillResult, PageObservation, PreviewResult, SubmitResult, WebAdapter } from "./types.js";

interface LiveChromeSession {
  sessionId: string;
  systemId: string;
  definition: WebSystemDefinition;
  page: Page;
}

interface LiveChromeDomAdapterOptions {
  cdpUrl?: string;
}

export class LiveChromeDomAdapter implements WebAdapter {
  readonly harnessName = "live_chrome";

  private readonly cdpUrl: string;
  private readonly sessions = new Map<string, LiveChromeSession>();
  private browserPromise?: Promise<Browser>;
  private contextPromise?: Promise<BrowserContext>;

  constructor(options: LiveChromeDomAdapterOptions = {}) {
    this.cdpUrl = options.cdpUrl ?? process.env.WEB_WORKER_CDP_URL ?? "http://127.0.0.1:9222";
  }

  async openSystem(systemId: string, pageId?: string): Promise<PageObservation> {
    const definition = getWebSystemDefinition(systemId, pageId);
    const context = await this.getContext();
    const page = await context.newPage();
    await page.goto(definition.url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(250);

    this.sessions.set(systemId, {
      sessionId: `live-${crypto.randomUUID()}`,
      systemId,
      definition,
      page
    });
    return this.observe(systemId);
  }

  async observe(systemId: string): Promise<PageObservation> {
    const session = await this.getOrCreateSession(systemId);
    return this.buildObservation(session);
  }

  async fillForm(systemId: string, values: Record<string, unknown>): Promise<FillResult> {
    const session = await this.getOrCreateSession(systemId);
    const filledFields = await session.page.evaluate(
      ({ fieldValues, definition }) => {
        const normalize = (value: string | undefined): string =>
          (value ?? "")
            .trim()
            .toLowerCase()
            .replace(/\s+/g, " ");

        const getLabelText = (element: Element): string => {
          const htmlElement = element as HTMLElement;
          if (htmlElement.getAttribute("aria-label")) {
            return htmlElement.getAttribute("aria-label") ?? "";
          }
          const id = htmlElement.getAttribute("id");
          if (id) {
            const label = document.querySelector(`label[for="${id}"]`);
            if (label?.textContent) {
              return label.textContent.trim();
            }
          }
          const parentLabel = htmlElement.closest("label");
          if (parentLabel?.textContent) {
            return parentLabel.textContent.trim();
          }
          if ("placeholder" in htmlElement && typeof htmlElement.getAttribute("placeholder") === "string") {
            return htmlElement.getAttribute("placeholder") ?? "";
          }
          return "";
        };

        const matchesField = (element: Element, key: string, aliases: string[]): boolean => {
          const htmlElement = element as HTMLElement;
          const candidates = [
            key,
            htmlElement.getAttribute("name") ?? "",
            htmlElement.getAttribute("id") ?? "",
            htmlElement.getAttribute("aria-label") ?? "",
            htmlElement.getAttribute("placeholder") ?? "",
            getLabelText(element)
          ].map(normalize);
          return aliases.some((alias) => candidates.includes(normalize(alias)));
        };

        const fillValue = (element: Element, nextValue: string): boolean => {
          const htmlElement = element as HTMLElement;
          if (
            htmlElement instanceof HTMLInputElement ||
            htmlElement instanceof HTMLTextAreaElement ||
            htmlElement instanceof HTMLSelectElement
          ) {
            htmlElement.focus();
            htmlElement.value = nextValue;
            htmlElement.dispatchEvent(new Event("input", { bubbles: true }));
            htmlElement.dispatchEvent(new Event("change", { bubbles: true }));
            return true;
          }
          return false;
        };

        const controls = Array.from(document.querySelectorAll("input, textarea, select"));
        const filled: Record<string, string> = {};

        for (const [key, rawValue] of Object.entries(fieldValues)) {
          const nextValue = typeof rawValue === "string" ? rawValue : JSON.stringify(rawValue);
          const fieldDefinition = definition.fields.find((field) => field.key === key);
          const aliases = [key, fieldDefinition?.label ?? "", ...(fieldDefinition?.aliases ?? [])];

          for (const control of controls) {
            if (matchesField(control, key, aliases) && fillValue(control, nextValue)) {
              filled[key] = nextValue;
              break;
            }
          }
        }

        return filled;
      },
      { fieldValues: values, definition: session.definition }
    );

    return {
      draftId: `WEBDRAFT-${crypto.randomUUID()}`,
      filledFields,
      observation: await this.buildObservation(session)
    };
  }

  async clickElement(systemId: string, targetKey: string): Promise<ClickResult> {
    const session = await this.getOrCreateSession(systemId);
    const definition = getWebSystemDefinition(systemId);
    const matchedButton = definition.buttons.find((button) =>
      [button.key, button.label].concat(button.aliases ?? []).map((value) => value.toLowerCase()).includes(targetKey.toLowerCase())
    );
    const labels = matchedButton ? [matchedButton.label].concat(matchedButton.aliases ?? []) : [targetKey];

    const clicked = await session.page.evaluate((candidateLabels: string[]) => {
      const normalizedCandidates = candidateLabels.map((value) => value.trim().toLowerCase());
      const buttons = Array.from(document.querySelectorAll("button, input[type='submit'], input[type='button']"));
      const target = buttons.find((node) => {
        const element = node as HTMLButtonElement | HTMLInputElement;
        const text = (element.innerText || element.value || node.textContent || "").trim().toLowerCase();
        return normalizedCandidates.includes(text);
      });
      if (!target) {
        return false;
      }
      (target as HTMLElement).click();
      return true;
    }, labels);
    if (!clicked) {
      throw new Error(`No clickable element found for key ${targetKey}`);
    }
    await session.page.waitForTimeout(250);

    return {
      clickId: `WEBCLICK-${crypto.randomUUID()}`,
      targetKey,
      observation: await this.buildObservation(session)
    };
  }

  async previewSubmission(systemId: string): Promise<PreviewResult> {
    const session = await this.getOrCreateSession(systemId);
    return {
      previewId: `PREVIEW-${crypto.randomUUID()}`,
      observation: await this.buildObservation(session)
    };
  }

  async submit(systemId: string, expectedButton: string): Promise<SubmitResult> {
    const session = await this.getOrCreateSession(systemId);
    const observation = await this.buildObservation(session);

    if (observation.finalActionButton !== expectedButton) {
      throw new Error(
        `Expected final action button ${expectedButton} but found ${observation.finalActionButton ?? "none"}`
      );
    }

    const missingRequired = observation.interactiveElements.filter(
      (element) => element.required && (element.value === undefined || element.value === "")
    );
    if (missingRequired.length > 0) {
      throw new Error(`Missing required fields: ${missingRequired.map((field) => field.key).join(", ")}`);
    }

    const button = session.page.getByRole("button", { name: expectedButton }).first();
    if ((await button.count()) > 0) {
      await button.click();
    } else {
      const fallback = session.page
        .locator("input[type='submit'], input[type='button'], button")
        .filter({ hasText: expectedButton })
        .first();
      if ((await fallback.count()) === 0) {
        throw new Error(`Could not find submit control labeled ${expectedButton}`);
      }
      await fallback.click();
    }

    await session.page.waitForTimeout(300);

    return {
      recordId: `REC-${crypto.randomUUID()}`,
      observation: await this.buildObservation(session)
    };
  }

  async followNavigation(systemId: string): Promise<PageObservation> {
    const session = await this.getOrCreateSession(systemId);
    const context = await this.getContext();
    const previousPage = session.page;
    const previousUrl = previousPage.url();
    const previousTitle = await previousPage.title();
    const followTimeoutMs = Number(process.env.BRIDGE_OBSERVATION_TIMEOUT_MS ?? "30000");
    const newPagePromise = context.waitForEvent("page", {
      timeout: followTimeoutMs
    }).catch(() => undefined);

    const navigationDeadline = Date.now() + followTimeoutMs;
    while (Date.now() < navigationDeadline) {
      const newPage = await Promise.race([newPagePromise, previousPage.waitForTimeout(50).then(() => undefined)]);
      if (newPage) {
        await newPage.waitForLoadState("domcontentloaded").catch(() => undefined);
        session.page = newPage;
        await this.refreshSessionDefinition(session);
        return this.buildObservation(session);
      }

      const currentUrl = previousPage.url();
      const currentTitle = await previousPage.title();
      if (currentUrl !== previousUrl || currentTitle !== previousTitle) {
        session.page = previousPage;
        await this.refreshSessionDefinition(session);
        return this.buildObservation(session);
      }

      await previousPage.waitForTimeout(250);
    }

    throw new Error(`Timed out waiting for navigation follow on system ${systemId}`);
  }

  private async getBrowser(): Promise<Browser> {
    if (!this.browserPromise) {
      this.browserPromise = this.connectBrowser();
    }
    return this.browserPromise;
  }

  private async getContext(): Promise<BrowserContext> {
    if (!this.contextPromise) {
      this.contextPromise = this.getBrowser().then(async (browser) => browser.contexts()[0] ?? browser.newContext());
    }
    return this.contextPromise;
  }

  private async connectBrowser(): Promise<Browser> {
    await this.assertCdpEndpoint();

    try {
      return await chromium.connectOverCDP(this.cdpUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to connect to Chrome DevTools at ${this.cdpUrl}. ${message}`);
    }
  }

  private async assertCdpEndpoint(): Promise<void> {
    const versionUrl = `${this.cdpUrl.replace(/\/$/, "")}/json/version`;
    let response: Response;
    try {
      response = await fetch(versionUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Chrome DevTools endpoint is not reachable at ${versionUrl}. ${message}`);
    }

    if (!response.ok) {
      throw new Error(`Chrome DevTools endpoint responded with HTTP ${response.status} at ${versionUrl}.`);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Chrome DevTools endpoint returned invalid JSON at ${versionUrl}. ${message}`);
    }

    const record = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
    if (typeof record.webSocketDebuggerUrl !== "string" || record.webSocketDebuggerUrl.length === 0) {
      throw new Error(`Chrome DevTools endpoint at ${versionUrl} did not expose webSocketDebuggerUrl.`);
    }
  }

  private async getOrCreateSession(systemId: string): Promise<LiveChromeSession> {
    const existing = this.sessions.get(systemId);
    if (existing) {
      return existing;
    }
    const definition = getWebSystemDefinition(systemId);
    const context = await this.getContext();
    const pages = context.pages();
    const page = pages[0] ?? (await context.newPage());
    if (page.url() === "about:blank") {
      await page.goto(definition.url, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(250);
    }
    const session = {
      sessionId: `live-${crypto.randomUUID()}`,
      systemId,
      definition,
      page
    };
    this.sessions.set(systemId, session);
    return session;
  }

  private async refreshSessionDefinition(session: LiveChromeSession): Promise<void> {
    const url = session.page.url();
    const matched = matchWebSystemByUrl(url);
    if (matched) {
      session.systemId = matched.systemId;
      session.definition = matched;
    }
  }

  private async buildObservation(session: LiveChromeSession): Promise<PageObservation> {
    const title = await session.page.title();
    const url = session.page.url();
    const rawElements = await session.page.evaluate(() => {
      const isVisible = (element: Element): boolean => {
        const htmlElement = element as HTMLElement;
        const style = window.getComputedStyle(htmlElement);
        const rect = htmlElement.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };

      const getLabelText = (element: Element): string => {
        const htmlElement = element as HTMLElement;
        if (htmlElement.getAttribute("aria-label")) {
          return htmlElement.getAttribute("aria-label") ?? "";
        }
        const id = htmlElement.getAttribute("id");
        if (id) {
          const label = document.querySelector(`label[for="${id}"]`);
          if (label?.textContent) {
            return label.textContent.trim();
          }
        }
        const parentLabel = htmlElement.closest("label");
        if (parentLabel?.textContent) {
          return parentLabel.textContent.trim();
        }
        return "";
      };

      return Array.from(document.querySelectorAll("input, textarea, select, button"))
        .filter((element) => isVisible(element))
        .map((element) => {
          const htmlElement = element as HTMLElement;
          const control = htmlElement as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement;
          const isValueControl =
            control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement;

          return {
            tagName: htmlElement.tagName.toLowerCase(),
            inputType: htmlElement instanceof HTMLInputElement ? htmlElement.type : "",
            name: htmlElement.getAttribute("name") ?? "",
            id: htmlElement.getAttribute("id") ?? "",
            role: htmlElement.getAttribute("role") ?? "",
            label: getLabelText(element),
            text: htmlElement.innerText || htmlElement.textContent || "",
            placeholder: htmlElement.getAttribute("placeholder") ?? "",
            ariaLabel: htmlElement.getAttribute("aria-label") ?? "",
            value: isValueControl ? control.value : "",
            required: htmlElement.hasAttribute("required") || htmlElement.getAttribute("aria-required") === "true"
          } satisfies LiveDomElementSnapshot;
        });
    });
    const pageText = await session.page.evaluate(() => (document.body?.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 4000));

    const interactiveElements = mapLiveDomElements(rawElements, session.definition);
    const requiredMissingCount = interactiveElements.filter(
      (element) => element.required && (element.value === undefined || element.value === "")
    ).length;

    return {
      sessionId: session.sessionId,
      systemId: session.definition.systemId,
      pageId: session.definition.pageId,
      url,
      title: title || session.definition.title,
      summary: `${session.definition.title} observed through live Chrome session. Missing required fields: ${requiredMissingCount}.`,
      pageText,
      interactiveElements,
      finalActionButton: session.definition.finalActionButton
    };
  }
}
