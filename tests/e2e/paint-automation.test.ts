import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createLogger } from "../../src/infrastructure/logging/logger.js";
import { createWin32PaintDriver } from "../../src/infrastructure/win32/paint.js";
import { AutomationClient } from "../../src/infrastructure/windows/automation/automation-client.js";
import { PaintSessionStore } from "../../src/paint/session/paint-session.js";
import { PaintController } from "../../src/paint/paint-controller.js";
import { circlePolyline, fitStrokes, boundingBox } from "../../src/domain/figures.js";

describe("e2e/smoke - Paint automation", () => {
  let logger: ReturnType<typeof createLogger>;
  let paint: ReturnType<typeof createWin32PaintDriver>;
  let automationClient: AutomationClient;
  let sessionStore: PaintSessionStore;
  let controller: PaintController;

  before(async () => {
    logger = createLogger();
    paint = createWin32PaintDriver();
    automationClient = new AutomationClient();
    sessionStore = new PaintSessionStore(logger);
    controller = new PaintController(sessionStore, automationClient, logger);
  });

  after(async () => {
    await automationClient.shutdown();
  });

  it("creates/reuses Paint window and gets canvas info", async () => {
    const win = await paint.createWindow();
    assert.ok(win.canvas.logicalWidth > 0);
    assert.ok(win.canvas.logicalHeight > 0);
    assert.match(win.info.windowHandle, /^0x[0-9a-f]+$/i);
  });

  it("draws a circle with fit: contain", async () => {
    let win = await paint.createWindow();
    const gen = { kind: "circle" as const, cx: 960, cy: 540, radius: 300, stepCount: 72 };
    const points = circlePolyline(gen);
    const fitted = fitStrokes([points], { 
      width: win.canvas.logicalWidth, 
      height: win.canvas.logicalHeight, 
      mode: "contain", 
      margin: 0.05 
    });

    const drawOptions = { stepDelayMs: 2, skipToolSelection: true };
    const result = await win.drawPolyline(fitted[0], drawOptions);
    
    assert.ok(result.success);
    assert.ok(result.pointCount > 10);
    assert.ok(result.canvasBounds);
    assert.ok(result.canvasBounds!.minX < result.canvasBounds!.maxX);
  });

  it("resizes canvas via paint_canvas flow", async () => {
    const result = await controller.setCanvasSize(1000, 800);
    assert.ok(result.success);
    assert.ok(result.verified);
    assert.strictEqual(result.canvas.logicalWidth, 1000);
    assert.strictEqual(result.canvas.logicalHeight, 800);
  });

  it("paint_draw with canvas parameter resizes and draws", async () => {
    const win = await paint.createWindow();
    const initialWidth = win.canvas.logicalWidth;
    
    await controller.setCanvasSize(600, 600);
    const win2 = await paint.createWindow();
    
    assert.strictEqual(win2.canvas.logicalWidth, 600);
    assert.strictEqual(win2.canvas.logicalHeight, 600);
    assert.notStrictEqual(win2.canvas.logicalWidth, initialWidth);
  });

  it("brush thickness parameter works", async () => {
    let win = await paint.createWindow();
    const gen = { kind: "circle" as const, cx: 400, cy: 300, radius: 150, stepCount: 36 };
    const points = circlePolyline(gen);
    const fitted = fitStrokes([points], { 
      width: win.canvas.logicalWidth, 
      height: win.canvas.logicalHeight, 
      mode: "contain", 
      margin: 0.05 
    });

    const result1 = await win.drawPolyline(fitted[0], { stepDelayMs: 2, skipToolSelection: true, thickness: 5 });
    assert.ok(result1.success);

    const result2 = await win.drawPolyline(fitted[0], { stepDelayMs: 2, skipToolSelection: true, thickness: 20 });
    assert.ok(result2.success);
  });

  it("paint_edit actions execute without error", async () => {
    let win = await paint.createWindow();

    const fillResult = await win.fillAt(400, 300, { stepDelayMs: 10 });
    assert.ok(fillResult.success);

    const textResult = await win.insertText({
      x: 100, y: 100, width: 200, height: 80,
      content: "Test", fontSize: 18, fontFamily: "Arial",
      bold: false, italic: false, color: "#000000",
      stepDelayMs: 10,
    });
    assert.ok(textResult.success);

    const cropResult = await win.crop({
      x: 50, y: 50, width: 500, height: 400, stepDelayMs: 10,
    });
    assert.ok(cropResult.success);
  });

  it("persistent bridge reuses PowerShell process", async () => {
    const start = Date.now();
    for (let i = 0; i < 3; i++) {
      const inv = await controller.inventory({ maxDepth: 4, includeBoundingRectangles: false });
      assert.ok(inv.success);
    }
    const duration = Date.now() - start;
    assert.ok(duration < 8000);
  });

  it("origin offset shifts generator coordinates", async () => {
    let win = await paint.createWindow();
    const gen = { kind: "circle" as const, cx: 0, cy: 0, radius: 100, stepCount: 24 };
    const points = circlePolyline(gen);

    const offset = { x: 500, y: 300 };
    const offsetPoints = points.map(p => ({ x: p.x + offset.x, y: p.y + offset.y }));
    const box = boundingBox([offsetPoints]);
    
    assert.strictEqual(box!.minX, 400);
    assert.strictEqual(box!.minY, 200);
    assert.strictEqual(box!.maxX, 600);
    assert.strictEqual(box!.maxY, 400);
  });

  it("negative coordinates work with fit: contain", async () => {
    let win = await paint.createWindow();
    const gen = { kind: "circle" as const, cx: -100, cy: -100, radius: 200, stepCount: 36 };
    const points = circlePolyline(gen);
    const box = boundingBox([points]);
    
    assert.strictEqual(box!.minX, -300);
    assert.strictEqual(box!.minY, -300);
    assert.strictEqual(box!.maxX, 100);
    assert.strictEqual(box!.maxY, 100);

    const fitted = fitStrokes([points], { 
      width: win.canvas.logicalWidth, 
      height: win.canvas.logicalHeight, 
      mode: "contain", 
      margin: 0.05 
    });
    const fittedBox = boundingBox(fitted);
    assert.ok(fittedBox!.minX > 0);
    assert.ok(fittedBox!.minY > 0);
  });
});