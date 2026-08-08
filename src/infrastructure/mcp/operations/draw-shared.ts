/**
 * Lógica compartida entre paint_draw (generadores 2D + freehand) y
 * paint_draw_3d (sólidos/mallas). Vive aquí para no duplicar el manejo de
 * canvas, ajuste de aspecto, verificación por captura de pantalla y
 * anotación de errores de bounds con su generador de origen entre los dos
 * archivos de operación.
 */

import type { z } from "zod";
import type { PaintController } from "../../../paint/paint-controller.js";
import type {
  PaintCanvasInfo,
  PaintPort,
  PaintWindow,
  Point2D,
  Stroke,
} from "../../../domain/drawing.js";
import { boundingBox, fitStrokes } from "../../../domain/figures.js";
import { captureRegionHasInk, type ScreenshotVerification } from "../../win32/screenshot.js";
import type { fitSchema } from "../schemas.js";

export interface StrokeProvenanceEntry {
  generatorIndex: number;
  kind: string;
}

/**
 * Aplana una lista de generadores a sus strokes resultantes, conservando de
 * qué generador (índice + kind) vino cada uno. Sin esto, un error de
 * "strokes[N] fuera de los límites del canvas" no dice qué generador de la
 * llamada lo causó cuando se combinan varios en un solo paint_draw.
 */
export function buildStrokesWithProvenance<G extends { kind: string }>(
  generators: G[],
  generatorToStrokes: (generator: G) => Point2D[][],
): { allStrokes: Point2D[][]; provenance: StrokeProvenanceEntry[] } {
  const allStrokes: Point2D[][] = [];
  const provenance: StrokeProvenanceEntry[] = [];
  generators.forEach((generator, generatorIndex) => {
    for (const points of generatorToStrokes(generator)) {
      allStrokes.push(points);
      provenance.push({ generatorIndex, kind: generator.kind });
    }
  });
  return { allStrokes, provenance };
}

export function fitStrokesToCanvas(
  strokes: Stroke[],
  fit: z.infer<typeof fitSchema>,
  canvas: PaintCanvasInfo,
): Stroke[] {
  if (fit === "none" || canvas.logicalWidth <= 0 || canvas.logicalHeight <= 0) {
    return strokes;
  }
  const fitted = fitStrokes(
    strokes.map((stroke) => stroke.points),
    {
      width: canvas.logicalWidth,
      height: canvas.logicalHeight,
      mode: fit,
      margin: 0.05,
    },
  );
  return fitted.map((points) => ({ points }));
}

export function formatCanvasBounds(strokes: Stroke[]): string {
  const bounds = boundingBox(strokes.map((stroke) => stroke.points));
  if (bounds === null) {
    return "no content bounds";
  }
  return `bounds ${bounds.minX},${bounds.minY}..${bounds.maxX},${bounds.maxY}`;
}

/** Redimensiona el lienzo si se pidió explícitamente vía el parámetro 'canvas'. */
export async function resizeCanvasIfRequested(
  paint: PaintPort,
  controller: PaintController,
  canvasArg: { width: number; height: number } | undefined,
  window: PaintWindow,
): Promise<PaintWindow> {
  if (!canvasArg) {
    return window;
  }
  await controller.setCanvasSize(canvasArg.width, canvasArg.height);
  return paint.createWindow();
}

/**
 * Con fit: contain/fill, si la proporción del contenido difiere mucho de la
 * del lienzo actual, lo redimensiona para acercarse a la proporción del
 * contenido (evita dibujos aplastados/estirados). No-op con fit: none.
 */
export async function autoResizeCanvasForAspect(
  paint: PaintPort,
  controller: PaintController,
  fit: z.infer<typeof fitSchema>,
  allStrokes: Point2D[][],
  window: PaintWindow,
): Promise<PaintWindow> {
  if (fit !== "contain" && fit !== "fill") {
    return window;
  }
  const contentBox = boundingBox(allStrokes);
  if (!contentBox) {
    return window;
  }
  const contentWidth = contentBox.maxX - contentBox.minX;
  const contentHeight = contentBox.maxY - contentBox.minY;
  if (contentWidth <= 0 || contentHeight <= 0) {
    return window;
  }
  const contentAspect = contentWidth / contentHeight;
  const canvasAspect = window.canvas.logicalWidth / window.canvas.logicalHeight;
  const aspectDiff = Math.abs(contentAspect - canvasAspect) / Math.max(contentAspect, canvasAspect);
  if (aspectDiff <= 0.15) {
    return window;
  }
  // Fijo (no derivado del canvas ACTUAL): la ventana de Paint se reutiliza
  // entre llamadas, así que basar esto en window.canvas.logicalWidth/Height
  // hace que el tamaño crezca sin control call tras call si una llamada
  // previa ya lo había agrandado (cada auto-ajuste usaba el resultado del
  // anterior como nueva base).
  const maxDim = 1200;
  let newWidth: number;
  let newHeight: number;
  if (contentAspect >= 1) {
    newWidth = maxDim;
    newHeight = Math.round(maxDim / contentAspect);
  } else {
    newHeight = maxDim;
    newWidth = Math.round(maxDim * contentAspect);
  }
  await controller.setCanvasSize(newWidth, newHeight);
  return paint.createWindow();
}

/**
 * Verifica por captura de pantalla que el dibujo cambió píxeles realmente,
 * o devuelve un resultado "saltado" consistente cuando verify: false (ver
 * el parámetro 'verify' del schema — evita pagar el costo del subproceso
 * de PowerShell en llamadas donde no se necesita).
 */
export async function verifyDrawnRegion(
  canvas: PaintCanvasInfo,
  verify: boolean,
): Promise<ScreenshotVerification> {
  if (!verify) {
    return { hasInk: null, nonWhiteRatio: null, reason: "verification skipped (verify: false)" };
  }
  return captureRegionHasInk({
    left: canvas.screenOrigin.x,
    top: canvas.screenOrigin.y,
    width: canvas.width,
    height: canvas.height,
  });
}

export function verificationMessage(verification: ScreenshotVerification): string {
  return verification.hasInk === null
    ? `Pixel verification unavailable (${verification.reason}).`
    : verification.hasInk
      ? "Pixel verification confirmed ink on canvas."
      : "WARNING: pixel verification found no ink on canvas despite success.";
}

/**
 * Anota un error de bounds ("strokes[N] ...") con el generador (índice +
 * kind) que lo produjo, si se puede determinar a partir de la provenance.
 * Muta el mensaje del error in-place (mismo patrón que toolErrorResult
 * espera: un Error con .message legible).
 */
export function annotateStrokeProvenanceError(
  error: unknown,
  provenance: StrokeProvenanceEntry[],
): void {
  if (!(error instanceof Error)) {
    return;
  }
  const match = /strokes\[(\d+)\]/.exec(error.message);
  if (!match) {
    return;
  }
  const entry = provenance[Number(match[1])];
  if (entry) {
    error.message += ` (proviene del generador #${entry.generatorIndex}, tipo: "${entry.kind}")`;
  }
}
