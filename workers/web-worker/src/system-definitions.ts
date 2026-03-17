import type { HarnessPageDefinition, InteractiveElement } from "./types.js";

export interface WebFieldDefinition {
  key: string;
  label: string;
  aliases?: string[];
  required?: boolean;
  type?: "input" | "select";
}

export interface WebSystemDefinition {
  systemId: string;
  pageId: string;
  title: string;
  url: string;
  urlPatterns?: string[];
  summary: string;
  finalActionButton?: string;
  resultIndicators?: string[];
  fields: WebFieldDefinition[];
  buttons: Array<{ key: string; label: string; aliases?: string[] }>;
}

const WEB_SYSTEMS: Record<string, WebSystemDefinition> = {
  security_portal: {
    systemId: "security_portal",
    pageId: "export_registration",
    title: "Export Registration",
    url: "https://security.internal/export-registration",
    urlPatterns: ["https://security.internal/*"],
    summary: "Security export registration form is open.",
    finalActionButton: "등록",
    fields: [
      { key: "traveler_name", label: "출장자명", aliases: ["traveler name"], required: true },
      { key: "destination_country", label: "국가", aliases: ["destination country"], required: true },
      { key: "customs_number", label: "통관번호", aliases: ["customs number"], required: true },
      { key: "receiver_address", label: "수령지", aliases: ["receiver address"], required: false },
      { key: "serial_number", label: "시리얼번호", aliases: ["serial number"], required: false }
    ],
    buttons: [
      { key: "save_draft", label: "임시저장", aliases: ["save draft"] },
      { key: "submit", label: "등록", aliases: ["submit", "register"] }
    ]
  },
  dhl: {
    systemId: "dhl",
    pageId: "create_shipment",
    title: "Create Shipment",
    url: "https://mydhl.express.dhl/create-shipment",
    urlPatterns: ["https://mydhl.express.dhl/*"],
    summary: "DHL shipment creation page is open.",
    finalActionButton: "Submit",
    fields: [
      { key: "receiver_address", label: "Receiver Address", aliases: ["수령지"], required: true },
      { key: "customs_number", label: "Customs Number", aliases: ["통관번호"], required: true },
      { key: "item_description", label: "Item Description", aliases: ["품목 설명"], required: true }
    ],
    buttons: [
      { key: "save_draft", label: "Save Draft" },
      { key: "submit", label: "Submit" }
    ]
  },
  cube: {
    systemId: "cube",
    pageId: "chat_room",
    title: "Cube Messenger",
    url: "https://cube.internal/chat",
    urlPatterns: ["https://cube.internal/*"],
    summary: "Cube chat room is open.",
    finalActionButton: "Send",
    fields: [
      { key: "message_body", label: "Message", aliases: ["message", "메시지", "chat message"], required: true }
    ],
    buttons: [{ key: "send", label: "Send", aliases: ["submit"] }]
  },
  web_generic: {
    systemId: "web_generic",
    pageId: "generic_page",
    title: "Generic Web Page",
    url: "https://example.com",
    urlPatterns: ["https://*/*", "http://*/*"],
    summary: "Generic web page is open.",
    finalActionButton: "Submit",
    fields: [],
    buttons: []
  }
};

export function getWebSystemDefinition(systemId: string, pageId?: string): WebSystemDefinition {
  const definition = WEB_SYSTEMS[systemId];
  if (definition) {
    return {
      ...definition,
      pageId: pageId ?? definition.pageId
    };
  }

  return {
    systemId,
    pageId: pageId ?? "default_page",
    title: `System ${systemId}`,
    url: `https://internal/${systemId}`,
    summary: `Page Agent DOM harness opened ${systemId}.`,
    finalActionButton: "Submit",
    fields: [],
    buttons: [{ key: "submit", label: "Submit" }]
  };
}

export function listWebSystemDefinitions(): WebSystemDefinition[] {
  return Object.values(WEB_SYSTEMS).sort(compareDefinitionPriority);
}

export function matchWebSystemByUrl(url: string): WebSystemDefinition | undefined {
  return listWebSystemDefinitions().find((definition) =>
    (definition.urlPatterns ?? []).some((pattern) => matchesUrlPattern(url, pattern))
  );
}

function compareDefinitionPriority(left: WebSystemDefinition, right: WebSystemDefinition): number {
  const leftSpecificity = definitionSpecificity(left);
  const rightSpecificity = definitionSpecificity(right);
  return rightSpecificity - leftSpecificity;
}

function definitionSpecificity(definition: WebSystemDefinition): number {
  const patterns = definition.urlPatterns ?? [];
  if (patterns.length === 0) {
    return 0;
  }
  return Math.max(
    ...patterns.map((pattern) => pattern.replace(/\*/g, "").length)
  );
}

function matchesUrlPattern(url: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(url);
}

export function buildHarnessPage(systemId: string, pageId?: string): HarnessPageDefinition {
  const definition = getWebSystemDefinition(systemId, pageId);
  const interactiveElements: InteractiveElement[] = [
    ...definition.fields.map((field, index) => ({
      index,
      type: field.type ?? "input",
      key: field.key,
      label: field.label,
      required: field.required ?? false,
      value: ""
    })),
    ...definition.buttons.map((button, buttonIndex) => ({
      index: definition.fields.length + buttonIndex,
      type: "button" as const,
      key: button.key,
      label: button.label
    }))
  ];

  return {
    pageId: definition.pageId,
    title: definition.title,
    url: definition.url,
    summary: definition.summary,
    finalActionButton: definition.finalActionButton,
    interactiveElements
  };
}
