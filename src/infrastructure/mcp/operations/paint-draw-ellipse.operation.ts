import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PaintController } from "../../../paint/paint-controller.js";
import { notifyOperationFinished } from "../../win32/process.js";
import { runPaintDrawEllipseTool } from "../../../paint/tools/paint-draw-ellipse-tool.js";
import { toolErrorResult } from "../errors.js";
import { logToolFinished, logToolStarted } from "../tool-logging.js";
import {
  durationMsSchema,
  ellipseHeightSchema,
  ellipseWidthSchema,
  ellipseXSchema,
  ellipseYSchema,
  windowModeSchema,
} from "../schemas.js";

export function registerPaintDrawEllipse(
  server: McpServer,
  controller: PaintController,
): void {
  server.registerTool(
    "paint_draw_ellipse",
    {
      title: "Draw Ellipse in Paint",
      description:
        "Discovers the native Paint Ellipse tool through UI Automation, selects " +
        "it semantically, resolves the canvas, and draws the ellipse using a " +
        "mouse drag relative to the Paint canvas.",
      inputSchema: {
        x: ellipseXSchema,
        y: ellipseYSchema,
        width: ellipseWidthSchema,
        height: ellipseHeightSchema,
        durationMs: durationMsSchema,
        windowMode: windowModeSchema,
      },
    },
    async (args) => {
      logToolStarted("paint_draw_ellipse", args);
      let outcome: "success" | "error" = "error";
      try {
        const result = await runPaintDrawEllipseTool(controller, args);
        return {
          content: [
            {
              type: "text",
              text:
                `Ellipse drawn at (${result.bounds.x}, ${result.bounds.y}) ` +
                `with size ${result.bounds.width}x${result.bounds.height}.`,
            },
          ],
          structuredContent: result,
        };
        outcome = "success";
        return response;
      } catch (error: unknown) {
        return toolErrorResult("paint_draw_ellipse", error);
      } finally {
        logToolFinished("paint_draw_ellipse", outcome);
        notifyOperationFinished();
      }
    },
  );
}
