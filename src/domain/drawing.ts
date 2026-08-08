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

/** Caja envolvente en coordenadas de lienzo. */
export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
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
export type WindowCreationMethod =
  | "opened"
  | "launched"
  | "shell"
  | "reused";

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
  /** Grosor de la brocha/lápiz en píxeles (1–50). Solo afecta si se selecciona la herramienta. */
  thickness?: number;
}

/** Información de una ventana de Paint creada por el adaptador. */
export interface PaintWindowInfo {
  processId: number;
  windowHandle: string;
  windowTitle: string;
  className: string;
  createdBy: WindowCreationMethod;
}

export interface PaintCanvasInfo {
  source: "automation" | "fixed-layout";
  width: number;
  height: number;
  logicalWidth: number;
  logicalHeight: number;
  clientOrigin: Point2D;
  screenOrigin: Point2D;
  elementName?: string;
  automationId?: string;
}

export interface CanvasRequirement {
  width: number;
  height: number;
  units: "pixels";
}

export interface DrawingRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PaintWindowOptions {
  canvas?: CanvasRequirement;
  drawingRegion?: DrawingRegion;
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
  /** Geometría del lienzo resuelto en el momento del dibujo. */
  canvas: PaintCanvasInfo;
  /** Caja envolvente del contenido dibujado, en coordenadas de lienzo. */
  canvasBounds: BoundingBox | null;
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
  /** Geometría del lienzo resuelto en el momento del dibujo. */
  canvas: PaintCanvasInfo;
  /** Caja envolvente del contenido dibujado, en coordenadas de lienzo. */
  canvasBounds: BoundingBox | null;
  warning?: string;
};

/**
 * VENTANA DE PAINT (analogía Ext.window.Window): una instancia representa
 * UNA ventana con su propio lienzo. El driver gestiona una única ventana:
 * `paint.createWindow()` la reutiliza entre llamadas y vacía su lienzo
 * (Ctrl+A + Supr) antes de cada dibujo, de modo que nunca se acumulan
 * procesos de mspaint y cada dibujo arranca desde un lienzo limpio.
 */
export interface PaintWindow {
  readonly info: PaintWindowInfo;
  readonly canvas: PaintCanvasInfo;
  readonly drawingRegion?: DrawingRegion;
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
   * Devuelve una ventana de Paint con el lienzo limpio, lista para dibujar:
   * reutiliza la ventana gestionada del driver (vaciando su lienzo) o la
   * abre la primera vez.
   */
  createWindow(options?: PaintWindowOptions): Promise<PaintWindow>;
}
