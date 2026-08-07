import { PaintMcpError } from "../infrastructure/errors/paint-mcp-error.js";
import type { Logger } from "../infrastructure/logging/logger.js";
import type { AutomationClient } from "../infrastructure/windows/automation/automation-client.js";
import type { WindowMode } from "../infrastructure/windows/process/window-locator.js";
import * as proc from "../infrastructure/win32/process.js";
import * as win32 from "../infrastructure/win32/user32.js";
import {
  canvasBoundsToClientDrag,
  canvasBoundsToScreenDrag,
  getActiveCanvasDebugInfo,
  type EllipseBounds,
  resolvePaintCanvas,
  validateDurationMs,
} from "./discovery/canvas-resolver.js";
import {
  discoverPaintInventory,
  type PaintInventoryOptions,
} from "./discovery/paint-ui-inventory.js";
import {
  findElementByAccessibleAlias,
  findElementsByAnyAlias,
  isShapeFormattingEnabled,
  resolveEllipseTool,
} from "./discovery/shape-tool-resolver.js";
import { normalizeAutomationText } from "../infrastructure/windows/automation/automation-element.js";
import { PaintSessionStore } from "./session/paint-session.js";

export class PaintController {
  constructor(
    private readonly sessionStore: PaintSessionStore,
    private readonly automationClient: AutomationClient,
    private readonly logger: Logger,
  ) {}

  private async ensureEllipseSelection(
    session: {
      windowHandle: string;
      processId: number;
      className: string;
      windowTitle: string;
    },
    reason: "select" | "draw",
  ) {
    const discovered = await discoverPaintInventory(
      this.automationClient,
      session.windowHandle,
      session.processId,
      session.className,
      session.windowTitle,
      { maxDepth: 8, includeBoundingRectangles: true },
    );

    const ellipse = resolveEllipseTool(
      discovered.inventory,
      session.windowHandle,
      this.automationClient,
      session.processId,
    );

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      await ellipse.select();
      await proc.sleep(250);

      const refreshed = await discoverPaintInventory(
        this.automationClient,
        session.windowHandle,
        session.processId,
        session.className,
        session.windowTitle,
        { maxDepth: 8, includeBoundingRectangles: true },
      );
      const active = isShapeFormattingEnabled(refreshed.inventory);
      this.logger.debug("Ellipse selection verification", {
        reason,
        attempt,
        active,
      });

      if (active) {
        return {
          ellipse,
          inventory: refreshed.inventory,
        };
      }
    }

    throw new PaintMcpError(
      "ELLIPSE_TOOL_NOT_FOUND",
      "The ellipse tool was discovered but Paint did not expose shape-formatting controls after selection, so the shape does not appear to be active.",
    );
  }

  private async applyVisibleEllipseStyle(
    session: {
      windowHandle: string;
      processId: number;
      className: string;
      windowTitle: string;
    },
    inventory: Awaited<ReturnType<typeof discoverPaintInventory>>["inventory"],
  ): Promise<void> {
    const chooseDropdownOption = async (
      rect: { left: number; top: number; width: number; height: number },
      downSteps: number,
    ) => {
      await proc.clickAt({
        x: rect.left + Math.round(rect.width / 2),
        y: rect.top + Math.round(rect.height / 2),
      });
      await proc.sleep(220);
      proc.pressKey(win32.VK_HOME);
      await proc.sleep(80);
      for (let i = 0; i < downSteps; i += 1) {
        proc.pressKey(win32.VK_DOWN);
        await proc.sleep(70);
      }
      proc.pressKey(win32.VK_RETURN);
      await proc.sleep(180);
    };

    const blackSwatch = findElementByAccessibleAlias(inventory, [
      "Color 1: Negro",
      "Color 1: Black",
      "Negro",
      "Black",
    ]);

    if (!blackSwatch?.boundingRectangle) {
      this.logger.debug("Visible ellipse style could not find a black swatch", {
        windowHandle: session.windowHandle,
      });
    } else {
      await proc.clickAt({
        x: blackSwatch.boundingRectangle.left + Math.round(blackSwatch.boundingRectangle.width / 2),
        y: blackSwatch.boundingRectangle.top + Math.round(blackSwatch.boundingRectangle.height / 2),
      });
      await proc.sleep(120);

      this.logger.debug("Visible ellipse style applied black primary color", {
        windowHandle: session.windowHandle,
        swatch: blackSwatch.name,
      });
    }

    const blackSecondarySwatch = findElementByAccessibleAlias(inventory, [
      "Color 2: Negro",
      "Color 2: Black",
    ]);
    if (blackSecondarySwatch?.boundingRectangle) {
      await proc.clickAt({
        x: blackSecondarySwatch.boundingRectangle.left + Math.round(blackSecondarySwatch.boundingRectangle.width / 2),
        y: blackSecondarySwatch.boundingRectangle.top + Math.round(blackSecondarySwatch.boundingRectangle.height / 2),
      });
      await proc.sleep(120);

      this.logger.debug("Visible ellipse style applied black secondary color", {
        windowHandle: session.windowHandle,
        swatch: blackSecondarySwatch.name,
      });
    }

    const outlineControl = findElementByAccessibleAlias(inventory, [
      "Contorno de forma",
      "Shape Outline",
    ]);
    if (outlineControl?.boundingRectangle) {
      await chooseDropdownOption(outlineControl.boundingRectangle, 1);
    }

    const fillControl = findElementByAccessibleAlias(inventory, [
      "Relleno de forma",
      "Shape Fill",
    ]);
    if (fillControl?.boundingRectangle) {
      await chooseDropdownOption(fillControl.boundingRectangle, 0);
    }

    const sizeControl = findElementByAccessibleAlias(inventory, [
      "Tamano",
      "Tamaño",
      "Size",
    ]);
    if (sizeControl?.boundingRectangle) {
      await chooseDropdownOption(sizeControl.boundingRectangle, 2);
    }
  }

  async inventory(
    options: PaintInventoryOptions,
    openIfMissing = true,
    windowMode: WindowMode = "current",
  ) {
    const session = await this.sessionStore.ensureReady({
      openIfMissing,
      windowMode,
      maximize: true,
      foreground: true,
      refreshAutomationTree: true,
    });
    this.logger.debug("Located Paint window for inventory", session);
    const discovered = await discoverPaintInventory(
      this.automationClient,
      session.windowHandle,
      session.processId,
      session.className,
      session.windowTitle,
      options,
    );
    const canvas = resolvePaintCanvas(session.windowHandle, discovered.inventory);
    this.logger.debug("Paint canvas resolved for inventory", {
      windowHandle: session.windowHandle,
      canvas,
    });

    return {
      success: true,
      paint: {
        processId: session.processId,
        windowHandle: session.windowHandle,
        windowTitle: session.windowTitle,
      },
      uiLanguageHint: discovered.uiLanguageHint,
      groups: discovered.groups,
      canvas: {
        source: canvas.source,
        width: canvas.width,
        height: canvas.height,
        logicalWidth: canvas.logicalWidth,
        logicalHeight: canvas.logicalHeight,
        ...(canvas.elementName ? { elementName: canvas.elementName } : {}),
        ...(canvas.automationId ? { automationId: canvas.automationId } : {}),
      },
      elements: discovered.inventory.elements,
    };
  }

  async selectShape(shape: string, windowMode: WindowMode = "current") {
    if (shape !== "ellipse") {
      throw new PaintMcpError(
        "ELLIPSE_TOOL_NOT_FOUND",
        `Only the 'ellipse' shape is supported in this iteration (received '${shape}').`,
      );
    }

    const session = await this.sessionStore.ensureReady({
      openIfMissing: true,
      windowMode,
      maximize: true,
      foreground: true,
      refreshAutomationTree: true,
    });
    const { ellipse } = await this.ensureEllipseSelection(session, "select");
    this.logger.debug("Ellipse tool resolved", ellipse.discovery);

    return {
      success: true,
      shape: "ellipse",
      selected: true,
      discovery: ellipse.discovery,
    };
  }

  async activeCanvasDebug(windowMode: WindowMode = "current") {
    const session = await this.sessionStore.ensureReady({
      openIfMissing: true,
      windowMode,
      maximize: true,
      foreground: true,
      refreshAutomationTree: true,
    });

    const discovered = await discoverPaintInventory(
      this.automationClient,
      session.windowHandle,
      session.processId,
      session.className,
      session.windowTitle,
      { maxDepth: 8, includeBoundingRectangles: true },
    );

    const canvas = resolvePaintCanvas(session.windowHandle, discovered.inventory);
    const active = getActiveCanvasDebugInfo(discovered.inventory);

    return {
      success: true,
      paint: {
        processId: session.processId,
        windowHandle: session.windowHandle,
        windowTitle: session.windowTitle,
      },
      canvas: {
        source: canvas.source,
        width: canvas.width,
        height: canvas.height,
        logicalWidth: canvas.logicalWidth,
        logicalHeight: canvas.logicalHeight,
        clientOrigin: canvas.clientOrigin,
        screenOrigin: canvas.screenOrigin,
        ...(canvas.drawableInset ? { drawableInset: canvas.drawableInset } : {}),
        ...(canvas.elementName ? { elementName: canvas.elementName } : {}),
        ...(canvas.automationId ? { automationId: canvas.automationId } : {}),
      },
      activeCanvasElement: active,
    };
  }

  async imagePropertiesDebug(windowMode: WindowMode = "current") {
    const session = await this.sessionStore.ensureReady({
      openIfMissing: true,
      windowMode,
      maximize: true,
      foreground: true,
      refreshAutomationTree: true,
    });

    proc.pressKeyCombo([win32.VK_CONTROL], win32.VK_E);
    await proc.sleep(700);

    const dialogHwnd = proc.getForegroundWindowHandle();
    const dialog = proc.getWindowInfo(dialogHwnd);
    const inventory = await this.automationClient.inventory({
      windowHandleHex: proc.hwndToHexString(dialogHwnd),
      processId: dialog.pid,
      className: dialog.className,
      windowTitle: dialog.title,
      maxDepth: 6,
      includeBoundingRectangles: true,
    });

    return {
      success: true,
      paint: {
        processId: session.processId,
        windowHandle: session.windowHandle,
        windowTitle: session.windowTitle,
      },
      dialog: {
        name: dialog.title,
        className: dialog.className,
        windowHandle: proc.hwndToHexString(dialogHwnd),
      },
      elements: inventory.elements,
    };
  }

  async shapeStyleDebug(windowMode: WindowMode = "current") {
    const session = await this.sessionStore.ensureReady({
      openIfMissing: true,
      windowMode,
      maximize: true,
      foreground: true,
      refreshAutomationTree: true,
    });

    const discovered = await discoverPaintInventory(
      this.automationClient,
      session.windowHandle,
      session.processId,
      session.className,
      session.windowTitle,
      { maxDepth: 8, includeBoundingRectangles: true },
    );

    const aliases = [
      "Contorno de forma",
      "Shape Outline",
      "Relleno de forma",
      "Shape Fill",
      "Tamano",
      "Tamaño",
      "Size",
      "Color 1",
      "Color 2",
      "Negro",
      "Black",
    ];

    const matches = findElementsByAnyAlias(discovered.inventory, aliases).map((element) => ({
      id: element.id,
      name: element.name,
      automationId: element.automationId,
      controlType: element.controlType,
      className: element.className,
      enabled: element.enabled,
      visible: element.visible,
      boundingRectangle: element.boundingRectangle,
      supportedPatterns: element.supportedPatterns,
    }));

    return {
      success: true,
      paint: {
        processId: session.processId,
        windowHandle: session.windowHandle,
        windowTitle: session.windowTitle,
      },
      matches,
    };
  }

  async layersDebug(windowMode: WindowMode = "current") {
    const session = await this.sessionStore.ensureReady({
      openIfMissing: true,
      windowMode,
      maximize: true,
      foreground: true,
      refreshAutomationTree: true,
    });

    const discovered = await discoverPaintInventory(
      this.automationClient,
      session.windowHandle,
      session.processId,
      session.className,
      session.windowTitle,
      { maxDepth: 8, includeBoundingRectangles: true },
    );

    const matches = findElementsByAnyAlias(discovered.inventory, [
      "Capas",
      "Layers",
      "layer",
      "capa",
    ]).map((element) => ({
      id: element.id,
      parentId: element.parentId,
      name: element.name,
      automationId: element.automationId,
      controlType: element.controlType,
      className: element.className,
      enabled: element.enabled,
      visible: element.visible,
      boundingRectangle: element.boundingRectangle,
      supportedPatterns: element.supportedPatterns,
    }));

    return {
      success: true,
      paint: {
        processId: session.processId,
        windowHandle: session.windowHandle,
        windowTitle: session.windowTitle,
      },
      matches,
    };
  }

  async shapeStyleMenuDebug(
    menu: "outline" | "fill" | "size",
    filter: string | undefined,
    maxItems: number,
    windowMode: WindowMode = "current",
  ) {
    const session = await this.sessionStore.ensureReady({
      openIfMissing: true,
      windowMode,
      maximize: true,
      foreground: true,
      refreshAutomationTree: true,
    });

    const discovered = await discoverPaintInventory(
      this.automationClient,
      session.windowHandle,
      session.processId,
      session.className,
      session.windowTitle,
      { maxDepth: 8, includeBoundingRectangles: true },
    );

    const aliasMap: Record<typeof menu, string[]> = {
      outline: ["Contorno de forma", "Shape Outline"],
      fill: ["Relleno de forma", "Shape Fill"],
      size: ["Tamano", "Tamaño", "Size"],
    };

    const normalizedAliases = aliasMap[menu].map((alias) => normalizeAutomationText(alias));
    const trigger = discovered.inventory.elements.find((element) => {
      if (!element.visible) {
        return false;
      }
      const haystack = `${normalizeAutomationText(element.name)} ${normalizeAutomationText(element.automationId)}`;
      return normalizedAliases.some((alias) => haystack.includes(alias));
    });

    if (!trigger?.boundingRectangle) {
      throw new PaintMcpError(
        "ELLIPSE_TOOL_NOT_FOUND",
        `The ${menu} style control could not be found.`,
      );
    }

    await proc.clickAt({
      x: trigger.boundingRectangle.left + Math.round(trigger.boundingRectangle.width / 2),
      y: trigger.boundingRectangle.top + Math.round(trigger.boundingRectangle.height / 2),
    });
    await proc.sleep(350);

    const refreshed = await this.automationClient.inventory({
      windowHandleHex: session.windowHandle,
      processId: session.processId,
      className: session.className,
      windowTitle: session.windowTitle,
      maxDepth: 1,
      includeBoundingRectangles: true,
      scope: "desktop-children",
    });

    let popupMatches = refreshed.elements
      .filter((element) => element.visible && element.enabled)
      .filter((element) => {
        const name = element.name.toLowerCase();
        return (
          element.controlType === "Window" ||
          element.controlType === "Pane" ||
          element.controlType === "ListItem" ||
          element.controlType === "MenuItem" ||
          name.includes("solid") ||
          name.includes("none") ||
          name.includes("sin relleno") ||
          name.includes("sin contorno") ||
          name.includes("solido") ||
          name.includes("contorno") ||
          name.includes("relleno")
        );
      })
      .map((element) => ({
        id: element.id,
        name: element.name,
        automationId: element.automationId,
        controlType: element.controlType,
        className: element.className,
        boundingRectangle: element.boundingRectangle,
        supportedPatterns: element.supportedPatterns,
      }));

    if (filter) {
      const normalizedFilter = filter.toLowerCase();
      popupMatches = popupMatches.filter((element) =>
        `${element.name} ${element.automationId} ${element.controlType}`
          .toLowerCase()
          .includes(normalizedFilter),
      );
    }

    popupMatches = popupMatches.slice(0, maxItems);

    const optionNames = popupMatches
      .map((element) => element.name)
      .filter((name) => typeof name === "string" && name.trim().length > 0);

    const optionDebugLines = popupMatches.map((element) =>
      [element.name || "<no-name>", element.controlType, element.className || "<no-class>", element.automationId || "<no-automation-id>"]
        .join(" | "),
    );

    return {
      success: true,
      paint: {
        processId: session.processId,
        windowHandle: session.windowHandle,
        windowTitle: session.windowTitle,
      },
      menu,
      trigger: {
        id: trigger.id,
        name: trigger.name,
        automationId: trigger.automationId,
        boundingRectangle: trigger.boundingRectangle,
      },
      summary: {
        optionNames,
        count: popupMatches.length,
        optionDebugLines,
      },
      matches: popupMatches,
    };
  }

  async drawEllipse(
    bounds: EllipseBounds,
    durationMs: number,
    windowMode: WindowMode = "current",
  ) {
    const session = await this.sessionStore.ensureReady({
      openIfMissing: true,
      windowMode,
      maximize: true,
      foreground: true,
      refreshAutomationTree: true,
    });
    const { ellipse, inventory } = await this.ensureEllipseSelection(session, "draw");
    await this.applyVisibleEllipseStyle(session, inventory);

    const canvas = resolvePaintCanvas(session.windowHandle, inventory);
    const duration = validateDurationMs(durationMs);
    const drag = canvasBoundsToScreenDrag(canvas, bounds);
    const hwnd = BigInt(session.windowHandle);
    const windowRect = proc.getWindowRect(hwnd);
    const primaryMonitor = proc.getPrimaryMonitorInfo();

    try {
      await proc.dragShapeBounds(drag.start, drag.end, duration);
    } catch (error) {
      throw new PaintMcpError(
        "INPUT_INJECTION_FAILED",
        error instanceof Error ? error.message : "Mouse input injection failed.",
      );
    }

    return {
      success: true,
      shape: "ellipse",
      bounds,
      toolSelection: ellipse.discovery,
      canvas: {
        source: canvas.source,
        width: canvas.width,
        height: canvas.height,
        logicalWidth: canvas.logicalWidth,
        logicalHeight: canvas.logicalHeight,
        clientOrigin: canvas.clientOrigin,
        screenOrigin: canvas.screenOrigin,
        ...(canvas.drawableInset ? { drawableInset: canvas.drawableInset } : {}),
        ...(canvas.elementName ? { elementName: canvas.elementName } : {}),
        ...(canvas.automationId ? { automationId: canvas.automationId } : {}),
      },
      geometry: {
        primaryMonitor,
        windowRect,
        drag,
        startScreen: drag.start,
        endScreen: drag.end,
      },
    };
  }
}
