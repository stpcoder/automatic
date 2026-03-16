export interface InteractiveElement {
  index: number;
  type: "input" | "button" | "select" | "text";
  key: string;
  label: string;
  value?: string;
  required?: boolean;
}

export interface PageObservation {
  systemId: string;
  pageId: string;
  url: string;
  title: string;
  summary: string;
  pageText?: string;
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
  openSystem(systemId: string, pageId?: string): Promise<PageObservation>;
  observe(systemId: string): Promise<PageObservation>;
  fillForm(systemId: string, values: Record<string, unknown>): Promise<FillResult>;
  previewSubmission(systemId: string): Promise<PreviewResult>;
  submit(systemId: string, expectedButton: string): Promise<SubmitResult>;
}
