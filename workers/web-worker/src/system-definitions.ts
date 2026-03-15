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
  summary: string;
  finalActionButton?: string;
  fields: WebFieldDefinition[];
  buttons: Array<{ key: string; label: string }>;
}

const WEB_SYSTEMS: Record<string, WebSystemDefinition> = {
  security_portal: {
    systemId: "security_portal",
    pageId: "export_registration",
    title: "Export Registration",
    url: "https://security.internal/export-registration",
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
      { key: "save_draft", label: "임시저장" },
      { key: "submit", label: "등록" }
    ]
  },
  dhl: {
    systemId: "dhl",
    pageId: "create_shipment",
    title: "Create Shipment",
    url: "https://mydhl.express.dhl/create-shipment",
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
