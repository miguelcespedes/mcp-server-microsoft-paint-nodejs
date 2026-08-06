/**
 * Operation "Draw Polyline": a series of connected points drawn with a
 * single mouse drag. It is the base primitive for curves, spirals, and other
 * generated drawings.
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
      title: "Draw Polyline in Paint",
      description:
        "Draws a polyline (a connected series of points) on the Microsoft " +
        "Paint canvas using a SINGLE mouse drag. Ideal for curves, spirals, " +
        "or generated drawings. Each call opens a NEW Paint window with a " +
        "clean canvas (if Paint is already open, another window is created). " +
        "Coordinates are relative to the Paint canvas, NOT the client area. " +
        "If you want the Pencil tool, pass skipToolSelection=false. " +
        "Windows only. " +
        'Example JSON: {"points": [{"x": 200, "y": 100}, ' +
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
            "Polyline points in drawing order (between 2 and 1000). " +
              "Optional: if omitted, a demo rectangle is drawn " +
              "(the Inspector pre-fills this value). " +
              'JSON format: [{"x": 0, "y": 0}, {"x": 100, "y": 50}, ...]',
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
                `Polyline drawn with ${result.pointCount} points in ` +
                `"${result.windowTitle}" (HWND ${result.windowHandle}, ` +
                `window ${result.createdBy}).` +
                (result.warning ? ` Warning: ${result.warning}` : ""),
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
