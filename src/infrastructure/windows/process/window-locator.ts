import * as proc from "../../win32/process.js";
import { acquireManagedPaintWindow } from "../../win32/paint.js";
import { parseWindowHandleHex } from "../../../paint/discovery/canvas-resolver.js";
import { PaintMcpError } from "../../errors/paint-mcp-error.js";
import type { PaintWindow } from "../../../domain/drawing.js";

export interface LocatedPaintWindow extends proc.WindowInfo {
  createdBy: "opened" | "launched" | "shell" | "reused";
}

export type WindowMode = "new" | "current";

function isPaintWindow(window: proc.WindowInfo): boolean {
  if (window.className === "MSPaintApp") {
    return true;
  }

  const genericHostClasses = new Set([
    "Window",
    "ApplicationFrameWindow",
    "Windows.UI.Core.CoreWindow",
  ]);

  return (
    genericHostClasses.has(window.className) &&
    window.title.toLowerCase().includes("paint")
  );
}

export function findPaintWindows(): proc.WindowInfo[] {
  return proc
    .enumerateWindows()
    .filter((window) => window.visible && isPaintWindow(window));
}

/**
 * Elige la mejor ventana candidata entre varias instancias de Paint:
 * prioriza una que esté dentro de un monitor visible y no minimizada. Si
 * ninguna califica, lanza PAINT_WINDOW_NOT_VISIBLE con el detalle de la
 * primera candidata en vez de devolver silenciosamente existing[0].
 */
function pickBestPaintWindow(candidates: proc.WindowInfo[]): proc.WindowInfo {
  const usable = candidates.find(
    (window) =>
      !proc.isWindowMinimized(window.hwnd) &&
      proc.isWindowOnVisibleMonitor(window.hwnd),
  );

  if (usable) {
    return usable;
  }

  const first = candidates[0];
  throw new PaintMcpError(
    "PAINT_WINDOW_NOT_VISIBLE",
    "Se encontraron ventanas de Paint pero ninguna está visible en un " +
      "monitor activo (todas están minimizadas o posicionadas fuera del " +
      "escritorio visible).",
    {
      hwnd: `0x${first.hwnd.toString(16).padStart(16, "0")}`,
      candidateCount: candidates.length,
    },
  );
}

function toLocatedWindow(paintWindow: PaintWindow): LocatedPaintWindow {
  const hwnd = parseWindowHandleHex(paintWindow.info.windowHandle);
  return {
    hwnd,
    pid: paintWindow.info.processId,
    title: paintWindow.info.windowTitle,
    className: paintWindow.info.className,
    visible: true,
    createdBy: paintWindow.info.createdBy,
  };
}

/**
 * Localiza (y opcionalmente abre) la ventana de Paint usada por las
 * operaciones de diagnóstico. En modo "new" se delega en la ventana
 * GESTIONADA del driver (src/infrastructure/win32/paint.ts): una única
 * ventana reutilizada, sin acumular procesos mspaint. En modo "current" se
 * usa la ventana superior existente sin tocarla.
 */
export async function locatePaintWindow(
  openIfMissing: boolean,
  windowMode: WindowMode = "new",
): Promise<LocatedPaintWindow> {
  const existing = findPaintWindows();

  if (!openIfMissing) {
    if (existing.length === 0) {
      throw new PaintMcpError(
        "PAINT_NOT_RUNNING",
        "Paint is not running.",
      );
    }
    return { ...pickBestPaintWindow(existing), createdBy: "opened" };
  }

  if (windowMode === "current") {
    if (existing.length === 0) {
      return toLocatedWindow(await acquireManagedPaintWindow());
    }
    return { ...pickBestPaintWindow(existing), createdBy: "opened" };
  }

  return toLocatedWindow(await acquireManagedPaintWindow());
}