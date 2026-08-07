import type { PaintController } from "../paint-controller.js";

export async function runPaintInventoryTool(
  controller: PaintController,
  args: {
    maxDepth: number;
    includeBoundingRectangles: boolean;
    filter?: string;
    windowMode: "current" | "new";
  },
) {
  return controller.inventory(args, true, args.windowMode);
}
