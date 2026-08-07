import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PaintController } from "../../../paint/paint-controller.js";
import { notifyOperationFinished } from "../../win32/process.js";
import { debugResultText } from "../debug-text.js";
import { toolErrorResult } from "../errors.js";
import { logToolFinished, logToolStarted } from "../tool-logging.js";
import { windowModeSchema } from "../schemas.js";

export function registerPaintShapeStyleDebug(
  server: McpServer,
  controller: PaintController,
): void {
  server.registerTool(
    "paint_shape_style_debug",
    {
      title: "Diagnóstico: estilo de shapes en Paint",
      description:
        "Herramienta de diagnóstico. Inspecciona controles relacionados con Contorno de forma, Relleno de forma, Tamaño y colores para depurar por qué una shape puede estar invisible.",
      inputSchema: {
        windowMode: windowModeSchema,
      },
    },
    async (args) => {
      logToolStarted("paint_shape_style_debug", args);
      let outcome: "success" | "error" = "error";
      try {
        const result = await controller.shapeStyleDebug(args.windowMode);
        outcome = "success";
        return {
          content: [
            {
              type: "text",
              text: debugResultText(
                `Shape style debug collected for "${result.paint.windowTitle}" with ${result.matches.length} relevant control(s).`,
                result,
              ),
            },
          ],
          structuredContent: result,
        };
      } catch (error: unknown) {
        return toolErrorResult("paint_shape_style_debug", error);
      } finally {
        logToolFinished("paint_shape_style_debug", outcome);
        notifyOperationFinished();
      }
    },
  );
}
