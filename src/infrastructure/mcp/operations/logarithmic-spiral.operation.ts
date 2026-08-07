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
import { logarithmicSpiral, spiralMaxRadius } from "../../../domain/figures.js";
import { notifyOperationFinished } from "../../win32/process.js";
import { toolErrorResult } from "../errors.js";
import { logToolFinished, logToolStarted } from "../tool-logging.js";

const BASE_SPIRAL_PARAMS = {
  growth: 1.1,
  turns: 6,
  angleStep: 0.05,
  scale: 1,
  center: { x: 0, y: 0 },
} as const;

function buildSpiralParamsForCanvas(canvas: {
  logicalWidth: number;
  logicalHeight: number;
}) {
  const center = {
    x: Math.floor(canvas.logicalWidth / 2),
    y: Math.floor(canvas.logicalHeight / 2),
  };

  // Keep a small margin from the document edges so the spiral fits even on
  // smaller canvases and does not touch resize handles or page borders.
  const maxAllowedRadius = Math.max(
    8,
    Math.floor(Math.min(canvas.logicalWidth, canvas.logicalHeight) / 2) - 12,
  );

  const unitRadius = spiralMaxRadius(BASE_SPIRAL_PARAMS);
  const scale = Math.max(1, maxAllowedRadius / unitRadius);

  return {
    ...BASE_SPIRAL_PARAMS,
    center,
    scale,
  };
}

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
      logToolStarted("paint_draw_logarithmic_spiral");
      let outcome: "success" | "error" = "error";
      try {
        const window = await paint.createWindow();
        const points = logarithmicSpiral(buildSpiralParamsForCanvas(window.canvas));
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
        outcome = "success";
        return response;
      } catch (error: unknown) {
        return toolErrorResult("paint_draw_logarithmic_spiral", error);
      } finally {
        logToolFinished("paint_draw_logarithmic_spiral", outcome);
        notifyOperationFinished();
      }
    },
  );
}
