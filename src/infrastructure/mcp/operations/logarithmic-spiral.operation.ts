/**
 * Operation "Logarithmic Spiral" (Example 1): r = 1.1^θ, 6 turns.
 *
 * Takes no arguments: serves as a placeholder for testing the server from
 * Inspector. Each call creates its own Paint window instance with a clean
 * Paint (paint.createWindow()) con lienzo limpio. La matemática de la
 * figura vive en el dominio (src/domain/figures.ts) como función pura;
 * esta operación solo la usa y delega el dibujo a su instancia PaintWindow.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PaintPort } from "../../../domain/drawing.js";
import { logarithmicSpiral } from "../../../domain/figures.js";
import { toolErrorResult } from "../errors.js";

/** Parameters for Example 1 (center of the maximized 892x723 canvas). */
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
    "paint_draw_logarithmic_spiral",
    {
      title: "Logarithmic Spiral",
      description:
        "Example 1: draws a logarithmic spiral r = 1.1^theta (6 turns) " +
        "on the Microsoft Paint canvas using paint_draw_polyline. It takes " +
        "no arguments and is meant as a quick placeholder tool for the " +
        "Inspector. Each call opens a NEW Paint window with a clean canvas. " +
        "Windows only.",
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
                `Logarithmic spiral drawn: ${result.pointCount} points ` +
                `in "${result.windowTitle}" (HWND ${result.windowHandle}, ` +
                `window ${result.createdBy}).`,
            },
          ],
          structuredContent: result,
        };
      } catch (error: unknown) {
        return toolErrorResult("paint_draw_logarithmic_spiral", error);
      }
    },
  );
}
