import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PaintController } from "../../../paint/paint-controller.js";
import { notifyOperationFinished } from "../../win32/process.js";
import { debugResultText } from "../debug-text.js";
import { toolErrorResult } from "../errors.js";
import { logToolFinished, logToolStarted } from "../tool-logging.js";
import { windowModeSchema } from "../schemas.js";

export function registerPaintActiveCanvasDebug(
  server: McpServer,
  controller: PaintController,
): void {
  server.registerTool(
    "paint_active_canvas_debug",
    {
      title: "Diagnóstico: canvas activo de Paint",
      description:
        "Herramienta de diagnóstico. Devuelve solo la superficie de dibujo activa " +
        "que Paint está usando en este momento y sus propiedades geométricas y de " +
        "accesibilidad más importantes. Úsala cuando necesites depurar sobre qué " +
        "lienzo se va a dibujar realmente, comparar Rectángulo vs Elipse, revisar " +
        "bounding rectangle, logical size, or el origen del canvas activo. No dibuja nada.",
      inputSchema: {
        windowMode: windowModeSchema,
      },
    },
    async (args) => {
      logToolStarted("paint_active_canvas_debug", args);
      let outcome: "success" | "error" = "error";
      try {
        const result = await controller.activeCanvasDebug(args.windowMode);
        outcome = "success";
        return {
          content: [
            {
              type: "text",
              text: debugResultText(
                `Active canvas debug collected for "${result.paint.windowTitle}".` +
                (result.activeCanvasElement?.name
                  ? ` Active element: "${result.activeCanvasElement.name}".`
                  : ""),
                result,
              ),
            },
          ],
          structuredContent: result,
        };
      } catch (error: unknown) {
        return toolErrorResult("paint_active_canvas_debug", error);
      } finally {
        logToolFinished("paint_active_canvas_debug", outcome);
        notifyOperationFinished();
      }
    },
  );
}
