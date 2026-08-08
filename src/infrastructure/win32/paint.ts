/**
 * ADAPTADOR de entrada del dominio: implementa PaintPort con Win32.
 *
 * Es el único módulo (junto con process.ts y user32.ts) que conoce la
 * implementación concreta de Windows: lanzar Paint, crear ventanas nuevas,
 * maximizarlas, mover el mouse, etc. Las operaciones MCP solo conocen el
 * puerto (src/domain/drawing.ts) y esta clase se la inyecta src/server.ts.
 *
 * Patrón de ventana (analogía Ext.window.Window): `createWindow()` devuelve
 * una instancia PaintWindow con lienzo limpio. Para no acumular procesos de
 * mspaint, el driver gestiona UNA ventana propia: la primera llamada la
 * abre, y las siguientes la REUTILIZAN limpiando su lienzo (Ctrl+A, Supr)
 * antes de devolverla. Las ventanas que no creó el driver (p. ej. las que
 * abrió el usuario) nunca se tocan. Para abrir la ventana gestionada cuando
 * Paint no está abierto se lanza un proceso nuevo de mspaint.exe y se
 * detecta la ventana por DIFERENCIA (enumerar antes y después); si no
 * aparece, se crea una instancia nueva con ShellExecuteW (AUMID de la app
 * moderna). Si ambas fallan, se devuelve un ERROR en lugar de dibujar sobre
 * una ventana existente.
 */

import * as proc from "./process.js";
import * as win32 from "./user32.js";
import { createLogger } from "../logging/logger.js";
import { AutomationClient } from "../windows/automation/automation-client.js";
import {
  canvasPointsToClientPoints,
  parseWindowHandleHex,
  type PaintCanvas,
  resolvePaintCanvas,
} from "../../paint/discovery/canvas-resolver.js";
import { discoverPaintInventory } from "../../paint/discovery/paint-ui-inventory.js";
import type {
  BoundingBox,
  DrawingRegion,
  PaintCanvasInfo,
  PaintWindowOptions,
  DrawOptions,
  FreehandResult,
  PaintPort,
  PaintWindow,
  PaintWindowInfo,
  Point2D,
  PolylineResult,
  Stroke,
  WindowCreationMethod,
} from "../../domain/drawing.js";

// ─────────────────────────────────────────────────────────────────────────────
// Constantes de layout medidas en Paint 11.2605 (versión UWP de Windows 11)
// ─────────────────────────────────────────────────────────────────────────────
//
const logger = createLogger();
const automationClient = new AutomationClient();

/**
 * Botón "Lápiz" de la barra de herramientas (coordenadas de área cliente).
 * Con la ventana maximizada el grupo "Herramientas" está EXPANDIDO y el
 * botón es visible directamente (no hace falta abrir el flyout).
 * Centro del rect 40x40 en cliente (308, 62).
 * NOTA: por defecto NO se usa (Paint inicia con la Brocha, que dibuja sin
 * tocar el toolbar); se reserva para cuando se pida explícitamente.
 */
const PENCIL_BUTTON = { x: 328, y: 82 };

/** Tiempo máximo de espera para que aparezca la ventana tras lanzar mspaint. */
const WINDOW_WAIT_TIMEOUT_MS = 10_000;

/**
 * AUMID de la versión moderna de Paint (app UWP de Windows 11).
 * Se usa para lanzar instancias nuevas de Paint con ShellExecuteW cuando
 * mspaint.exe es un stub que no crea ventana propia.
 */
const PAINT_UWP_AUMID = "shell:AppsFolder\\Microsoft.Paint_8wekyb3d8bbwe!App";

const MIN_POLYLINE_POINTS = 2;
const MAX_POLYLINE_POINTS = 1_000;
const MIN_STROKES = 1;
const MAX_STROKES = 500;

// ─────────────────────────────────────────────────────────────────────────────
// Identificación de ventanas de Paint
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Heurística para reconocer una ventana de Paint sin depender del idioma.
 * La clase clásica "MSPaintApp" (usada también por la versión moderna de
 * Windows 11) es suficiente y segura: evita capturar ventanas de otros
 * programas (p. ej. pestañas del navegador) cuyo título contenga "paint".
 * Solo como red de seguridad se aceptan hosts UWP genéricos con "paint"
 * en el título.
 */
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

/** Ventanas de Paint visibles en el escritorio. */
function findPaintWindows(): proc.WindowInfo[] {
  return proc
    .enumerateWindows()
    .filter((window) => window.visible && isPaintWindow(window));
}

/** Espera (polling) a que aparezca una ventana visible que parezca de Paint. */
async function waitForPaintWindow(timeoutMs: number): Promise<proc.WindowInfo> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const windows = findPaintWindows();
    if (windows.length > 0) {
      return windows[0];
    }
    await proc.sleep(100);
  }

  throw new Error(
    `No se encontró ninguna ventana de Paint tras ${timeoutMs} ms. ` +
      "Comprueba que Paint esté instalado y que la sesión sea interactiva.",
  );
}

/**
 * Espera a que aparezca una ventana de Paint NUEVA (que no estaba en `before`)
 * con un tiempo límite. Devuelve null si no aparece.
 */
async function waitForNewPaintWindow(
  before: Set<bigint>,
  timeoutMs: number,
): Promise<proc.WindowInfo | null> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const fresh = findPaintWindows().find((window) => !before.has(window.hwnd));
    if (fresh) {
      return fresh;
    }
    await proc.sleep(100);
  }

  return null;
}

/**
 * Maximiza la ventana y espera a que termine la animación de maximización
 * (las ventanas UWP tardan varios cientos de ms en recalcular el layout).
 * El layout del lienzo y del toolbar dependen del estado maximizado.
 */
async function maximizePaintWindow(hwnd: bigint): Promise<void> {
  proc.maximizeWindow(hwnd);
  await proc.sleep(700);
}

// ─────────────────────────────────────────────────────────────────────────────
// Selección de herramienta
// ─────────────────────────────────────────────────────────────────────────────
//
// El Paint moderno de Windows 11 no responde a los atajos de teclado de
// herramientas (P/B/E/...) . Con la ventana maximizada el grupo "Herramientas"
// está expandido y el botón "Lápiz" es visible directamente en la barra.

async function selectPencilTool(hwnd: bigint): Promise<void> {
  const pencilScreen = proc.clientToScreen(hwnd, PENCIL_BUTTON);

  await proc.clickAt(pencilScreen);
  await proc.sleep(300);
}

// ─────────────────────────────────────────────────────────────────────────────
// Lanzar Paint
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lanza Paint desde cero y espera a que aparezca su ventana.
 * En Windows 11, mspaint.exe puede ser un stub UWP: si no crea ventana, se
 * lanza la app moderna a través de ShellExecuteW (AppsFolder).
 */
async function launchPaintWindow(): Promise<proc.WindowInfo> {
  const pid = proc.spawnApplication("mspaint");

  try {
    // Paint clásico (Windows 10) o stub de Windows 11: la ventana puede
    // aparecer en el propio proceso mspaint.exe.
    return await proc.waitForWindowByPid(pid, WINDOW_WAIT_TIMEOUT_MS);
  } catch {
    // Windows 11: mspaint.exe puede quedarse sin ventana (stub UWP).
    // Como respaldo se lanza la app moderna de Paint con ShellExecuteW y se
    // mata el stub de mspaint.exe que quedó vivo sin ventana.
    proc.shellExecuteApp(PAINT_UWP_AUMID);
    const window = await waitForPaintWindow(WINDOW_WAIT_TIMEOUT_MS);
    proc.killProcess(pid);
    logger.debug("Killed mspaint.exe stub left behind by a UWP-style launch", {
      processId: pid,
    });
    return window;
  }
}

/**
 * Intenta abrir una ventana NUEVA de Paint cuando ya hay alguna abierta,
 * usando solo mecanismos de Windows (sin atajos de teclado):
 *  1. Se lanza un proceso nuevo de mspaint.exe. La ventana nueva se detecta
 *     por DIFERENCIA de la enumeración (antes vs después), sin depender del
 *     foco ni del idioma de Paint.
 *  2. Si no aparece (mspaint.exe es un stub en Windows 11), se crea una
 *     instancia nueva de la app con ShellExecuteW sobre el AUMID.
 * Devuelve la ventana nueva y cómo se creó, o lanza un error si ninguna
 * estrategia funciona.
 */
async function createNewPaintWindow(): Promise<{
  window: proc.WindowInfo;
  createdBy: "launched" | "shell";
}> {
  const before = new Set(findPaintWindows().map((window) => window.hwnd));

  // 1) Proceso nuevo de mspaint.exe.
  const spawnedPid = proc.spawnApplication("mspaint");
  const viaLaunched = await waitForNewPaintWindow(before, 5_000);
  if (viaLaunched !== null) {
    if (viaLaunched.pid !== spawnedPid) {
      // La ventana nueva vino de otro proceso (instancia ya abierta que
      // recibió el mensaje): el mspawn se quedó como stub sin ventana.
      proc.killProcess(spawnedPid);
      logger.debug("Killed mspaint.exe stub (window came from another process)", {
        processId: spawnedPid,
        windowProcessId: viaLaunched.pid,
      });
    }
    return { window: viaLaunched, createdBy: "launched" };
  }

  // 2) ShellExecuteW: instancia nueva de la app UWP (AppsFolder).
  proc.shellExecuteApp(PAINT_UWP_AUMID);
  const viaShell = await waitForNewPaintWindow(before, 5_000);
  if (viaShell !== null) {
    proc.killProcess(spawnedPid);
    logger.debug("Killed mspaint.exe stub (launch resolved via ShellExecuteW)", {
      processId: spawnedPid,
    });
    return { window: viaShell, createdBy: "shell" };
  }

  proc.killProcess(spawnedPid);
  throw new Error(
    "No se pudo crear una ventana nueva de Paint: el proceso de mspaint " +
      "no produjo una ventana y el lanzamiento por ShellExecuteW tampoco. " +
      "Cierra Paint y reintenta.",
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Validaciones de entrada del motor
// ─────────────────────────────────────────────────────────────────────────────

function validateIntegerCoordinate(value: number, name: string): void {
  if (!Number.isInteger(value)) {
    throw new Error(`${name} debe ser un número entero (recibido: ${value}).`);
  }
  if (value < 0) {
    throw new Error(`${name} no puede ser negativa (recibido: ${value}).`);
  }
}

function validateStepDelayMs(stepDelayMs: number): void {
  if (!Number.isInteger(stepDelayMs) || stepDelayMs < 0 || stepDelayMs > 200) {
    throw new Error(
      "stepDelayMs debe ser un entero entre 0 y 200 ms (recibido: " +
        `${stepDelayMs}).`,
    );
  }
}

/** Valida un punto {x, y} con enteros no negativos en la ruta dada. */
function validateCoordinatePair(point: unknown, path: string): void {
  if (
    point === null ||
    typeof point !== "object" ||
    !("x" in point) ||
    !("y" in point)
  ) {
    throw new Error(
      `${path} debe ser un objeto con x e y enteros ` +
        `(recibido: ${JSON.stringify(point)}).`,
    );
  }
  const p = point as Point2D;
  if (!Number.isInteger(p.x) || !Number.isInteger(p.y)) {
    throw new Error(
      `${path} debe ser un objeto con x e y enteros ` +
        `(recibido: ${JSON.stringify(point)}).`,
    );
  }
  validateIntegerCoordinate(p.x, `${path}.x`);
  validateIntegerCoordinate(p.y, `${path}.y`);
}

// ─────────────────────────────────────────────────────────────────────────────
// La ventana de Paint (analogía Ext.window.Window)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Crea la instancia PaintWindow sobre una ventana real: maximiza, trae al
 * primer plano antes de cada dibujo y ejecuta los arrastres sobre su propio
 * HWND (no hay estado global compartido entre instancias).
 */
async function createPaintWindow(
  window: proc.WindowInfo,
  createdBy: WindowCreationMethod,
  windowOptions?: PaintWindowOptions,
): Promise<PaintWindow> {
  const info: PaintWindowInfo = {
    processId: window.pid,
    windowHandle: proc.hwndToHexString(window.hwnd),
    windowTitle: window.title,
    className: window.className,
    createdBy,
  };

  let currentCanvas: PaintCanvas = resolvePaintCanvas(info.windowHandle);
  let lastFitInvoked = false;

  function toCanvasInfo(canvas: PaintCanvas): PaintCanvasInfo {
    return {
      source: canvas.source,
      width: canvas.width,
      height: canvas.height,
      logicalWidth: canvas.logicalWidth,
      logicalHeight: canvas.logicalHeight,
      clientOrigin: canvas.clientOrigin,
      screenOrigin: canvas.screenOrigin,
      ...(canvas.elementName ? { elementName: canvas.elementName } : {}),
      ...(canvas.automationId ? { automationId: canvas.automationId } : {}),
    };
  }

  function resolveDrawingRegion(canvas: PaintCanvas): DrawingRegion | undefined {
    const region = windowOptions?.drawingRegion;
    if (!region) {
      return undefined;
    }

    if (
      region.x < 0 ||
      region.y < 0 ||
      region.width <= 0 ||
      region.height <= 0 ||
      region.x + region.width > canvas.logicalWidth ||
      region.y + region.height > canvas.logicalHeight
    ) {
      throw new Error(
        `The requested drawingRegion (${region.x}, ${region.y}, ${region.width}, ${region.height}) does not fit inside the logical canvas ${canvas.logicalWidth}x${canvas.logicalHeight}.`,
      );
    }

    return region;
  }

  function mapPointsIntoDrawingRegion(
    points: Point2D[],
    canvas: PaintCanvas,
    path: string,
  ): Point2D[] {
    const region = resolveDrawingRegion(canvas);
    if (!region) {
      return points;
    }

    return points.map((point, index) => {
      if (point.x > region.width || point.y > region.height) {
        throw new Error(
          `${path}[${index}] (${point.x}, ${point.y}) is outside the configured drawingRegion ${region.width}x${region.height}.`,
        );
      }

      return {
        x: region.x + point.x,
        y: region.y + point.y,
      };
    });
  }

  function computeCanvasBounds(points: Point2D[]): BoundingBox | null {
    if (points.length === 0) {
      return null;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const point of points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
    return { minX, minY, maxX, maxY };
  }

  /**
   * Restaura el zoom al 100% enviando Ctrl+0 (atajo estándar en Paint).
   * Se invoca después de dibujar si refreshCanvas hizo fit-to-window.
   */
  async function resetZoomTo100(hwnd: bigint): Promise<void> {
    try {
      await proc.ensureWindowReady(hwnd, { maximize: true, foreground: true, logger });
      proc.pressKeyCombo([win32.VK_CONTROL], win32.VK_0);
      await proc.sleep(300);
    } catch {
      // Best-effort: si falla, el usuario puede ajustar manualmente.
    }
  }

  /**
   * El mapeo lógico→cliente (canvasPointsToClientPoints) escala proporcional-
   * mente al rectángulo físico del elemento canvas. Eso es correcto solo si
   * ese rect es el lienzo COMPLETO a zoom uniforme. Si el lienzo es más grande
   * que la vista (o está con zoom > 100%), el rect queda recortado y los
   * ratios por eje dejan de coincidir → el dibujo caería en el sitio
   * equivocado. Antes de resolver, se fuerza "Ajustar a la ventana" (Fit to
   * window) vía UIA para dejar el estado determinista.
   */
  async function refreshCanvas(): Promise<PaintCanvas> {
    lastFitInvoked = false;
    try {
      let discovered = await discoverPaintInventory(
        automationClient,
        info.windowHandle,
        window.pid,
        window.className,
        window.title,
        {
          maxDepth: 8,
          includeBoundingRectangles: true,
        },
      );
      currentCanvas = resolvePaintCanvas(info.windowHandle, discovered.inventory);

      const clientSize = proc.getClientSize(window.hwnd);
      const scaleX = currentCanvas.width / currentCanvas.logicalWidth;
      const scaleY = currentCanvas.height / currentCanvas.logicalHeight;
      const uniformZoom =
        Math.abs(scaleX - scaleY) / Math.max(scaleX, scaleY, 1e-9) < 0.02;
      const fullyVisible =
        currentCanvas.width <= clientSize.width &&
        currentCanvas.height <= clientSize.height;
      const needsFit = !(uniformZoom && fullyVisible);

      if (needsFit) {
        const fitButton = discovered.inventory.elements.find((element) => {
          const name = (element.name ?? "")
            .replace(/[^\x20-\x7e]/g, "")
            .toLowerCase();
          return (
            element.visible &&
            element.controlType === "Button" &&
            (name.includes("ajustar") ||
              name.includes("fit") ||
              name.includes("window"))
          );
        });

        if (fitButton) {
          logger.debug("Fitting oversized canvas to window before drawing", {
            windowHandle: info.windowHandle,
            canvas: {
              width: currentCanvas.width,
              height: currentCanvas.height,
              logicalWidth: currentCanvas.logicalWidth,
              logicalHeight: currentCanvas.logicalHeight,
            },
          });
          await automationClient.invoke({
            windowHandleHex: info.windowHandle,
            processId: window.pid,
            className: window.className,
            windowTitle: window.title,
            runtimeId: fitButton.runtimeId,
          });
          lastFitInvoked = true;
          await proc.sleep(800);
          discovered = await discoverPaintInventory(
            automationClient,
            info.windowHandle,
            window.pid,
            window.className,
            window.title,
            {
              maxDepth: 8,
              includeBoundingRectangles: true,
            },
          );
          currentCanvas = resolvePaintCanvas(
            info.windowHandle,
            discovered.inventory,
          );
        }
      }
    } catch (error) {
      logger.debug("Paint window canvas inventory fallback engaged", {
        windowHandle: info.windowHandle,
        error: error instanceof Error ? error.message : String(error),
      });
      currentCanvas = resolvePaintCanvas(info.windowHandle);
    }

    logger.debug("Paint window canvas refreshed", {
      windowHandle: info.windowHandle,
      canvas: currentCanvas,
    });
    return currentCanvas;
  }

  const prepare = async (): Promise<{
    focus: proc.FocusResult;
    canvas: PaintCanvas;
  }> => {
    try {
      await proc.ensureWindowReady(window.hwnd, {
        maximize: true,
        foreground: true,
        logger,
      });
      return {
        focus: { success: true },
        canvas: await refreshCanvas(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        focus: { success: false, warning: message },
        canvas: currentCanvas,
      };
    }
  };

  const paintWindow: PaintWindow = {
    info,
    get canvas() {
      return toCanvasInfo(currentCanvas);
    },
    get drawingRegion() {
      return resolveDrawingRegion(currentCanvas);
    },

    async drawPolyline(
      points: Point2D[],
      options: DrawOptions,
    ): Promise<PolylineResult> {
      validateStepDelayMs(options.stepDelayMs);

      if (
        !Array.isArray(points) ||
        points.length < MIN_POLYLINE_POINTS ||
        points.length > MAX_POLYLINE_POINTS
      ) {
        throw new Error(
          `points debe tener entre ${MIN_POLYLINE_POINTS} y ` +
            `${MAX_POLYLINE_POINTS} puntos (recibidos: ${points?.length ?? 0}).`,
        );
      }

      points.forEach((point, index) => {
        validateCoordinatePair(point, `points[${index}]`);
      });

      const prepared = await prepare();
      if (!prepared.focus.success) {
        throw new Error(prepared.focus.warning ?? "Paint could not be prepared for drawing.");
      }

      const canvas = prepared.canvas;

      const mappedPoints = mapPointsIntoDrawingRegion(points, canvas, "points");
      const clientPoints = canvasPointsToClientPoints(canvas, mappedPoints, "points");
      if (options.skipToolSelection === false) {
        await selectPencilTool(window.hwnd);
      }

      // Conversión a coordenadas absolutas de pantalla (una sola vez).
      const screenPoints = clientPoints.map((point) =>
        proc.clientToScreen(window.hwnd, point),
      );

      // Arrastre único por todos los puntos.
      await proc.dragPolyline(screenPoints, options.stepDelayMs);

      // P5: restaurar zoom al 100% si se hizo fit-to-window
      if (lastFitInvoked) {
        await resetZoomTo100(window.hwnd);
        lastFitInvoked = false;
      }

      return {
        success: true,
        processId: window.pid,
        windowHandle: info.windowHandle,
        windowTitle: window.title,
        createdBy,
        pointCount: points.length,
        startScreen: screenPoints[0],
        endScreen: screenPoints[screenPoints.length - 1],
        canvas: toCanvasInfo(canvas),
        canvasBounds: computeCanvasBounds(mappedPoints),
        ...(prepared.focus.success ? {} : { warning: prepared.focus.warning }),
      };
    },

    async drawFreehand(
      strokes: Stroke[],
      options: DrawOptions,
    ): Promise<FreehandResult> {
      validateStepDelayMs(options.stepDelayMs);

      if (
        !Array.isArray(strokes) ||
        strokes.length < MIN_STROKES ||
        strokes.length > MAX_STROKES
      ) {
        throw new Error(
          `strokes debe tener entre ${MIN_STROKES} y ${MAX_STROKES} trazos ` +
            `(recibidos: ${strokes?.length ?? 0}).`,
        );
      }

      strokes.forEach((stroke, strokeIndex) => {
        if (
          stroke === null ||
          typeof stroke !== "object" ||
          !Array.isArray(stroke.points)
        ) {
          throw new Error(
            `strokes[${strokeIndex}] debe ser un objeto con una lista "points" ` +
              `(recibido: ${JSON.stringify(stroke)}).`,
          );
        }
        if (
          stroke.points.length < MIN_POLYLINE_POINTS ||
          stroke.points.length > MAX_POLYLINE_POINTS
        ) {
          throw new Error(
            `strokes[${strokeIndex}].points debe tener entre ` +
              `${MIN_POLYLINE_POINTS} y ${MAX_POLYLINE_POINTS} puntos ` +
              `(recibidos: ${stroke.points.length}).`,
          );
        }
        stroke.points.forEach((point, pointIndex) =>
          validateCoordinatePair(
            point,
            `strokes[${strokeIndex}].points[${pointIndex}]`,
          ),
        );
      });

      const prepared = await prepare();
      if (!prepared.focus.success) {
        throw new Error(prepared.focus.warning ?? "Paint could not be prepared for drawing.");
      }

      const canvas = prepared.canvas;

      const canvasStrokes = strokes.map((stroke, strokeIndex) =>
        mapPointsIntoDrawingRegion(
          stroke.points,
          canvas,
          `strokes[${strokeIndex}].points`,
        ),
      );
      const clientStrokes = canvasStrokes.map((points, strokeIndex) =>
        canvasPointsToClientPoints(
          canvas,
          points,
          `strokes[${strokeIndex}].points`,
        ),
      );
      if (options.skipToolSelection === false) {
        await selectPencilTool(window.hwnd);
      }

      // Conversión a coordenadas absolutas de pantalla (una sola vez).
      const screenStrokes = clientStrokes.map((points) =>
        points.map((point) => proc.clientToScreen(window.hwnd, point)),
      );

      // Un arrastre por trazo, en orden.
      let totalPoints = 0;
      for (const points of screenStrokes) {
        totalPoints += points.length;
        await proc.dragPolyline(points, options.stepDelayMs);
      }

      // P5: restaurar zoom al 100% si se hizo fit-to-window
      if (lastFitInvoked) {
        await resetZoomTo100(window.hwnd);
        lastFitInvoked = false;
      }

      return {
        success: true,
        processId: window.pid,
        windowHandle: info.windowHandle,
        windowTitle: window.title,
        createdBy,
        strokeCount: strokes.length,
        totalPoints,
        startScreen: screenStrokes[0][0],
        endScreen:
          screenStrokes[screenStrokes.length - 1][
            screenStrokes[screenStrokes.length - 1].length - 1
          ],
        canvas: toCanvasInfo(canvas),
        canvasBounds: computeCanvasBounds(canvasStrokes.flat()),
        ...(prepared.focus.success ? {} : { warning: prepared.focus.warning }),
      };
    },
  };

  // La ventana debe nacer ya preparada y con su canvas real resuelto para que
  // cualquier operación que consulte window.canvas antes de dibujar (p. ej.
  // la espiral adaptativa) use dimensiones correctas y no un fallback frío.
  const prepared = await prepare();
  if (!prepared.focus.success) {
    throw new Error(prepared.focus.warning ?? "Paint could not be prepared.");
  }

  return paintWindow;
}

// ─────────────────────────────────────────────────────────────────────────────
// El driver: implementación concreta del puerto PaintPort
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Driver de Paint sobre Win32 (un driver por proceso Node).
 * `createWindow()` abre UNA ventana gestionada la primera vez y luego la
 * reutiliza limpiando su lienzo: no acumula procesos de mspaint.
 */

/** HWND de la última ventana de Paint creada por este driver (si sigue viva). */
let managedWindowHwnd: bigint | null = null;

/**
 * Vacía el lienzo de la ventana gestionada (Ctrl+A + Supr) para que el
 * siguiente dibujo arranque desde un lienzo limpio.
 */
async function clearPaintCanvas(hwnd: bigint): Promise<void> {
  await proc.ensureWindowReady(hwnd, {
    maximize: true,
    foreground: true,
    logger,
  });
  proc.pressKeyCombo([win32.VK_CONTROL], win32.VK_A);
  await proc.sleep(150);
  proc.pressKey(win32.VK_DELETE);
  await proc.sleep(300);
}

/**
 * Adquiere la ventana de Paint gestionada por el driver (una por proceso):
 * reutiliza la propia si sigue viva, adopta la superior en arranque limpio,
 * o abre una nueva si no hay ninguna. Las ventanas del usuario (antiguas o
 * de fondo) no se tocan. NO vacía el lienzo: la limpieza es responsabilidad
 * de quien va a dibujar (paint_draw).
 */
export async function acquireManagedPaintWindow(
  options?: PaintWindowOptions,
): Promise<PaintWindow> {
  if (managedWindowHwnd !== null) {
    const alive = findPaintWindows().find(
      (window) => window.hwnd === managedWindowHwnd,
    );
    if (alive) {
      return createPaintWindow(alive, "reused", options);
    }
  }

  const existing = findPaintWindows();

  if (existing.length === 0) {
    // No hay Paint abierto: se lanza y su ventana ya trae un lienzo limpio.
    const window = await launchPaintWindow();
    managedWindowHwnd = window.hwnd;
    return createPaintWindow(window, "opened", options);
  }

  // Arranque limpio con ventanas previas: se adopta la ventana superior
  // (orden Z: EnumWindows enumera de arriba abajo; la nuestra de un
  // proceso anterior suele quedar al frente) en vez de acumular otra
  // ventana por cada reinicio del servidor.
  if (managedWindowHwnd === null) {
    const previous = existing[0];
    logger.warn(
      "Reusing the topmost Paint window from a previous server process",
      {
        windowHandle: proc.hwndToHexString(previous.hwnd),
      },
    );
    managedWindowHwnd = previous.hwnd;
    return createPaintWindow(previous, "reused", options);
  }

  // Hay otras ventanas de Paint (p. ej. del usuario): se crea la ventana
  // gestionada SIN tocar las existentes.
  const { window: fresh, createdBy } = await createNewPaintWindow();
  managedWindowHwnd = fresh.hwnd;
  return createPaintWindow(fresh, createdBy, options);
}

export function createWin32PaintDriver(): PaintPort {
  return {
    async createWindow(options?: PaintWindowOptions): Promise<PaintWindow> {
      const paintWindow = await acquireManagedPaintWindow(options);
      const hwnd = parseWindowHandleHex(paintWindow.info.windowHandle);
      await clearPaintCanvas(hwnd);
      return paintWindow;
    },
  };
}
