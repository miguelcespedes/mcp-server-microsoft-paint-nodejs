import { createLogger } from "../src/infrastructure/logging/logger.js";
import { createWin32PaintDriver } from "../src/infrastructure/win32/paint.js";
import { AutomationClient } from "../src/infrastructure/windows/automation/automation-client.js";
import { PaintSessionStore } from "../src/paint/session/paint-session.js";
import { PaintController } from "../src/paint/paint-controller.js";
import { circlePolyline, fitStrokes, boundingBox } from "../src/domain/figures.js";

const logger = createLogger();
const paint = createWin32PaintDriver();
const automationClient = new AutomationClient();
const sessionStore = new PaintSessionStore(logger);
const controller = new PaintController(sessionStore, automationClient, logger);

let win = await paint.createWindow();
console.log("Canvas:", win.canvas.logicalWidth, "x", win.canvas.logicalHeight);

const gen = { kind: "circle" as const, cx: 960, cy: 540, radius: 300, stepCount: 72 };
const points = circlePolyline(gen);
const fitted = fitStrokes(
  [points],
  { width: win.canvas.logicalWidth, height: win.canvas.logicalHeight, mode: "contain", margin: 0.05 },
);

const drawOptions = { stepDelayMs: 2, skipToolSelection: true };
const result = await win.drawPolyline(fitted[0], drawOptions);
console.log("Draw result:", result.pointCount, "points");
console.log("Canvas bounds:", result.canvasBounds);

console.log("Second draw to verify persistent bridge reuse...");
const result2 = await win.drawPolyline(fitted[0], drawOptions);
console.log("Draw result 2:", result2.pointCount, "points");

console.log("Inventory test...");
const inv = await controller.inventory({ maxDepth: 6, includeBoundingRectangles: true });
console.log("Inventory:", inv.success, "elements:", inv.elements.length);

await automationClient.shutdown();
console.log("All tests passed!");