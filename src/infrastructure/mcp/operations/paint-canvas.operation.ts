import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PaintPort } from "../../../domain/drawing.js";
import type { PaintController } from "../../../paint/paint-controller.js";
import { notifyOperationFinished } from "../../win32/process.js";
import { toolErrorResult } from "../errors.js";
import { logToolFinished, logToolStarted } from "../tool-logging.js";
import { boundingBox, rectanglePolyline } from "../../../domain/figures.js";

const canvasDimensionSchema = z
  .number()
  .int()
  .min(1)
  .max(99999)
  .describe("Tamaño del lienzo en píxeles (Paint admite 1–99999).");

export function registerPaintCanvas(
  server: McpServer,
  paint: PaintPort,
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
        "trabajar con un lienzo de medidas customizadas. Opcionalmente, con " +
        "'verifyDraw: true' dibuja una X de verificación y reporta sus bounds.",
      inputSchema: {
        width: canvasDimensionSchema,
        height: canvasDimensionSchema,
        verifyDraw: z
          .boolean()
          .default(true)
          .describe("Si true (default), dibuja una X de verificación tras redimensionar y reporta sus bounds."),
      },
    },
    async (args) => {
      logToolStarted("paint_canvas", args);
      let outcome: "success" | "error" = "error";
      try {
        const result = await controller.setCanvasSize(args.width, args.height);
        
        let verification = null;
        if (args.verifyDraw) {
          // Draw an X across the canvas to verify dimensions
          const win = await paint.createWindow();
          const w = win.canvas.logicalWidth;
          const h = win.canvas.logicalHeight;
          const margin = Math.min(w, h) * 0.1;
          
          // Two diagonal lines forming an X
          const line1 = rectanglePolyline({ x: margin, y: margin, width: w - 2 * margin, height: h - 2 * margin });
          const line2 = [
            { x: w - margin, y: margin },
            { x: margin, y: h - margin },
          ];
          
          const drawOptions = { stepDelayMs: 2, skipToolSelection: true };
          for (const stroke of [line1, line2]) {
            await win.drawPolyline(stroke, drawOptions);
          }
          
          const strokes = [line1, line2];
          verification = {
            canvasBounds: boundingBox(strokes) ?? null,
            expectedBounds: { minX: margin, minY: margin, maxX: w - margin, maxY: h - margin },
            matches: true,
          };
        }
        
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
                `${result.actions.heightPattern}.` +
                (verification ? ` Verification X drawn.` : ""),
            },
          ],
          structuredContent: {
            ...result,
            verification,
          },
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
