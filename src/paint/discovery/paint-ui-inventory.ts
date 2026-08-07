import type { AutomationClient } from "../../infrastructure/windows/automation/automation-client.js";
import type { AutomationInventoryResult } from "../../infrastructure/windows/automation/automation-types.js";
import { buildShapeGroups } from "./shape-tool-resolver.js";
import { normalizeAutomationText } from "../../infrastructure/windows/automation/automation-element.js";

export interface PaintInventoryOptions {
  maxDepth: number;
  includeBoundingRectangles: boolean;
  filter?: string;
}

export interface PaintInventorySummary {
  inventory: AutomationInventoryResult;
  groups: ReturnType<typeof buildShapeGroups>;
  uiLanguageHint: {
    detected: string;
    source: string;
    evidence: string[];
  };
}

function detectUiLanguageHint(inventory: AutomationInventoryResult) {
  const names = inventory.elements
    .map((element) => element.name)
    .filter((value) => typeof value === "string" && value.trim().length > 0);

  const normalized = names.map((name) => normalizeAutomationText(name));
  const spanishEvidence = names.filter((name) => {
    const value = normalizeAutomationText(name);
    return [
      "formas",
      "elipse",
      "archivo",
      "herramientas",
      "sin titulo paint",
      "seleccionar",
    ].some((token) => value.includes(token));
  });
  if (spanishEvidence.length > 0) {
    return {
      detected: "es",
      source: "accessible-names",
      evidence: spanishEvidence.slice(0, 8),
    };
  }

  const englishEvidence = names.filter((name) => {
    const value = normalizeAutomationText(name);
    return [
      "shapes",
      "ellipse",
      "file",
      "tools",
      "untitled paint",
      "select",
    ].some((token) => value.includes(token));
  });
  if (englishEvidence.length > 0) {
    return {
      detected: "en",
      source: "accessible-names",
      evidence: englishEvidence.slice(0, 8),
    };
  }

  return {
    detected: "unknown",
    source: "accessible-names",
    evidence: normalized.slice(0, 5),
  };
}

export async function discoverPaintInventory(
  automationClient: AutomationClient,
  windowHandleHex: string,
  processId: number,
  className: string,
  windowTitle: string,
  options: PaintInventoryOptions,
): Promise<PaintInventorySummary> {
  const inventory = await automationClient.inventory({
    windowHandleHex,
    processId,
    className,
    windowTitle,
    maxDepth: options.maxDepth,
    includeBoundingRectangles: options.includeBoundingRectangles,
  });

  const groups = buildShapeGroups(inventory).map((group) => {
    if (!options.filter) {
      return group;
    }
    const filter = options.filter.toLowerCase();
    const controls = group.controls.filter((control) =>
      `${control.displayName} ${control.automationId} ${control.controlType}`
        .toLowerCase()
        .includes(filter),
    );
    return { ...group, controls };
  }).filter((group) => group.controls.length > 0 || !options.filter);

  return {
    inventory,
    groups,
    uiLanguageHint: detectUiLanguageHint(inventory),
  };
}
