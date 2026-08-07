import type { Logger } from "../infrastructure/logging/logger.js";
import type { AutomationClient } from "../infrastructure/windows/automation/automation-client.js";
import type { WindowMode } from "../infrastructure/windows/process/window-locator.js";
import {
  getActiveCanvasDebugInfo,
  resolvePaintCanvas,
} from "./discovery/canvas-resolver.js";
import {
  discoverPaintInventory,
  type PaintInventoryOptions,
} from "./discovery/paint-ui-inventory.js";
import { PaintSessionStore } from "./session/paint-session.js";

export class PaintController {
  constructor(
    private readonly sessionStore: PaintSessionStore,
    private readonly automationClient: AutomationClient,
    private readonly logger: Logger,
  ) {}

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
}
