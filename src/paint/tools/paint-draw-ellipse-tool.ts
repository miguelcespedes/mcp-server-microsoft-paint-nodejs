import type { PaintController } from "../paint-controller.js";

export async function runPaintDrawEllipseTool(
  controller: PaintController,
  args: {
    x: number;
    y: number;
    width: number;
    height: number;
    durationMs: number;
    windowMode: "current" | "new";
  },
) {
  return controller.drawEllipse(
    {
      x: args.x,
      y: args.y,
      width: args.width,
      height: args.height,
    },
    args.durationMs,
    args.windowMode,
  );
}
