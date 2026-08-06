/**
 * Operación "Dibujar polilínea": una serie de puntos conectados con un
 * único arrastre del mouse. Es la primitiva base de las operaciones que
 * dibujan curvas, espirales o dibujos generados.
 *
 * Cada llamada crea su propia instancia de ventana de Paint
 * (paint.createWindow()) con un lienzo limpio: los dibujos de llamadas
 * distintas nunca se superponen.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PaintPort } from "../../../domain/drawing.js";
import { toolErrorResult } from "../errors.js";
import {
  pointSchema,
  skipToolSelectionSchema,
  stepDelayMsSchema,
} from "../schemas.js";

export function registerPolyline(
  server: McpServer,
  paint: PaintPort,
): void {
  server.registerTool(
    "paint_draw_polyline",
    {
      title: "Dibujar polilínea en Paint",
      description:
        "Dibuja una polilínea (una serie de puntos conectados) en el lienzo " +
        "de Microsoft Paint con un ÚNICO arrastre del mouse: ideal para " +
        "curvas, espirales o dibujos generados. Cada llamada abre una " +
        "ventana NUEVA de Paint con lienzo limpio (si Paint ya estaba " +
        "abierto, abre otra ventana). Las coordenadas son relativas al " +
        "lienzo (área dibujable de Paint), NO al área cliente. Si se " +
        "prefiere la herramienta Lápiz, pasar skipToolSelection=false. " +
        "Solo funciona en Windows. " +
        'Ejemplo de JSON: {"points": [{"x": 200, "y": 100}, ' +
        '{"x": 600, "y": 100}, {"x": 600, "y": 500}, {"x": 200, "y": 500}], ' +
        '"stepDelayMs": 10}',
      inputSchema: {
        points: z
          .array(pointSchema)
          .min(2)
          .max(1000)
          .default([
            { x: 200, y: 100 },
            { x: 600, y: 100 },
            { x: 600, y: 500 },
            { x: 200, y: 500 },
          ])
          .describe(
            "Puntos de la polilínea en orden de trazado (entre 2 y 1000). " +
              "Opcional: si no se pasan, se dibuja un rectángulo de ejemplo " +
              "(el Inspector pre-rellena este valor). " +
              'Formato JSON: [{"x": 0, "y": 0}, {"x": 100, "y": 50}, ...]',
          ),
        stepDelayMs: stepDelayMsSchema,
        skipToolSelection: skipToolSelectionSchema,
      },
    },
    async (args) => {
      try {
        const window = await paint.createWindow();
        const result = await window.drawPolyline(args.points, {
          stepDelayMs: args.stepDelayMs,
          skipToolSelection: args.skipToolSelection,
        });
        return {
          content: [
            {
              type: "text",
              text:
                `Polilínea dibujada con ${result.pointCount} puntos en ` +
                `"${result.windowTitle}" (HWND ${result.windowHandle}, ` +
                `ventana ${result.createdBy}).` +
                (result.warning ? ` Aviso: ${result.warning}` : ""),
            },
          ],
          structuredContent: result,
        };
      } catch (error: unknown) {
        return toolErrorResult("paint_draw_polyline", error);
      }
    },
  );
}
