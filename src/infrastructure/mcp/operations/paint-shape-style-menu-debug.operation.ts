import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PaintController } from "../../../paint/paint-controller.js";
import { notifyOperationFinished } from "../../win32/process.js";
import { debugResultText } from "../debug-text.js";
import { toolErrorResult } from "../errors.js";
import { logToolFinished, logToolStarted } from "../tool-logging.js";
import {
  debugFilterSchema,
  debugMaxItemsSchema,
  shapeStyleMenuSchema,
  windowModeSchema,
} from "../schemas.js";

export function registerPaintShapeStyleMenuDebug(
  server: McpServer,
  controller: PaintController,
): void {
  server.registerTool(
    "paint_shape_style_menu_debug",
    {
      title: "Diagnóstico: menú de estilo de shape",
      description:
        "Herramienta de diagnóstico. Abre uno de los dropdowns de estilo de shapes (outline, fill o size) y devuelve los elementos visibles para descubrir las opciones reales del menú.",
      inputSchema: {
        menu: shapeStyleMenuSchema,
        filter: debugFilterSchema,
        maxItems: debugMaxItemsSchema,
        windowMode: windowModeSchema,
      },
    },
    async (args) => {
      logToolStarted("paint_shape_style_menu_debug", args);
      let outcome: "success" | "error" = "error";
      try {
        const result = await controller.shapeStyleMenuDebug(
          args.menu,
          args.filter,
          args.maxItems,
          args.windowMode,
        );
        const optionSummary =
          result.summary.optionNames.length > 0
            ? ` Options: ${result.summary.optionNames.join(" | ")}.`
            : "";
        const debugLines =
          result.summary.optionDebugLines.length > 0
            ? ` Candidates: ${result.summary.optionDebugLines.join(" || ")}.`
            : "";
        const compactText =
          `Shape style menu debug collected for ${result.menu}. ` +
          `${result.summary.count} visible candidate item(s) found.` +
          optionSummary +
          debugLines;
        outcome = "success";
        return {
          content: [
            {
              type: "text",
              text: debugResultText(compactText, result),
            },
          ],
          structuredContent: result,
        };
      } catch (error: unknown) {
        return toolErrorResult("paint_shape_style_menu_debug", error);
      } finally {
        logToolFinished("paint_shape_style_menu_debug", outcome);
        notifyOperationFinished();
      }
    },
  );
}
