import type { AutomationClient } from "../../infrastructure/windows/automation/automation-client.js";
import type {
  AutomationElementSnapshot,
  AutomationInventoryResult,
} from "../../infrastructure/windows/automation/automation-types.js";
import {
  isButtonLikeControl,
  normalizeAutomationText,
} from "../../infrastructure/windows/automation/automation-element.js";

const SHAPE_HINTS = [
  "shape",
  "forma",
  "formas",
  "shapes",
  "rectangle",
  "rectangulo",
  "triangle",
  "line",
  "arrow",
  "diamond",
  "ellipse",
  "oval",
];

export interface ShapeCandidateSummary {
  id: string;
  displayName: string;
  automationId: string;
  controlType: string;
  supportedPatterns: string[];
}

export interface ResolvedShapeGroup {
  id: string;
  displayName: string;
  controls: ShapeCandidateSummary[];
}

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

export function buildShapeGroups(
  inventory: AutomationInventoryResult,
): ResolvedShapeGroup[] {
  const byId = new Map(inventory.elements.map((element) => [element.id, element]));
  const childrenByParent = new Map<string, AutomationElementSnapshot[]>();

  for (const element of inventory.elements) {
    if (element.parentId === null) {
      continue;
    }
    const bucket = childrenByParent.get(element.parentId) ?? [];
    bucket.push(element);
    childrenByParent.set(element.parentId, bucket);
  }

  function collectDescendants(parentId: string, maxDepthDelta: number): AutomationElementSnapshot[] {
    const parent = byId.get(parentId);
    if (!parent) {
      return [];
    }

    const results: AutomationElementSnapshot[] = [];
    const queue: AutomationElementSnapshot[] = [...(childrenByParent.get(parentId) ?? [])];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        continue;
      }
      if (current.depth - parent.depth > maxDepthDelta) {
        continue;
      }
      results.push(current);
      queue.push(...(childrenByParent.get(current.id) ?? []));
    }
    return results;
  }

  const groups: ResolvedShapeGroup[] = [];
  for (const parent of inventory.elements) {
    if (parent.controlType !== "Group") {
      continue;
    }

    const normalizedParent = `${normalizeAutomationText(parent.name)} ${normalizeAutomationText(parent.automationId)}`;
    if (!SHAPE_HINTS.some((hint) => normalizedParent.includes(hint))) {
      continue;
    }

    const descendants = collectDescendants(parent.id, 2);
    const controls = descendants.filter(
      (child) => child.visible && child.enabled && isButtonLikeControl(child.controlType),
    );
    if (controls.length < 4) {
      continue;
    }

    groups.push({
      id: normalizedParent.includes("forma") || normalizedParent.includes("shape") ? "shapes" : parent.id,
      displayName: parent.name || parent.automationId || parent.className || "Shapes",
      controls: controls.map((control) => ({
        id: normalizeAutomationText(control.name) || control.id,
        displayName: control.name,
        automationId: control.automationId,
        controlType: control.controlType,
        supportedPatterns: control.supportedPatterns,
      })),
    });
  }

  if (groups.length > 0) {
    return groups;
  }

  const paintShapesGroup = inventory.elements.find((element) => {
    if (element.controlType !== "Group") {
      return false;
    }
    const normalizedName = normalizeAutomationText(element.name);
    return normalizedName.includes("formas") || normalizedName.includes("shapes");
  });

  if (!paintShapesGroup) {
    return groups;
  }

  const list = inventory.elements.find(
    (element) => element.parentId === paintShapesGroup.id && element.controlType === "List",
  );
  if (!list) {
    return groups;
  }

  const controls = inventory.elements
    .filter((element) => element.parentId === list.id)
    .filter((element) => element.visible && element.enabled)
    .filter((element) => isButtonLikeControl(element.controlType));

  if (controls.length === 0) {
    return groups;
  }

  return [
    {
      id: "shapes",
      displayName: paintShapesGroup.name || "Shapes",
      controls: controls.map((control) => ({
        id: normalizeAutomationText(control.name) || control.id,
        displayName: control.name,
        automationId: control.automationId,
        controlType: control.controlType,
        supportedPatterns: control.supportedPatterns,
      })),
    },
  ];
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
