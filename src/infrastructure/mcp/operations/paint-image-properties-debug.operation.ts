import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PaintController } from "../../../paint/paint-controller.js";
import { notifyOperationFinished } from "../../win32/process.js";
import { debugResultText } from "../debug-text.js";
import { toolErrorResult } from "../errors.js";
import { logToolFinished, logToolStarted } from "../tool-logging.js";
import { windowModeSchema } from "../schemas.js";

export function registerPaintImagePropertiesDebug(
  server: McpServer,
  controller: PaintController,
): void {
  server.registerTool(
    "paint_image_properties_debug",
    {
      title: "Diagnóstico: diálogo Propiedades de la imagen",
      description:
        "Herramienta de diagnóstico. Abre o inspecciona el diálogo de Propiedades de la imagen de Paint para descubrir cómo expone Ancho, Altura, Unidades y botones de confirmación en UI Automation.",
      inputSchema: {
        windowMode: windowModeSchema,
      },
    },
    async (args) => {
      logToolStarted("paint_image_properties_debug", args);
      let outcome: "success" | "error" = "error";
      try {
        const result = await controller.imagePropertiesDebug(args.windowMode);
        outcome = "success";
        return {
          content: [
            {
              type: "text",
              text: debugResultText(
                `Image properties debug collected for "${result.paint.windowTitle}".` +
                (result.dialog?.name ? ` Dialog: "${result.dialog.name}".` : ""),
                result,
              ),
            },
          ],
          structuredContent: result,
        };
      } catch (error: unknown) {
        return toolErrorResult("paint_image_properties_debug", error);
      } finally {
        logToolFinished("paint_image_properties_debug", outcome);
        notifyOperationFinished();
      }
    },
  );
}
