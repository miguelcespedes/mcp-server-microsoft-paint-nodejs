/**
 * Operación "Dibujo Libre": una o varias pinceladas (trazos), cada una con
 * un único arrastre del mouse.
 *
 * Formato PROVISIONAL en JSON hasta que llegue la especificación definitiva:
 *   {"trazos": [{"puntos": [{"x": 0, "y": 0}, {"x": 100, "y": 50}, ...]}, ...]}
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

export function registerFreehand(
  server: McpServer,
  paint: PaintPort,
): void {
  server.registerTool(
    "paint_draw_libre",
    {
      title: "Dibujo Libre",
      description:
        "Dibuja un dibujo libre en el lienzo de Microsoft Paint: una o " +
        "varias pinceladas (trazos), cada una con un único arrastre del " +
        "mouse. Cada llamada abre una ventana NUEVA de Paint con lienzo " +
        "limpio (si Paint ya estaba abierto, abre otra ventana). " +
        "Las coordenadas son relativas al lienzo (área dibujable de Paint), " +
        "NO al área cliente. Formato del JSON (provisional, pendiente de " +
        'especificación): {"trazos": [{"puntos": [{"x": 0, "y": 0}, ...]}, ...]}. ' +
        "Si se prefiere la herramienta Lápiz, pasar " +
        "skipToolSelection=false. Solo funciona en Windows. " +
        'Ejemplo de JSON: {"trazos": [{"puntos": [{"x": 100, "y": 100}, ' +
        '{"x": 200, "y": 300}, {"x": 300, "y": 100}, {"x": 400, "y": 300}, ' +
        '{"x": 500, "y": 100}]}, {"puntos": [{"x": 550, "y": 300}, ' +
        '{"x": 650, "y": 100}]}], "stepDelayMs": 10}',
      inputSchema: {
        trazos: z
          .array(
            z.object({
              puntos: z
                .array(pointSchema)
                .min(2)
                .max(1000)
                .describe(
                  "Puntos del trazo en orden de trazado (entre 2 y 1000). " +
                    'Formato JSON: [{"x": 0, "y": 0}, {"x": 100, "y": 50}, ...]',
                ),
            }),
          )
          .min(1)
          .max(100)
          .default([
            {
              puntos: [
                { x: 100, y: 100 },
                { x: 200, y: 300 },
                { x: 300, y: 100 },
                { x: 400, y: 300 },
                { x: 500, y: 100 },
              ],
            },
            {
              puntos: [
                { x: 550, y: 300 },
                { x: 650, y: 100 },
              ],
            },
          ])
          .describe(
            "Trazos del dibujo en orden de trazado (entre 1 y 100). " +
              "Opcional: si no se pasan, se dibuja el ejemplo en zigzag " +
              "(el Inspector pre-rellena este valor). " +
              'Formato JSON: [{"puntos": [...]}, {"puntos": [...]}, ...]',
          ),
        stepDelayMs: stepDelayMsSchema,
        skipToolSelection: skipToolSelectionSchema,
      },
    },
    async (args) => {
      try {
        const window = await paint.createWindow();
        const result = await window.drawFreehand(args.trazos, {
          stepDelayMs: args.stepDelayMs,
          skipToolSelection: args.skipToolSelection,
        });
        return {
          content: [
            {
              type: "text",
              text:
                `Dibujo libre completado: ${result.strokeCount} trazos, ` +
                `${result.totalPoints} puntos en "${result.windowTitle}" ` +
                `(HWND ${result.windowHandle}, ventana ${result.createdBy}).` +
                (result.warning ? ` Aviso: ${result.warning}` : ""),
            },
          ],
          structuredContent: result,
        };
      } catch (error: unknown) {
        return toolErrorResult("paint_draw_libre", error);
      }
    },
  );
}
