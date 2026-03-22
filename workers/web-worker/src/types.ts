export interface InteractiveElement {
  index: number;
  handle?: string;
  type: "input" | "button" | "select" | "text" | "link";
  key: string;
  label: string;
  value?: string;
  required?: boolean;
  action?: "type" | "click" | "select";
  href?: string;
  region?: "main" | "header" | "nav" | "footer" | "aside" | "unknown";
  semanticRole?:
    | "search_input"
    | "form_field"
    | "primary_action"
    | "secondary_action"
    | "result_link"
    | "detail_link"
    | "navigation_link"
    | "unknown";
  importance?: number;
  nearbyText?: string;
  domPath?: string;
}

export interface SemanticBlock {
  id: string;
  type: "heading" | "paragraph" | "result_item" | "price" | "summary" | "form_area" | "label_value";
  text: string;
  title?: string;
  region?: "main" | "header" | "nav" | "footer" | "aside" | "unknown";
  importance: number;
  relatedKeys?: string[];
}

export interface KeyMetric {
  label: string;
  value: string;
  unit?: string;
  context?: string;
  importance: number;
}

export interface ActionableCard {
  id: string;
  type: "search_result" | "article" | "product" | "metric_panel" | "generic";
  title: string;
  subtitle?: string;
  summary?: string;
  source?: string;
  href?: string;
  targetKey?: string;
  targetHandle?: string;
  importance: number;
}

export type ObservationFocus = "default" | "cards" | "metrics" | "content" | "forms";

export interface PageObservation {
  sessionId?: string;
  parentSessionId?: string;
  systemId: string;
  pageId: string;
  url: string;
  title: string;
  summary: string;
  pageText?: string;
  domOutline?: string;
  visibleTextBlocks?: string[];
  semanticBlocks?: SemanticBlock[];
  keyMetrics?: KeyMetric[];
  actionableCards?: ActionableCard[];
  interactiveElements: InteractiveElement[];
  finalActionButton?: string;
  focusUsed?: ObservationFocus;
  recommendedFocus?: ObservationFocus;
  focusReason?: string;
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
  targetHandle?: string;
  previousPage?: {
    sessionId?: string;
    title?: string;
    url?: string;
    summary?: string;
  };
  target?: {
    handle?: string;
    key: string;
    label: string;
    href?: string;
    semanticRole?: InteractiveElement["semanticRole"];
    domPath?: string;
    nearbyText?: string;
  };
  navigationEvent?: {
    kind: "same_session" | "child_session" | "none" | "uncertain";
    expectedNavigation: boolean;
    matchedExpectation: boolean;
    currentSessionChanged: boolean;
    newSessionOpened: boolean;
    fromSessionId?: string;
    toSessionId?: string;
    fromUrl?: string;
    toUrl?: string;
    fromTitle?: string;
    toTitle?: string;
  };
  observation: PageObservation;
}

export interface ScrollResult {
  scrollId: string;
  observation: PageObservation;
}

export interface HistoryNavigationResult {
  navigationId: string;
  direction: "back" | "forward";
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

export interface WebOpenSelection {
  sessionId?: string;
  targetUrl?: string;
  urlContains?: string;
  titleContains?: string;
  openIfMissing?: boolean;
}

export interface ObservationOptions {
  focus?: ObservationFocus;
}

export interface WebAdapter {
  readonly harnessName: string;
  openSystem(systemId: string, pageId?: string, selection?: WebOpenSelection): Promise<PageObservation>;
  observe(systemId: string, sessionId?: string, options?: ObservationOptions): Promise<PageObservation>;
  fillForm(systemId: string, values: Record<string, unknown>, sessionId?: string): Promise<FillResult>;
  clickElement(systemId: string, targetKey: string, sessionId?: string, targetHandle?: string): Promise<ClickResult>;
  scrollPage?(systemId: string, direction: "up" | "down", amount?: number, sessionId?: string): Promise<ScrollResult>;
  navigateHistory?(systemId: string, direction: "back" | "forward", sessionId?: string): Promise<HistoryNavigationResult>;
  previewSubmission(systemId: string, sessionId?: string): Promise<PreviewResult>;
  submit(systemId: string, expectedButton: string, sessionId?: string): Promise<SubmitResult>;
  followNavigation?(systemId: string, sessionId?: string, options?: ObservationOptions): Promise<PageObservation>;
}
