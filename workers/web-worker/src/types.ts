export interface InteractiveElement {
  index: number;
  type: "input" | "button" | "select" | "text" | "link";
  key: string;
  label: string;
  value?: string;
  required?: boolean;
  action?: "type" | "click" | "select";
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

export interface ExtractResult {
  extractionId: string;
  observation: PageObservation;
  query: string;
  goal: string;
  goalSatisfied: boolean;
  matchedSnippets: string[];
  summary: string;
}

export interface WebAdapter {
  readonly harnessName: string;
  openSystem(systemId: string, pageId?: string, sessionId?: string): Promise<PageObservation>;
  observe(systemId: string, sessionId?: string): Promise<PageObservation>;
  fillForm(systemId: string, values: Record<string, unknown>, sessionId?: string): Promise<FillResult>;
  clickElement(systemId: string, targetKey: string, sessionId?: string): Promise<ClickResult>;
  previewSubmission(systemId: string, sessionId?: string): Promise<PreviewResult>;
  submit(systemId: string, expectedButton: string, sessionId?: string): Promise<SubmitResult>;
  followNavigation?(systemId: string, sessionId?: string): Promise<PageObservation>;
}
