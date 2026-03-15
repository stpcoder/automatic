import type { InteractiveElement } from "./types.js";
import type { WebSystemDefinition } from "./system-definitions.js";

export interface LiveDomElementSnapshot {
  tagName: string;
  inputType?: string;
  name?: string;
  id?: string;
  role?: string;
  label?: string;
  text?: string;
  placeholder?: string;
  ariaLabel?: string;
  value?: string;
  required?: boolean;
}

export function normalizeDomText(value: string | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function slugifyDomText(value: string | undefined): string {
  const normalized = normalizeDomText(value);
  return normalized.replace(/[^a-z0-9가-힣]+/g, "_").replace(/^_+|_+$/g, "") || "field";
}

export function inferElementType(snapshot: LiveDomElementSnapshot): InteractiveElement["type"] {
  const tagName = snapshot.tagName.toLowerCase();
  if (tagName === "button") {
    return "button";
  }
  if (tagName === "select") {
    return "select";
  }
  if (snapshot.inputType === "submit" || snapshot.inputType === "button") {
    return "button";
  }
  return "input";
}

export function resolveSemanticKey(snapshot: LiveDomElementSnapshot, definition: WebSystemDefinition): string {
  const candidates = [
    snapshot.label,
    snapshot.text,
    snapshot.ariaLabel,
    snapshot.placeholder,
    snapshot.name,
    snapshot.id
  ].map(normalizeDomText);

  for (const field of definition.fields) {
    const aliases = [field.key, field.label, ...(field.aliases ?? [])].map(normalizeDomText);
    if (aliases.some((alias) => candidates.includes(alias))) {
      return field.key;
    }
  }

  const fallback = snapshot.name || snapshot.id || snapshot.label || snapshot.text || "field";
  return slugifyDomText(fallback);
}

export function resolveElementLabel(snapshot: LiveDomElementSnapshot): string {
  return snapshot.label || snapshot.ariaLabel || snapshot.text || snapshot.placeholder || snapshot.name || snapshot.id || "Field";
}

export function mapLiveDomElements(
  snapshots: LiveDomElementSnapshot[],
  definition: WebSystemDefinition
): InteractiveElement[] {
  return snapshots.map((snapshot, index) => ({
    index,
    type: inferElementType(snapshot),
    key: resolveSemanticKey(snapshot, definition),
    label: resolveElementLabel(snapshot),
    value: snapshot.value ?? "",
    required: snapshot.required ?? false
  }));
}
