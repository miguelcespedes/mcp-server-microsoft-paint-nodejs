import type { Logger } from "../infrastructure/logging/logger.js";
import type { AutomationClient } from "../infrastructure/windows/automation/automation-client.js";
import type { AutomationInventoryResult } from "../infrastructure/windows/automation/automation-types.js";
import type { WindowMode } from "../infrastructure/windows/process/window-locator.js";
import * as proc from "../infrastructure/win32/process.js";
import * as win32 from "../infrastructure/win32/user32.js";
import {
  getActiveCanvasDebugInfo,
  parseWindowHandleHex,
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

  /**
   * Cambia el tamaño del lienzo de la ventana de Paint gestionada.
   *
   * Mecanismo: Ctrl+E abre el popup "Propiedades de la imagen" (XAML, dentro
   * del árbol UIA de la ventana), se escriben ancho/alto en píxeles con
   * ValuePattern sobre los edits internos de los NumberBox y se confirma con
   * el botón "Aceptar". Devuelve el tamaño anterior, el nuevo (resuelto desde
   * un inventario fresco) y si la verificación coincidió con lo pedido.
   */
  async setCanvasSize(width: number, height: number) {
    const session = await this.sessionStore.ensureReady({
      openIfMissing: true,
      windowMode: "current",
      maximize: true,
      foreground: true,
      refreshAutomationTree: true,
    });
    const hwnd = parseWindowHandleHex(session.windowHandle);
    const sessionRef = {
      windowHandleHex: session.windowHandle,
      processId: session.processId,
      className: session.className,
      windowTitle: session.windowTitle,
    };

    const scanInventory = async () => {
      const discovered = await discoverPaintInventory(
        this.automationClient,
        session.windowHandle,
        session.processId,
        session.className,
        session.windowTitle,
        { maxDepth: 8, includeBoundingRectangles: false },
      );
      return discovered.inventory;
    };

    const previousInventory = await scanInventory();
    const previousCanvas = resolvePaintCanvas(
      session.windowHandle,
      previousInventory,
    );

    const findPopup = (inventory: AutomationInventoryResult) => {
      const widthSpinner = inventory.elements.find(
        (element) => element.automationId === "WidthNumberBox",
      );
      const heightSpinner = inventory.elements.find(
        (element) => element.automationId === "HeightNumberBox",
      );
      return { widthSpinner, heightSpinner };
    };

    let popup = findPopup(previousInventory);
    if (!popup.widthSpinner) {
      await proc.ensureWindowReady(hwnd, {
        maximize: true,
        foreground: true,
        logger: this.logger,
      });
      proc.pressKeyCombo([win32.VK_CONTROL], win32.VK_E);
      await proc.sleep(1200);

      for (let attempt = 0; attempt < 4 && !popup.widthSpinner; attempt += 1) {
        popup = findPopup(await scanInventory());
        if (!popup.widthSpinner) {
          await proc.sleep(1000);
        }
      }
    }

    if (!popup.widthSpinner || !popup.heightSpinner) {
      throw new Error(
        "No se abrió el popup 'Propiedades de la imagen' (Ctrl+E). " +
          "Asegúrate de que la ventana de Paint esté en primer plano y reintenta.",
      );
    }

    const inventory = await scanInventory();
    const { widthSpinner, heightSpinner } = findPopup(inventory);
    const elements = inventory.elements;

    const sanitizeName = (name: string): string =>
      name.replace(/[^\x20-\x7e]/g, "").toLowerCase();

    const unitRadio = elements.find(
      (element) =>
        element.controlType === "RadioButton" &&
        sanitizeName(element.name ?? "").includes("xeles"),
    );
    if (unitRadio) {
      await this.automationClient.invoke({ ...sessionRef, runtimeId: unitRadio.runtimeId });
    }

    const widthEdit = elements.find(
      (element) =>
        element.parentId === widthSpinner?.id &&
        element.automationId === "InputBox",
    ) ?? widthSpinner;
    const heightEdit = elements.find(
      (element) =>
        element.parentId === heightSpinner?.id &&
        element.automationId === "InputBox",
    ) ?? heightSpinner;
    if (!widthEdit || !heightEdit) {
      throw new Error(
        "No se encontraron los campos de ancho/alto del popup de propiedades.",
      );
    }

    const widthSet = await this.automationClient.setValue({
      ...sessionRef,
      runtimeId: widthEdit.runtimeId,
      value: String(width),
    });
    const heightSet = await this.automationClient.setValue({
      ...sessionRef,
      runtimeId: heightEdit.runtimeId,
      value: String(height),
    });

    const acceptButton = elements.find(
      (element) => element.automationId === "PrimaryButton",
    );
    if (!acceptButton) {
      throw new Error(
        "No se encontró el botón 'Aceptar' del popup de propiedades.",
      );
    }
    await this.automationClient.invoke({ ...sessionRef, runtimeId: acceptButton.runtimeId });
    await proc.sleep(1000);

    const afterInventory = await scanInventory();
    const canvas = resolvePaintCanvas(session.windowHandle, afterInventory);
    const verified =
      canvas.logicalWidth === width && canvas.logicalHeight === height;

    return {
      success: true,
      previousCanvas: {
        logicalWidth: previousCanvas.logicalWidth,
        logicalHeight: previousCanvas.logicalHeight,
      },
      canvas: {
        source: canvas.source,
        width: canvas.width,
        height: canvas.height,
        logicalWidth: canvas.logicalWidth,
        logicalHeight: canvas.logicalHeight,
        ...(canvas.elementName ? { elementName: canvas.elementName } : {}),
        ...(canvas.automationId ? { automationId: canvas.automationId } : {}),
      },
      verified,
      actions: {
        popup: popup.widthSpinner ? "opened" : "already-open",
        units: unitRadio ? "pixels" : "unchanged",
        widthPattern: widthSet.pattern,
        heightPattern: heightSet.pattern,
      },
    };
  }

  async activeCanvasDebug(windowMode: WindowMode = "current") {    const session = await this.sessionStore.ensureReady({
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
