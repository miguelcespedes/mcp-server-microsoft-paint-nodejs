/**
 * Operación "Espiral Logarítmica" (Ejemplo 1): r = 1.1^θ, 6 vueltas.
 *
 * No recibe argumentos: sirve como placeholder para probar el servidor
 * desde el Inspector. Cada llamada crea su propia instancia de ventana de
 * Paint (paint.createWindow()) con lienzo limpio. La matemática de la
 * figura vive en el dominio (src/domain/figures.ts) como función pura;
 * esta operación solo la usa y delega el dibujo a su instancia PaintWindow.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PaintPort } from "../../../domain/drawing.js";
import { logarithmicSpiral } from "../../../domain/figures.js";
import { toolErrorResult } from "../errors.js";

/** Parámetros del Ejemplo 1 (centro del lienzo maximizado: 892x723 px). */
const SPIRAL_PARAMS = {
  growth: 1.1,
  turns: 6,
  angleStep: 0.05,
  scale: 7,
  center: { x: 446, y: 361 },
} as const;

export function registerLogarithmicSpiral(
  server: McpServer,
  paint: PaintPort,
): void {
  server.registerTool(
    "paint_draw_espiral_logaritmica",
    {
      title: "Espiral Logarítmica",
      description:
        "Ejemplo 1: dibuja una espiral logarítmica r = 1.1^theta (6 vueltas) " +
        "en el lienzo de Microsoft Paint con paint_draw_polyline. No recibe " +
        "argumentos: es un placeholder para probar el servidor desde el " +
        "Inspector. Cada llamada abre una ventana NUEVA de Paint con lienzo " +
        "limpio. Solo funciona en Windows.",
      inputSchema: {},
    },
    async () => {
      try {
        const points = logarithmicSpiral(SPIRAL_PARAMS);
        const window = await paint.createWindow();
        const result = await window.drawPolyline(points, { stepDelayMs: 8 });
        return {
          content: [
            {
              type: "text",
              text:
                `Espiral logarítmica dibujada: ${result.pointCount} puntos ` +
                `en "${result.windowTitle}" (HWND ${result.windowHandle}, ` +
                `ventana ${result.createdBy}).`,
            },
          ],
          structuredContent: result,
        };
      } catch (error: unknown) {
        return toolErrorResult("paint_draw_espiral_logaritmica", error);
      }
    },
  );
}
