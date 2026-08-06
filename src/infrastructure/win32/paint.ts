/**
 * ADAPTADOR de entrada del dominio: implementa PaintPort con Win32.
 *
 * Es el único módulo (junto con process.ts y user32.ts) que conoce la
 * implementación concreta de Windows: lanzar Paint, crear ventanas nuevas,
 * maximizarlas, mover el mouse, etc. Las operaciones MCP solo conocen el
 * puerto (src/domain/drawing.ts) y esta clase se la inyecta src/server.ts.
 *
 * Patrón de ventana (analogía Ext.window.Window): `createWindow()` abre una
 * ventana NUEVA de Paint con lienzo limpio y devuelve una instancia
 * PaintWindow; cada operación crea la suya y dibuja sobre su propia ventana.
 * Para abrir una ventana nueva cuando Paint ya está abierto se lanza un
 * proceso nuevo de mspaint.exe y se detecta la ventana nueva por DIFERENCIA
 * (enumerar antes y después); si no aparece, se crea una instancia nueva con
 * ShellExecuteW (AUMID de la app moderna). Si ambas fallan, se devuelve un
 * ERROR en lugar de dibujar sobre una ventana existente.
 */

import * as proc from "./process.js";
import type {
  DrawOptions,
  FreehandResult,
  PaintPort,
  PaintWindow,
  PaintWindowInfo,
  Point2D,
  PolylineResult,
  Trazo,
  WindowCreationMethod,
} from "../../domain/drawing.js";

// ─────────────────────────────────────────────────────────────────────────────
// Constantes de layout medidas en Paint 11.2605 (versión UWP de Windows 11)
// ─────────────────────────────────────────────────────────────────────────────
//
// En el Paint moderno el lienzo NO empieza en (0,0) del área cliente y su
// posición depende del ancho de la ventana: con la ventana MAXIMIZADA el
// lienzo queda centrado. Estas constantes se midieron con UI Automation en
// Paint 11.2605 con la ventana maximizada (monitor de 1920 px lógicos).
// Las operaciones de dibujo fuerzan la maximización; si usas otra
// versión de Paint o un monitor de otro ancho, ajusta los valores.

const CANVAS_ORIGIN = { x: 513, y: 220 };

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
 * Paint puede exponer la ventana antes de que el lienzo quede realmente listo.
 * Un pequeño margen evita enviar `SendInput` mientras la app sigue cargando.
 */
const PAINT_READY_DELAY_MS = 1_200;

/**
 * AUMID de la versión moderna de Paint (app UWP de Windows 11).
 * Se usa para lanzar instancias nuevas de Paint con ShellExecuteW cuando
 * mspaint.exe es un stub que no crea ventana propia.
 */
const PAINT_UWP_AUMID = "shell:AppsFolder\\Microsoft.Paint_8wekyb3d8bbwe!App";

const MIN_POLYLINE_POINTS = 2;
const MAX_POLYLINE_POINTS = 1_000;
const MIN_STROKES = 1;
const MAX_STROKES = 100;

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
    // Como respaldo se lanza la app moderna de Paint con ShellExecuteW.
    proc.shellExecuteApp(PAINT_UWP_AUMID);
    return await waitForPaintWindow(WINDOW_WAIT_TIMEOUT_MS);
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
  proc.spawnApplication("mspaint");
  const viaLaunched = await waitForNewPaintWindow(before, 5_000);
  if (viaLaunched !== null) {
    return { window: viaLaunched, createdBy: "launched" };
  }

  // 2) ShellExecuteW: instancia nueva de la app UWP (AppsFolder).
  proc.shellExecuteApp(PAINT_UWP_AUMID);
  const viaShell = await waitForNewPaintWindow(before, 5_000);
  if (viaShell !== null) {
    return { window: viaShell, createdBy: "shell" };
  }

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

/**
 * Valida una lista de puntos del lienzo y los convierte a área cliente
 * (lienzo + CANVAS_ORIGIN), comprobando que quepan en el área cliente.
 */
function validateAndToClient(
  window: proc.WindowInfo,
  points: Point2D[],
  path: string,
): Point2D[] {
  const clientPoints = points.map((point) => ({
    x: point.x + CANVAS_ORIGIN.x,
    y: point.y + CANVAS_ORIGIN.y,
  }));

  const clientSize = proc.getClientSize(window.hwnd);
  clientPoints.forEach((point, index) => {
    if (point.x >= clientSize.width || point.y >= clientSize.height) {
      const source = points[index];
      throw new Error(
        `${path}[${index}] (${source.x}, ${source.y}) está fuera ` +
          `del lienzo de Paint (máximo aprox. ` +
          `${clientSize.width - CANVAS_ORIGIN.x} px en X / ` +
          `${clientSize.height - CANVAS_ORIGIN.y} px en Y con este layout).`,
      );
    }
  });

  return clientPoints;
}

// ─────────────────────────────────────────────────────────────────────────────
// La ventana de Paint (analogía Ext.window.Window)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Crea la instancia PaintWindow sobre una ventana real: maximiza, trae al
 * primer plano antes de cada dibujo y ejecuta los arrastres sobre su propio
 * HWND (no hay estado global compartido entre instancias).
 */
function createPaintWindow(
  window: proc.WindowInfo,
  createdBy: WindowCreationMethod,
): PaintWindow {
  const info: PaintWindowInfo = {
    processId: window.pid,
    windowHandle: proc.hwndToHexString(window.hwnd),
    windowTitle: window.title,
    className: window.className,
    createdBy,
  };

  const prepare = async (): Promise<proc.FocusResult> => {
    // El layout (posición del lienzo y del toolbar) asume la ventana
    // maximizada: se maximiza también por si el usuario la encogió.
    await maximizePaintWindow(window.hwnd);
    const focus = await proc.bringWindowToFront(window.hwnd);

    // La ventana puede ser visible antes de que Paint termine de inicializar
    // el lienzo; si dibujamos demasiado pronto, el cursor recorre la ruta
    // pero la app aún muestra el indicador de carga y no pinta nada.
    await proc.sleep(PAINT_READY_DELAY_MS);

    return focus;
  };

  return {
    info,

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

      // Conversión de lienzo a área cliente y validación de límites.
      const clientPoints = validateAndToClient(window, points, "points");

      const focus = await prepare();
      if (options.skipToolSelection === false) {
        await selectPencilTool(window.hwnd);
      }

      // Conversión a coordenadas absolutas de pantalla (una sola vez).
      const screenPoints = clientPoints.map((point) =>
        proc.clientToScreen(window.hwnd, point),
      );

      // Arrastre único por todos los puntos.
      await proc.dragPolyline(screenPoints, options.stepDelayMs);

      return {
        success: true,
        processId: window.pid,
        windowHandle: info.windowHandle,
        windowTitle: window.title,
        createdBy,
        pointCount: points.length,
        startScreen: screenPoints[0],
        endScreen: screenPoints[screenPoints.length - 1],
        ...(focus.success ? {} : { warning: focus.warning }),
      };
    },

    async drawFreehand(
      trazos: Trazo[],
      options: DrawOptions,
    ): Promise<FreehandResult> {
      validateStepDelayMs(options.stepDelayMs);

      if (
        !Array.isArray(trazos) ||
        trazos.length < MIN_STROKES ||
        trazos.length > MAX_STROKES
      ) {
        throw new Error(
          `trazos debe tener entre ${MIN_STROKES} y ${MAX_STROKES} trazos ` +
            `(recibidos: ${trazos?.length ?? 0}).`,
        );
      }

      trazos.forEach((stroke, strokeIndex) => {
        if (
          stroke === null ||
          typeof stroke !== "object" ||
          !Array.isArray(stroke.puntos)
        ) {
          throw new Error(
            `trazos[${strokeIndex}] debe ser un objeto con una lista "puntos" ` +
              `(recibido: ${JSON.stringify(stroke)}).`,
          );
        }
        if (
          stroke.puntos.length < MIN_POLYLINE_POINTS ||
          stroke.puntos.length > MAX_POLYLINE_POINTS
        ) {
          throw new Error(
            `trazos[${strokeIndex}].puntos debe tener entre ` +
              `${MIN_POLYLINE_POINTS} y ${MAX_POLYLINE_POINTS} puntos ` +
              `(recibidos: ${stroke.puntos.length}).`,
          );
        }
        stroke.puntos.forEach((point, pointIndex) =>
          validateCoordinatePair(
            point,
            `trazos[${strokeIndex}].puntos[${pointIndex}]`,
          ),
        );
      });

      // Conversión de lienzo a área cliente y validación de límites.
      const clientStrokes = trazos.map((stroke, strokeIndex) =>
        validateAndToClient(
          window,
          stroke.puntos,
          `trazos[${strokeIndex}].puntos`,
        ),
      );

      const focus = await prepare();
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

      return {
        success: true,
        processId: window.pid,
        windowHandle: info.windowHandle,
        windowTitle: window.title,
        createdBy,
        strokeCount: trazos.length,
        totalPoints,
        startScreen: screenStrokes[0][0],
        endScreen:
          screenStrokes[screenStrokes.length - 1][
            screenStrokes[screenStrokes.length - 1].length - 1
          ],
        ...(focus.success ? {} : { warning: focus.warning }),
      };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// El driver: implementación concreta del puerto PaintPort
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Crea el adaptador de Paint sobre Win32 (un driver por proceso Node).
 * Cada llamada a createWindow() abre una ventana NUEVA con lienzo limpio.
 */
export function createWin32PaintDriver(): PaintPort {
  return {
    async createWindow(): Promise<PaintWindow> {
      const existing = findPaintWindows();

      if (existing.length === 0) {
        // No hay Paint abierto: se lanza y su ventana ya trae un lienzo limpio.
        const window = await launchPaintWindow();
        return createPaintWindow(window, "opened");
      }

      // Paint ya está abierto: crear una ventana nueva (proceso mspaint con
      // respaldo por ShellExecuteW) para no superponer dibujos de ventanas
      // anteriores.
      const { window: fresh, createdBy } = await createNewPaintWindow();
      return createPaintWindow(fresh, createdBy);
    },
  };
}
