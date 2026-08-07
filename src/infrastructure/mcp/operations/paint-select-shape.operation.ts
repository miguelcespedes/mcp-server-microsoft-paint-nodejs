import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PaintController } from "../../../paint/paint-controller.js";
import { notifyOperationFinished } from "../../win32/process.js";
import { runPaintSelectShapeTool } from "../../../paint/tools/paint-select-shape-tool.js";
import { toolErrorResult } from "../errors.js";
import { logToolFinished, logToolStarted } from "../tool-logging.js";
import { shapeNameSchema, windowModeSchema } from "../schemas.js";

export function registerPaintSelectShape(
  server: McpServer,
  controller: PaintController,
): void {
  server.registerTool(
    "paint_select_shape",
    {
      title: "Select Paint Shape",
      description:
        "Resolves a native Paint shape tool semantically through UI Automation " +
        "and invokes it without relying on hardcoded toolbar coordinates.",
      inputSchema: {
        shape: shapeNameSchema.default("ellipse"),
        windowMode: windowModeSchema,
      },
    },
    async (args) => {
      logToolStarted("paint_select_shape", args);
      let outcome: "success" | "error" = "error";
      try {
        const result = await runPaintSelectShapeTool(controller, args);
        return {
          content: [
            {
              type: "text",
              text:
                `Shape ${result.shape} selected using ${result.discovery.strategy}.`,
            },
          ],
          structuredContent: result,
        };
        outcome = "success";
        return response;
      } catch (error: unknown) {
        return toolErrorResult("paint_select_shape", error);
      } finally {
        logToolFinished("paint_select_shape", outcome);
        notifyOperationFinished();
      }
    },
  );
}
