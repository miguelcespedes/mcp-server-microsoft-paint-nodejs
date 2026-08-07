import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PaintPort } from "../../../domain/drawing.js";
import type { PaintController } from "../../../paint/paint-controller.js";
import { notifyOperationFinished } from "../../win32/process.js";
import { toolErrorResult } from "../errors.js";
import { logToolFinished, logToolStarted } from "../tool-logging.js";
import {
  durationMsSchema,
  ellipseHeightSchema,
  ellipseWidthSchema,
  ellipseXSchema,
  ellipseYSchema,
  pointSchema,
  stepDelayMsSchema,
  windowModeSchema,
} from "../schemas.js";

const primitiveSchema = z.enum(["ellipse", "polyline"]);

export function registerPaintDrawPrimitive(
  server: McpServer,
  paint: PaintPort,
  controller: PaintController,
): void {
  server.registerTool(
    "paint_draw_primitive",
    {
      title: "Dibujo con primitivas en Paint",
      description:
        "Herramienta productiva. Dibuja primitivas en Paint. En esta iteración " +
        "soporta 'ellipse' y 'polyline'. Para ellipse usa descubrimiento " +
        "semántico de la herramienta nativa; para polyline dibuja una serie de " +
        "puntos con un único arrastre.",
      inputSchema: {
        primitive: primitiveSchema.default("ellipse"),
        points: z
          .array(pointSchema)
          .min(2)
          .max(1000)
          .default([
            { x: 80, y: 80 },
            { x: 420, y: 80 },
            { x: 420, y: 360 },
            { x: 80, y: 360 },
          ])
          .optional(),
        x: ellipseXSchema,
        y: ellipseYSchema,
        width: ellipseWidthSchema,
        height: ellipseHeightSchema,
        stepDelayMs: stepDelayMsSchema,
        durationMs: durationMsSchema,
        windowMode: windowModeSchema,
      },
    },
    async (args) => {
      logToolStarted("paint_draw_primitive", args);
      let outcome: "success" | "error" = "error";
      try {
        if (args.primitive === "ellipse") {
          const result = await controller.drawEllipse(
            {
              x: args.x,
              y: args.y,
              width: args.width,
              height: args.height,
            },
            args.durationMs,
            args.windowMode,
          );
          outcome = "success";
          return {
            content: [
              {
                type: "text",
                text:
                  `Primitive ellipse drawn at (${result.bounds.x}, ${result.bounds.y}) ` +
                  `with size ${result.bounds.width}x${result.bounds.height}.`,
              },
            ],
            structuredContent: result,
          };
        }

        const window = await paint.createWindow();
        const result = await window.drawPolyline(args.points, {
          stepDelayMs: args.stepDelayMs,
        });
        outcome = "success";
        return {
          content: [
            {
              type: "text",
              text:
                `Primitive polyline drawn with ${result.pointCount} points in ` +
                `"${result.windowTitle}".`,
            },
          ],
          structuredContent: result,
        };
      } catch (error: unknown) {
        return toolErrorResult("paint_draw_primitive", error);
      } finally {
        logToolFinished("paint_draw_primitive", outcome);
        notifyOperationFinished();
      }
    },
  );
}
