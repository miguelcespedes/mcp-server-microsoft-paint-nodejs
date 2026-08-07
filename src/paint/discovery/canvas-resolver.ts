import { PaintMcpError } from "../../infrastructure/errors/paint-mcp-error.js";
import { normalizeAutomationText } from "../../infrastructure/windows/automation/automation-element.js";
import type { AutomationInventoryResult, AutomationElementSnapshot } from "../../infrastructure/windows/automation/automation-types.js";
import * as proc from "../../infrastructure/win32/process.js";

const FALLBACK_CANVAS_ORIGIN = { x: 513, y: 220 };

export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PaintCanvas {
  bounds: Rectangle;
  clientOrigin: { x: number; y: number };
  screenOrigin: { x: number; y: number };
  width: number;
  height: number;
  logicalWidth: number;
  logicalHeight: number;
  source: "automation" | "fixed-layout";
  elementName?: string;
  automationId?: string;
  drawableInset?: { x: number; y: number };
}

export interface ActiveCanvasDebugInfo {
  name: string;
  automationId: string;
  controlType: string;
  className: string;
  boundingRectangle: { left: number; top: number; width: number; height: number } | null;
  clickablePoint?: { x: number; y: number };
  logicalSize?: { width: number; height: number };
  runtimeId: number[];
}

export function parseWindowHandleHex(windowHandleHex: string): bigint {
  return BigInt(windowHandleHex);
}

export function serializeWindowHandle(hwnd: bigint): string {
  return `0x${hwnd.toString(16).padStart(16, "0")}`;
}

export function ensurePointsInsideCanvas(
  canvas: PaintCanvas,
  points: { x: number; y: number }[],
  path: string,
): void {
  points.forEach((point, index) => {
    if (!Number.isInteger(point.x) || !Number.isInteger(point.y)) {
      throw new PaintMcpError(
        "INVALID_CANVAS_BOUNDS",
        `${path}[${index}] must use integer coordinates.`,
        point,
      );
    }
    if (
      point.x < 0 ||
      point.y < 0 ||
      point.x >= canvas.logicalWidth ||
      point.y >= canvas.logicalHeight
    ) {
      throw new PaintMcpError(
        "DRAW_BOUNDS_OUTSIDE_CANVAS",
        `${path}[${index}] (${point.x}, ${point.y}) is outside the resolved Paint canvas.`,
        { canvas, point, index },
      );
    }
  });
}

export function canvasPointsToClientPoints(
  canvas: PaintCanvas,
  points: { x: number; y: number }[],
  path: string,
): { x: number; y: number }[] {
  ensurePointsInsideCanvas(canvas, points, path);
  const inset = canvas.drawableInset ?? { x: 0, y: 0 };
  const drawableWidth = canvas.width - inset.x * 2;
  const drawableHeight = canvas.height - inset.y * 2;

  return points.map((point) => ({
    x:
      canvas.clientOrigin.x +
      inset.x +
      Math.round((point.x / canvas.logicalWidth) * drawableWidth),
    y:
      canvas.clientOrigin.y +
      inset.y +
      Math.round((point.y / canvas.logicalHeight) * drawableHeight),
  }));
}

function parseCanvasLogicalSize(
  inventory: AutomationInventoryResult | undefined,
): { width: number; height: number } | null {
  const sizeElement = (inventory?.elements ?? []).find((element) => {
    return normalizeAutomationText(element.automationId) === "canvassizetextblock";
  });

  if (!sizeElement) {
    return null;
  }

  const matches = sizeElement.name.match(/(\d+)\D+(\d+)/);
  if (!matches) {
    return null;
  }

  const width = Number(matches[1]);
  const height = Number(matches[2]);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return null;
  }

  return { width, height };
}

export function resolvePaintCanvas(
  windowHandleHex: string,
  inventory?: AutomationInventoryResult,
): PaintCanvas {
  const hwnd = parseWindowHandleHex(windowHandleHex);
  const clientSize = proc.getClientSize(hwnd);
  const clientOriginOnScreen = proc.clientToScreen(hwnd, { x: 0, y: 0 });
  const logicalSize = parseCanvasLogicalSize(inventory);

  function toCanvasFromElement(element: AutomationElementSnapshot): PaintCanvas | null {
    if (!element.boundingRectangle) {
      return null;
    }

    const clientOrigin = {
      x: element.boundingRectangle.left - clientOriginOnScreen.x,
      y: element.boundingRectangle.top - clientOriginOnScreen.y,
    };
    if (clientOrigin.x < 0 || clientOrigin.y < 0) {
      return null;
    }

    return {
      bounds: {
        x: clientOrigin.x,
        y: clientOrigin.y,
        width: element.boundingRectangle.width,
        height: element.boundingRectangle.height,
      },
      clientOrigin,
      screenOrigin: {
        x: element.boundingRectangle.left,
        y: element.boundingRectangle.top,
      },
      width: element.boundingRectangle.width,
      height: element.boundingRectangle.height,
      logicalWidth: logicalSize?.width ?? element.boundingRectangle.width,
      logicalHeight: logicalSize?.height ?? element.boundingRectangle.height,
      source: "automation",
      elementName: element.name,
      automationId: element.automationId,
      // Paint exposes the semantic canvas including its resize handles/border.
      // A small inset keeps the drag inside the actual drawable white page.
      drawableInset: { x: 8, y: 8 },
    };
  }

  const semanticCanvas = (inventory?.elements ?? []).find((element) => {
    if (!element.visible || !element.boundingRectangle) {
      return false;
    }

    const normalizedName = normalizeAutomationText(element.name);
    const normalizedAutomationId = normalizeAutomationText(element.automationId);

    const hasCanvasIdentity =
      normalizedAutomationId === "image" ||
      normalizedName.includes("lienzo") ||
      normalizedName.includes("canvas") ||
      normalizedName.includes("en el lienzo") ||
      normalizedName.includes("on the canvas");

    if (!hasCanvasIdentity) {
      return false;
    }

    return (
      element.boundingRectangle.width > 200 &&
      element.boundingRectangle.height > 200
    );
  });

  const semanticCanvasResolved =
    semanticCanvas !== undefined ? toCanvasFromElement(semanticCanvas) : null;
  if (semanticCanvasResolved) {
    return semanticCanvasResolved;
  }

  const candidates = (inventory?.elements ?? []).filter((element: AutomationElementSnapshot) => {
    if (!element.visible || !element.boundingRectangle) {
      return false;
    }
    const controlType = element.controlType;
    if (!new Set(["Pane", "Custom", "Document", "Image", "Group"]).has(controlType)) {
      return false;
    }
    const name = normalizeAutomationText(element.name);
    const automationId = normalizeAutomationText(element.automationId);
    if (name.includes("ribbon") || automationId.includes("ribbon")) {
      return false;
    }
    return (
      element.boundingRectangle.width > 300 &&
      element.boundingRectangle.height > 250
    );
  });

  function candidateScore(element: AutomationElementSnapshot): number {
    if (!element.boundingRectangle) {
      return Number.NEGATIVE_INFINITY;
    }

    const name = normalizeAutomationText(element.name);
    const automationId = normalizeAutomationText(element.automationId);
    const area = element.boundingRectangle.width * element.boundingRectangle.height;
    let score = 0;

    // Strong positive signals observed in modern Paint.
    if (automationId === "image") {
      score += 10_000;
    }
    if (name.includes("lienzo") || name.includes("canvas")) {
      score += 8_000;
    }
    if (name.includes("herramienta brocha") || name.includes("brush tool")) {
      score += 5_000;
    }

    // Prefer plausible canvas sizes over huge container panes.
    if (element.boundingRectangle.width <= clientSize.width - 100) {
      score += 500;
    }
    if (element.boundingRectangle.height <= clientSize.height - 100) {
      score += 500;
    }

    // Avoid selecting the full-window content host.
    if (
      element.boundingRectangle.width >= clientSize.width - 5 &&
      element.boundingRectangle.height >= clientSize.height - 5
    ) {
      score -= 3_000;
    }

    return score + area / 10_000;
  }

  const best = candidates.sort((left, right) => candidateScore(right) - candidateScore(left))[0];

  if (best?.boundingRectangle) {
    const clientOrigin = {
      x: best.boundingRectangle.left - clientOriginOnScreen.x,
      y: best.boundingRectangle.top - clientOriginOnScreen.y,
    };
    if (clientOrigin.x >= 0 && clientOrigin.y >= 0) {
      return {
        bounds: {
          x: clientOrigin.x,
          y: clientOrigin.y,
          width: best.boundingRectangle.width,
          height: best.boundingRectangle.height,
        },
        clientOrigin,
        screenOrigin: {
          x: best.boundingRectangle.left,
          y: best.boundingRectangle.top,
        },
        width: best.boundingRectangle.width,
        height: best.boundingRectangle.height,
        logicalWidth: logicalSize?.width ?? best.boundingRectangle.width,
        logicalHeight: logicalSize?.height ?? best.boundingRectangle.height,
        source: "automation",
        elementName: best.name,
        automationId: best.automationId,
      };
    }
  }

  const fallbackWidth = clientSize.width - FALLBACK_CANVAS_ORIGIN.x;
  const fallbackHeight = clientSize.height - FALLBACK_CANVAS_ORIGIN.y;
  if (fallbackWidth <= 0 || fallbackHeight <= 0) {
    throw new PaintMcpError(
      "CANVAS_NOT_FOUND",
      "Paint canvas could not be resolved through UI Automation or the fixed-layout fallback.",
      { clientSize },
    );
  }

  return {
    bounds: {
      x: FALLBACK_CANVAS_ORIGIN.x,
      y: FALLBACK_CANVAS_ORIGIN.y,
      width: fallbackWidth,
      height: fallbackHeight,
    },
    clientOrigin: { ...FALLBACK_CANVAS_ORIGIN },
    screenOrigin: proc.clientToScreen(hwnd, FALLBACK_CANVAS_ORIGIN),
    width: fallbackWidth,
    height: fallbackHeight,
    logicalWidth: logicalSize?.width ?? fallbackWidth,
    logicalHeight: logicalSize?.height ?? fallbackHeight,
    source: "fixed-layout",
    automationId: "fixed-layout",
    drawableInset: { x: 0, y: 0 },
  };
}

export function getActiveCanvasDebugInfo(
  inventory: AutomationInventoryResult,
): ActiveCanvasDebugInfo | null {
  const candidate = inventory.elements.find((element) => {
    const normalizedAutomationId = normalizeAutomationText(element.automationId);
    const normalizedName = normalizeAutomationText(element.name);
    return (
      normalizedAutomationId === "image" ||
      normalizedName.includes("en el lienzo") ||
      normalizedName.includes("on the canvas") ||
      normalizedName.includes("lienzo") ||
      normalizedName.includes("canvas")
    );
  });

  if (!candidate) {
    return null;
  }

  return {
    name: candidate.name,
    automationId: candidate.automationId,
    controlType: candidate.controlType,
    className: candidate.className,
    boundingRectangle: candidate.boundingRectangle,
    runtimeId: candidate.runtimeId,
  };
}
