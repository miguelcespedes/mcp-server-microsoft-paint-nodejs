import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PaintController } from "../../../paint/paint-controller.js";
import { notifyOperationFinished } from "../../win32/process.js";
import { debugResultText } from "../debug-text.js";
import { toolErrorResult } from "../errors.js";
import { logToolFinished, logToolStarted } from "../tool-logging.js";
import { windowModeSchema } from "../schemas.js";

export function registerPaintDebugCanvas(
  server: McpServer,
  controller: PaintController,
): void {
  server.registerTool(
    "paint_debug_canvas",
    {
      title: "Debug canvas activo de Paint",
      description:
        "Herramienta de diagnóstico. Devuelve el canvas activo y su geometría relevante para entender dónde se está dibujando realmente.",
      inputSchema: {
        windowMode: windowModeSchema,
      },
    },
    async (args) => {
      logToolStarted("paint_debug_canvas", args);
      let outcome: "success" | "error" = "error";
      try {
        const result = await controller.activeCanvasDebug(args.windowMode);
        outcome = "success";
        return {
          content: [
            {
              type: "text",
              text: debugResultText(
                `Paint canvas debug collected for "${result.paint.windowTitle}".`,
                result,
              ),
            },
          ],
          structuredContent: result,
        };
      } catch (error: unknown) {
        return toolErrorResult("paint_debug_canvas", error);
      } finally {
        logToolFinished("paint_debug_canvas", outcome);
        notifyOperationFinished();
      }
    },
  );
}
