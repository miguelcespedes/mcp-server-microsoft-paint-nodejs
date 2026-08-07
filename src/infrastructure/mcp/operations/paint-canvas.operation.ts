import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PaintController } from "../../../paint/paint-controller.js";
import { notifyOperationFinished } from "../../win32/process.js";
import { toolErrorResult } from "../errors.js";
import { logToolFinished, logToolStarted } from "../tool-logging.js";

const canvasDimensionSchema = z
  .number()
  .int()
  .min(1)
  .max(99999)
  .describe("Tamaño del lienzo en píxeles (Paint admite 1–99999).");

export function registerPaintCanvas(
  server: McpServer,
  controller: PaintController,
): void {
  server.registerTool(
    "paint_canvas",
    {
      title: "Redimensionar lienzo",
      description:
        "Cambia el tamaño del lienzo de Paint a un ancho y alto personalizados " +
        "en píxeles. Abre el popup 'Propiedades de la imagen' (Ctrl+E), escribe " +
        "las medidas y confirma con 'Aceptar'. El tamaño se aplica al lienzo " +
        "actual; Paint además recuerda el último tamaño para documentos nuevos. " +
        "Devuelve el tamaño anterior, el nuevo (verificado desde la UI) y si la " +
        "operación se confirmó correctamente. Úsala antes de paint_draw para " +
        "trabajar con un lienzo de medidas customizadas.",
      inputSchema: {
        width: canvasDimensionSchema,
        height: canvasDimensionSchema,
      },
    },
    async (args) => {
      logToolStarted("paint_canvas", args);
      let outcome: "success" | "error" = "error";
      try {
        const result = await controller.setCanvasSize(args.width, args.height);
        outcome = "success";
        return {
          content: [
            {
              type: "text",
              text:
                `Canvas resized from ${result.previousCanvas.logicalWidth}x` +
                `${result.previousCanvas.logicalHeight} to ` +
                `${result.canvas.logicalWidth}x${result.canvas.logicalHeight} ` +
                `(${result.verified ? "verified" : "NOT verified"}) in ` +
                `${result.actions.popup} via ${result.actions.widthPattern}/` +
                `${result.actions.heightPattern}.`,
            },
          ],
          structuredContent: result,
        };
      } catch (error: unknown) {
        return toolErrorResult("paint_canvas", error);
      } finally {
        logToolFinished("paint_canvas", outcome);
        notifyOperationFinished();
      }
    },
  );
}
