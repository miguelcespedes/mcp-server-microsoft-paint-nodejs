import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PaintController } from "../../../paint/paint-controller.js";
import { notifyOperationFinished } from "../../win32/process.js";
import { runPaintInventoryTool } from "../../../paint/tools/paint-inventory-tool.js";
import { debugResultText } from "../debug-text.js";
import { toolErrorResult } from "../errors.js";
import { logToolFinished, logToolStarted } from "../tool-logging.js";
import {
  includeBoundingRectanglesSchema,
  inventoryFilterSchema,
  inventoryMaxDepthSchema,
  windowModeSchema,
} from "../schemas.js";

export function registerPaintInventory(
  server: McpServer,
  controller: PaintController,
): void {
  server.registerTool(
    "paint_inventory",
    {
      title: "Diagnóstico: inventario de UI de Paint",
      description:
        "Herramienta de diagnóstico. Inspecciona el árbol completo de UI Automation " +
        "de Microsoft Paint y devuelve un inventario resumido de grupos y controles. " +
        "Úsala cuando necesites entender cómo está expuesta la interfaz de Paint: " +
        "secciones como Formas, controles candidatos, diferencias entre versiones, " +
        "idioma detectado y estructura general de la ventana. No dibuja nada.",
      inputSchema: {
        maxDepth: inventoryMaxDepthSchema,
        includeBoundingRectangles: includeBoundingRectanglesSchema,
        filter: inventoryFilterSchema.default("shape"),
        windowMode: windowModeSchema,
      },
    },
    async (args) => {
      logToolStarted("paint_inventory", args);
      let outcome: "success" | "error" = "error";
      try {
        const result = await runPaintInventoryTool(controller, args);
        const shapesGroup = result.groups.find((group) => group.id === "shapes");
        const ellipseCandidate = shapesGroup?.controls.find(
          (control) => control.id === "elipse" || control.displayName === "Elipse",
        );
        outcome = "success";
        return {
          content: [
            {
              type: "text",
              text: debugResultText(
                `Paint inventory completed for "${result.paint.windowTitle}" ` +
                `with ${result.groups.length} group(s) discovered.` +
                (shapesGroup
                  ? ` Shapes group: "${shapesGroup.displayName}" with ${shapesGroup.controls.length} control(s).`
                  : "") +
                (ellipseCandidate
                  ? ` Ellipse candidate: "${ellipseCandidate.displayName}" (${ellipseCandidate.controlType}).`
                  : "") +
                (result.canvas
                  ? ` Canvas detected: "${result.canvas.elementName ?? "Canvas"}" ` +
                    `(${result.canvas.width}x${result.canvas.height}, source=${result.canvas.source}` +
                    (result.canvas.automationId
                      ? `, automationId=${result.canvas.automationId}`
                      : "") +
                    `).`
                  : ""),
                result,
              ),
            },
          ],
          structuredContent: result,
        };
      } catch (error: unknown) {
        return toolErrorResult("paint_inventory", error);
      } finally {
        logToolFinished("paint_inventory", outcome);
        notifyOperationFinished();
      }
    },
  );
}
