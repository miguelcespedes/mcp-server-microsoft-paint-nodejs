import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PaintController } from "../../../paint/paint-controller.js";
import { notifyOperationFinished } from "../../win32/process.js";
import { debugResultText } from "../debug-text.js";
import { toolErrorResult } from "../errors.js";
import { logToolFinished, logToolStarted } from "../tool-logging.js";
import { windowModeSchema } from "../schemas.js";

export function registerPaintLayersDebug(
  server: McpServer,
  controller: PaintController,
): void {
  server.registerTool(
    "paint_layers_debug",
    {
      title: "Diagnóstico: capas en Paint",
      description:
        "Herramienta de diagnóstico. Inspecciona los elementos relacionados con Capas para entender el estado de la capa activa y su visibilidad en el editor.",
      inputSchema: {
        windowMode: windowModeSchema,
      },
    },
    async (args) => {
      logToolStarted("paint_layers_debug", args);
      let outcome: "success" | "error" = "error";
      try {
        const result = await controller.layersDebug(args.windowMode);
        outcome = "success";
        return {
          content: [
            {
              type: "text",
              text: debugResultText(
                `Layers debug collected for "${result.paint.windowTitle}" with ${result.matches.length} related element(s).`,
                result,
              ),
            },
          ],
          structuredContent: result,
        };
      } catch (error: unknown) {
        return toolErrorResult("paint_layers_debug", error);
      } finally {
        logToolFinished("paint_layers_debug", outcome);
        notifyOperationFinished();
      }
    },
  );
}
