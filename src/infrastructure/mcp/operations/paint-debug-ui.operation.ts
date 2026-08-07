import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PaintController } from "../../../paint/paint-controller.js";
import { notifyOperationFinished } from "../../win32/process.js";
import { debugResultText } from "../debug-text.js";
import { toolErrorResult } from "../errors.js";
import { logToolFinished, logToolStarted } from "../tool-logging.js";
import {
  includeBoundingRectanglesSchema,
  inventoryFilterSchema,
  inventoryMaxDepthSchema,
  windowModeSchema,
} from "../schemas.js";

export function registerPaintDebugUi(
  server: McpServer,
  controller: PaintController,
): void {
  server.registerTool(
    "paint_debug_ui",
    {
      title: "Debug UI de Paint",
      description:
        "Herramienta de diagnóstico. Inspecciona la UI general de Paint, sus grupos y controles accesibles. Úsala para depurar formas, ribbon, idioma y estructura general.",
      inputSchema: {
        maxDepth: inventoryMaxDepthSchema,
        includeBoundingRectangles: includeBoundingRectanglesSchema,
        filter: inventoryFilterSchema.default("shape"),
        windowMode: windowModeSchema,
      },
    },
    async (args) => {
      logToolStarted("paint_debug_ui", args);
      let outcome: "success" | "error" = "error";
      try {
        const result = await controller.inventory(args, true, args.windowMode);
        outcome = "success";
        return {
          content: [
            {
              type: "text",
              text: debugResultText(
                `Paint UI debug collected for "${result.paint.windowTitle}" with ${result.groups.length} group(s).`,
                result,
              ),
            },
          ],
          structuredContent: result,
        };
      } catch (error: unknown) {
        return toolErrorResult("paint_debug_ui", error);
      } finally {
        logToolFinished("paint_debug_ui", outcome);
        notifyOperationFinished();
      }
    },
  );
}
