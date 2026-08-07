import type {
  AutomationElementReference,
  AutomationElementSnapshot,
} from "./automation-types.js";

export function toAutomationReference(
  windowHandleHex: string,
  element: AutomationElementSnapshot,
  processId?: number,
): AutomationElementReference {
  return {
    stableId: element.id,
    runtimeId: element.runtimeId,
    windowHandleHex,
    ...(processId === undefined ? {} : { processId }),
    name: element.name,
    automationId: element.automationId,
    controlType: element.controlType,
    className: element.className,
    boundingRectangle: element.boundingRectangle,
    supportedPatterns: element.supportedPatterns,
  };
}

export function normalizeAutomationText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/�/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function isButtonLikeControl(controlType: string): boolean {
  return new Set(["Button", "SplitButton", "ToggleButton", "Custom", "RadioButton", "ListItem"])
    .has(controlType);
}
