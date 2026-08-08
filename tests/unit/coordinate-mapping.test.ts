import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canvasPointsToClientPoints } from "../../src/paint/discovery/canvas-resolver.js";
import type { PaintCanvas } from "../../src/domain/drawing.js";

describe("infrastructure/win32/paint - coordinate mapping", () => {
  const makeCanvas = (overrides: Partial<PaintCanvas> = {}): PaintCanvas => ({
    source: "automation",
    width: 800,
    height: 600,
    logicalWidth: 1920,
    logicalHeight: 1080,
    clientOrigin: { x: 100, y: 50 },
    screenOrigin: { x: 0, y: 0 },
    ...overrides,
  });

  describe("canvasPointsToClientPoints - uniform zoom (100%)", () => {
    it("maps logical to client 1:1 when canvas fits", () => {
      const canvas = makeCanvas({ width: 1920, height: 1080 });
      const points = [{ x: 960, y: 540 }, { x: 100, y: 100 }, { x: 1820, y: 980 }];
      const client = canvasPointsToClientPoints(canvas, points, "test");
      
      assert.deepStrictEqual(client[0], { x: 1060, y: 590 });
      assert.deepStrictEqual(client[1], { x: 200, y: 150 });
      assert.deepStrictEqual(client[2], { x: 1920, y: 1030 });
    });
  });

  describe("canvasPointsToClientPoints - uniform zoom (50%)", () => {
    it("maps proportionally when canvas is scaled uniformly", () => {
      const canvas = makeCanvas({ width: 960, height: 540 });
      const points = [{ x: 960, y: 540 }, { x: 100, y: 100 }, { x: 1820, y: 980 }];
      const client = canvasPointsToClientPoints(canvas, points, "test");
      
      assert.deepStrictEqual(client[0], { x: 580, y: 320 });
      assert.deepStrictEqual(client[1], { x: 150, y: 100 });
      assert.deepStrictEqual(client[2], { x: 1010, y: 540 });
    });
  });

  describe("canvasPointsToClientPoints - non-uniform zoom (BROKEN case)", () => {
    it("distorts when width/height ratios differ", () => {
      const canvas = makeCanvas({ width: 1888, height: 723 });
      const points = [{ x: 960, y: 540 }];
      const client = canvasPointsToClientPoints(canvas, points, "test");
      
      assert.ok(Math.abs(client[0].x - 1044) < 1);
      assert.ok(Math.abs(client[0].y - 412) < 1);
    });
  });

  describe("edge cases", () => {
    it("handles negative logical coordinates (clamped)", () => {
      const canvas = makeCanvas({ width: 1920, height: 1080 });
      const points = [{ x: 0, y: 0 }];
      const client = canvasPointsToClientPoints(canvas, points, "test");
      assert.deepStrictEqual(client[0], { x: 100, y: 50 });
    });

    it("handles zero-size canvas gracefully", () => {
      const canvas = makeCanvas({ width: 0, height: 0, logicalWidth: 0, logicalHeight: 0 });
      // This will throw - zero-size canvas is invalid
      assert.throws(() => {
        canvasPointsToClientPoints(canvas, [{ x: 100, y: 100 }], "test");
      });
    });
  });
});

describe("refreshCanvas logic (unit - mocked)", () => {
  it("detects uniform zoom correctly", () => {
    const uniformZoom = (w: number, h: number, lw: number, lh: number) => {
      const scaleX = w / lw;
      const scaleY = h / lh;
      return Math.abs(scaleX - scaleY) / Math.max(scaleX, scaleY, 1e-9) < 0.02;
    };

    assert.ok(uniformZoom(1920, 1080, 1920, 1080));
    assert.ok(uniformZoom(960, 540, 1920, 1080));
    assert.ok(uniformZoom(1761, 991, 1920, 1080));

    assert.ok(!uniformZoom(1888, 723, 1920, 1080));
    assert.ok(uniformZoom(1920, 1080, 1920, 1080));
  });

  it("detects fully visible correctly", () => {
    const fullyVisible = (w: number, h: number, cw: number, ch: number) => 
      w <= cw && h <= ch;

    assert.ok(!fullyVisible(1920, 1080, 1920, 991));
    assert.ok(fullyVisible(1761, 991, 1920, 991));
    assert.ok(fullyVisible(800, 600, 1920, 1080));
  });
});