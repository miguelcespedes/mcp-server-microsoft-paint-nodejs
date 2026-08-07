import type { PaintController } from "../paint-controller.js";

export async function runPaintSelectShapeTool(
  controller: PaintController,
  args: { shape: string; windowMode: "current" | "new" },
) {
  return controller.selectShape(args.shape, args.windowMode);
}
