import { PaintMcpError } from "../../infrastructure/errors/paint-mcp-error.js";
import {
  isButtonLikeControl,
  normalizeAutomationText,
  toAutomationReference,
} from "../../infrastructure/windows/automation/automation-element.js";
import type { AutomationClient } from "../../infrastructure/windows/automation/automation-client.js";
import type {
  AutomationElementSnapshot,
  AutomationInventoryResult,
} from "../../infrastructure/windows/automation/automation-types.js";
import { EllipseTool } from "../shapes/ellipse-tool.js";

const ELLIPSE_ALIASES = [
  "ellipse",
  "elipse",
  "ellipse shape",
  "oval",
  "ovalo",
  "oval shape",
];

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

export function isShapeFormattingEnabled(
  inventory: AutomationInventoryResult,
): boolean {
  const formattingHints = [
    "shape outline",
    "shape fill",
    "size",
    "contorno de forma",
    "relleno de forma",
    "tamano",
  ];

  return inventory.elements.some((element) => {
    if (!element.enabled) {
      return false;
    }
    const haystack = `${normalizeAutomationText(element.name)} ${normalizeAutomationText(element.automationId)}`;
    return formattingHints.some((hint) => haystack.includes(hint));
  });
}

export function findElementByAccessibleAlias(
  inventory: AutomationInventoryResult,
  aliases: string[],
): AutomationElementSnapshot | null {
  const normalizedAliases = aliases.map((alias) => normalizeAutomationText(alias));
  const candidates = inventory.elements.filter((element) => {
    if (!element.visible || !element.enabled) {
      return false;
    }
    const haystack = `${normalizeAutomationText(element.name)} ${normalizeAutomationText(element.automationId)}`;
    return normalizedAliases.some((alias) => haystack.includes(alias));
  });

  if (candidates.length === 0) {
    return null;
  }

  return candidates[0];
}

export function findElementsByAnyAlias(
  inventory: AutomationInventoryResult,
  aliases: string[],
): AutomationElementSnapshot[] {
  const normalizedAliases = aliases.map((alias) => normalizeAutomationText(alias));
  return inventory.elements.filter((element) => {
    const haystack = `${normalizeAutomationText(element.name)} ${normalizeAutomationText(element.automationId)}`;
    return normalizedAliases.some((alias) => haystack.includes(alias));
  });
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

function aliasScore(element: AutomationElementSnapshot): number {
  const normalizedName = normalizeAutomationText(element.name);
  const normalizedAutomationId = normalizeAutomationText(element.automationId);

  if (ELLIPSE_ALIASES.includes(normalizedAutomationId)) {
    return 100;
  }
  if (ELLIPSE_ALIASES.includes(normalizedName)) {
    return 80;
  }
  if (
    ELLIPSE_ALIASES.some(
      (alias) => normalizedAutomationId.includes(alias) || normalizedName.includes(alias),
    )
  ) {
    return 60;
  }
  return 0;
}

export function resolveEllipseTool(
  inventory: AutomationInventoryResult,
  windowHandleHex: string,
  automationClient: AutomationClient,
  processId?: number,
): EllipseTool {
  const groups = buildShapeGroups(inventory);
  const groupIds = new Set(groups.map((group) => group.id));
  const candidates = inventory.elements
    .filter(
      (element) =>
        element.visible &&
        element.enabled &&
        isButtonLikeControl(element.controlType) &&
        aliasScore(element) > 0,
    )
    .sort((left, right) => aliasScore(right) - aliasScore(left));

  if (candidates.length === 0) {
    throw new PaintMcpError(
      "ELLIPSE_TOOL_NOT_FOUND",
      "No ellipse-like tool could be discovered in the Paint UI Automation tree.",
      { groups },
    );
  }

  const topScore = aliasScore(candidates[0]);
  const best = candidates.filter((candidate) => aliasScore(candidate) === topScore);
  if (best.length > 1) {
    throw new PaintMcpError(
      "AMBIGUOUS_SHAPE_TOOL",
      "More than one ellipse-like control matched the current Paint UI tree.",
      {
        candidates: best.map((candidate) => ({
          id: candidate.id,
          name: candidate.name,
          automationId: candidate.automationId,
          controlType: candidate.controlType,
        })),
      },
    );
  }

  const candidate = best[0];
  const discovery =
    ELLIPSE_ALIASES.includes(normalizeAutomationText(candidate.automationId))
      ? {
          strategy: "automation-id",
          confidence: 1,
          matchedProperties: { automationId: candidate.automationId },
        }
      : groupIds.has(candidate.parentId ?? "")
        ? {
            strategy: "shape-group-accessible-name",
            confidence: 0.8,
            matchedProperties: {
              name: candidate.name,
              parentId: candidate.parentId,
            },
          }
        : {
            strategy: "accessible-name",
            confidence: 0.6,
            matchedProperties: { name: candidate.name },
          };

  return new EllipseTool(
    candidate.name || candidate.automationId || "Ellipse",
    toAutomationReference(windowHandleHex, candidate, processId),
    discovery,
    automationClient,
  );
}
