export interface InteractiveElement {
  index: number;
  type: "input" | "button" | "select" | "text" | "link";
  key: string;
  label: string;
  value?: string;
  required?: boolean;
  action?: "type" | "click" | "select";
  href?: string;
  region?: "main" | "header" | "nav" | "footer" | "aside" | "unknown";
}

export interface PageObservation {
  sessionId?: string;
  parentSessionId?: string;
  systemId: string;
  pageId: string;
  url: string;
  title: string;
  summary: string;
  pageText?: string;
  visibleTextBlocks?: string[];
  interactiveElements: InteractiveElement[];
  finalActionButton?: string;
}

export interface HarnessPageDefinition {
  pageId: string;
  title: string;
  url: string;
  summary: string;
  finalActionButton?: string;
  interactiveElements: InteractiveElement[];
  meta?: Record<string, unknown>;
}

export interface FillResult {
  draftId: string;
  filledFields: Record<string, unknown>;
  observation: PageObservation;
}

export interface PreviewResult {
  previewId: string;
  observation: PageObservation;
}

export interface SubmitResult {
  recordId: string;
  observation: PageObservation;
}

export interface ClickResult {
  clickId: string;
  targetKey: string;
  observation: PageObservation;
}

export interface ScrollResult {
  scrollId: string;
  observation: PageObservation;
}

export interface TypeTextResult {
  typingId: string;
  observation: PageObservation;
  text: string;
  targetKey?: string;
}

export interface ExtractResult {
  extractionId: string;
  observation: PageObservation;
  query: string;
  goal: string;
  goalSatisfied: boolean;
  matchedSnippets: string[];
  summary: string;
}

export interface WebOpenSelection {
  sessionId?: string;
  targetUrl?: string;
  urlContains?: string;
  titleContains?: string;
  openIfMissing?: boolean;
}

export interface WebAdapter {
  readonly harnessName: string;
  openSystem(systemId: string, pageId?: string, selection?: WebOpenSelection): Promise<PageObservation>;
  observe(systemId: string, sessionId?: string): Promise<PageObservation>;
  fillForm(systemId: string, values: Record<string, unknown>, sessionId?: string): Promise<FillResult>;
  typeText?(
    systemId: string,
    text: string,
    sessionId?: string,
    targetKey?: string,
    submitKey?: string
  ): Promise<TypeTextResult>;
  clickElement(systemId: string, targetKey: string, sessionId?: string): Promise<ClickResult>;
  scrollPage?(systemId: string, direction: "up" | "down", amount?: number, sessionId?: string): Promise<ScrollResult>;
  previewSubmission(systemId: string, sessionId?: string): Promise<PreviewResult>;
  submit(systemId: string, expectedButton: string, sessionId?: string): Promise<SubmitResult>;
  followNavigation?(systemId: string, sessionId?: string): Promise<PageObservation>;
}
