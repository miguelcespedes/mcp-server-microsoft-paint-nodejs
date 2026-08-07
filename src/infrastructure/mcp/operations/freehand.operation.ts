/**
 * Operación "Freehand": uno o más strokes, cada uno con
 * un único arrastre del mouse.
 *
 * Formato PROVISIONAL en JSON hasta que llegue la especificación definitiva:
 *   {"strokes": [{"points": [{"x": 0, "y": 0}, {"x": 100, "y": 50}, ...]}, ...]}
 *
 * Cada llamada crea su propia instancia de ventana de Paint
 * (paint.createWindow()) con un lienzo limpio: los dibujos de llamadas
 * distintas nunca se superponen.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PaintPort } from "../../../domain/drawing.js";
import { notifyOperationFinished } from "../../win32/process.js";
import { toolErrorResult } from "../errors.js";
import { logToolFinished, logToolStarted } from "../tool-logging.js";
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
    "paint_draw_freehand",
    {
      title: "Freehand Drawing",
      description:
        "Draws freehand content on the Microsoft Paint canvas: one or " +
        "more strokes, each one drawn with a single mouse drag. " +
        "mouse. Cada llamada abre una ventana NUEVA de Paint con lienzo " +
        "limpio (si Paint ya estaba abierto, abre otra ventana). " +
        "Coordinates are relative to the Paint canvas, NOT the client area. " +
        'JSON format: {"strokes": [{"points": [{"x": 0, "y": 0}, ...]}, ...]}. ' +
        "If you want the Pencil tool, pass skipToolSelection=false. " +
        "Windows only. " +
        'Example JSON: {"strokes": [{"points": [{"x": 100, "y": 100}, ' +
        '{"x": 170, "y": 220}, {"x": 240, "y": 100}, {"x": 310, "y": 220}, ' +
        '{"x": 380, "y": 100}]}, {"points": [{"x": 120, "y": 300}, ' +
        '{"x": 220, "y": 360}, {"x": 320, "y": 300}]}], "stepDelayMs": 10}',
      inputSchema: {
        strokes: z
          .array(
            z.object({
              points: z
                .array(pointSchema)
                .min(2)
                .max(1000)
                .describe(
                  "Stroke points in drawing order (between 2 and 1000). " +
                    'JSON format: [{"x": 0, "y": 0}, {"x": 100, "y": 50}, ...]',
                ),
            }),
          )
          .min(1)
          .max(100)
          .default([
            {
              points: [
                { x: 100, y: 100 },
                { x: 170, y: 220 },
                { x: 240, y: 100 },
                { x: 310, y: 220 },
                { x: 380, y: 100 },
              ],
            },
            {
              points: [
                { x: 120, y: 300 },
                { x: 220, y: 360 },
                { x: 320, y: 300 },
              ],
            },
          ])
          .describe(
            "Drawing strokes in drawing order (between 1 and 100). " +
              "Optional: if omitted, a zigzag demo is drawn " +
              "(the Inspector pre-fills this value). " +
              'JSON format: [{"points": [...]}, {"points": [...]}, ...]',
          ),
        stepDelayMs: stepDelayMsSchema,
        skipToolSelection: skipToolSelectionSchema,
      },
    },
    async (args) => {
      logToolStarted("paint_draw_freehand", args);
      let outcome: "success" | "error" = "error";
      try {
        const window = await paint.createWindow();
        const result = await window.drawFreehand(args.strokes, {
          stepDelayMs: args.stepDelayMs,
          skipToolSelection: args.skipToolSelection,
        });
        return {
          content: [
            {
              type: "text",
              text:
                `Freehand drawing completed: ${result.strokeCount} strokes, ` +
                `${result.totalPoints} points in "${result.windowTitle}" ` +
                `(HWND ${result.windowHandle}, window ${result.createdBy}).` +
                (result.warning ? ` Warning: ${result.warning}` : ""),
            },
          ],
          structuredContent: result,
        };
        outcome = "success";
        return response;
      } catch (error: unknown) {
        return toolErrorResult("paint_draw_freehand", error);
      } finally {
        logToolFinished("paint_draw_freehand", outcome);
        notifyOperationFinished();
      }
    },
  );
}
