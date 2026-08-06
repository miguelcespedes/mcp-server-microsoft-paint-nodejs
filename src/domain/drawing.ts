/**
 * NÚCLEO del dominio: tipos del dibujo, el puerto PaintPort y la ventana
 * de Paint como objeto (analogía Ext.window.Window).
 *
 * Regla del patrón hexagonal: este módulo es 100% puro — no importa Win32,
 * MCP ni Koffi. Define el contrato que cualquier implementación (Win32,
 * mock de pruebas, etc.) debe cumplir. Los adaptadores viven en
 * src/infrastructure/ y el punto de composición es src/server.ts.
 */

/** Punto en el lienzo (entradas) o en pantalla (salidas). */
export interface Point2D {
  x: number;
  y: number;
}

/** Stroke: a list of points drawn with a single mouse drag. */
export interface Stroke {
  points: Point2D[];
}

/**
 * Cómo se creó la ventana de Paint:
 *  - "opened": no había Paint abierto; se lanzó un proceso nuevo (o el shell)
 *    y la ventana aparece con un lienzo limpio.
 *  - "launched": ya había Paint abierto; se lanzó un proceso nuevo de
 *    mspaint.exe y se detectó la ventana nueva.
 *  - "shell": ya había Paint abierto; la instancia nueva se creó con
 *    ShellExecuteW (AUMID de la app) porque mspaint.exe no creó ventana.
 */
export type WindowCreationMethod = "opened" | "launched" | "shell";

/** Opciones comunes de dibujo. */
export interface DrawOptions {
  /** Retraso entre movimientos del mouse en ms (0–200). */
  stepDelayMs: number;
  /**
   * Si es false, se selecciona la herramienta Lápiz en la barra de
   * herramientas antes de dibujar. Por defecto (undefined) NO se toca el
   * toolbar: se dibuja con la herramienta activa (Paint inicia con la
   * Brocha, que dibuja con un arrastre normal).
   */
  skipToolSelection?: boolean;
}

/** Información de una ventana de Paint creada por el adaptador. */
export interface PaintWindowInfo {
  processId: number;
  windowHandle: string;
  windowTitle: string;
  className: string;
  createdBy: WindowCreationMethod;
}

export type PolylineResult = {
  success: boolean;
  processId: number;
  windowHandle: string;
  windowTitle: string;
  createdBy: WindowCreationMethod;
  pointCount: number;
  startScreen: Point2D;
  endScreen: Point2D;
  warning?: string;
};

export type FreehandResult = {
  success: boolean;
  processId: number;
  windowHandle: string;
  windowTitle: string;
  createdBy: WindowCreationMethod;
  /** Number of strokes drawn. */
  strokeCount: number;
  /** Total number of points across all strokes. */
  totalPoints: number;
  startScreen: Point2D;
  endScreen: Point2D;
  warning?: string;
};

/**
 * VENTANA DE PAINT (analogía Ext.window.Window): una instancia representa
 * UNA ventana con su propio lienzo. Cada operación crea su propia instancia
 * con `paint.createWindow()` y dibuja sobre ella; los dibujos de distintas
 * operaciones nunca se superponen.
 */
export interface PaintWindow {
  readonly info: PaintWindowInfo;
  /** Dibuja una polilínea (serie de puntos) con un único arrastre. */
  drawPolyline(
    points: Point2D[],
    options: DrawOptions,
  ): Promise<PolylineResult>;
  /** Draws one or more freehand strokes, each with a single drag. */
  drawFreehand(
    strokes: Stroke[],
    options: DrawOptions,
  ): Promise<FreehandResult>;
}

/**
 * PUERTO del dominio: crea ventanas de Paint.
 *
 * Las operaciones MCP dependen de esta interfaz, no de la implementación.
 * Un adaptador (src/infrastructure/win32/paint.ts) la implementa con Win32.
 */
export interface PaintPort {
  /**
   * Crea una ventana NUEVA de Paint con un lienzo limpio y devuelve su
   * instancia lista para dibujar.
   */
  createWindow(): Promise<PaintWindow>;
}
