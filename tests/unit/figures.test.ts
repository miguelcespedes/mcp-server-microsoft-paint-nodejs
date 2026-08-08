import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { boundingBox, fitStrokes, circlePolyline, ellipsePolyline, rectanglePolyline } from "../../src/domain/figures.js";

describe("domain/figures - core geometry", () => {
  describe("boundingBox", () => {
    it("returns null for empty array", () => {
      assert.strictEqual(boundingBox([]), null);
    });

    it("computes correct bounds for single stroke", () => {
      const stroke = [{ x: 10, y: 20 }, { x: 50, y: 80 }, { x: 30, y: 40 }];
      const box = boundingBox([stroke]);
      assert.deepStrictEqual(box, { minX: 10, minY: 20, maxX: 50, maxY: 80 });
    });

    it("computes correct bounds for multiple strokes", () => {
      const strokes = [
        [{ x: 10, y: 10 }, { x: 20, y: 20 }],
        [{ x: 100, y: 50 }, { x: 120, y: 80 }],
      ];
      const box = boundingBox(strokes);
      assert.deepStrictEqual(box, { minX: 10, minY: 10, maxX: 120, maxY: 80 });
    });

    it("handles negative coordinates", () => {
      const stroke = [{ x: -100, y: -50 }, { x: 50, y: 80 }];
      const box = boundingBox([stroke]);
      assert.deepStrictEqual(box, { minX: -100, minY: -50, maxX: 50, maxY: 80 });
    });
  });

  describe("fitStrokes - contain mode", () => {
    it("scales and centers content to fit canvas", () => {
      // Content: 200x100 at origin (0,0 to 200,100)
      // Canvas: 400x400, scale = min(400/200, 400/100) = 2
      // Fitted: 400x200, centered vertically -> y: 100 to 300
      const strokes = [[{ x: 0, y: 0 }, { x: 200, y: 100 }]];
      const fitted = fitStrokes(strokes, { width: 400, height: 400, mode: "contain", margin: 0 });
      
      const box = boundingBox(fitted);
      assert.strictEqual(box!.minX, 0);
      assert.strictEqual(box!.minY, 100);
      assert.strictEqual(box!.maxX, 400);
      assert.strictEqual(box!.maxY, 300);
    });

    it("preserves aspect ratio in contain mode", () => {
      const strokes = [[{ x: 0, y: 0 }, { x: 200, y: 100 }]];
      const fitted = fitStrokes(strokes, { width: 400, height: 400, mode: "contain", margin: 0.1 });
      
      const box = boundingBox(fitted);
      const fittedAspect = (box!.maxX - box!.minX) / (box!.maxY - box!.minY);
      assert.ok(Math.abs(fittedAspect - 2) < 0.1);
    });

    it("respects margin", () => {
      const strokes = [[{ x: 0, y: 0 }, { x: 100, y: 100 }]];
      const fitted = fitStrokes(strokes, { width: 400, height: 400, mode: "contain", margin: 0.25 });
      
      const box = boundingBox(fitted);
      assert.ok(box!.minX >= 100);
      assert.ok(box!.maxX <= 300);
    });
  });

  describe("fitStrokes - fill mode", () => {
    it("stretches to fill canvas (ignores aspect ratio)", () => {
      const strokes = [[{ x: 0, y: 0 }, { x: 100, y: 100 }]];
      const fitted = fitStrokes(strokes, { width: 400, height: 200, mode: "fill", margin: 0 });
      
      const box = boundingBox(fitted);
      assert.strictEqual(box!.minX, 0);
      assert.strictEqual(box!.minY, 0);
      assert.strictEqual(box!.maxX, 400);
      assert.strictEqual(box!.maxY, 200);
    });
  });

  describe("fitStrokes - none mode (current behavior: still scales)", () => {
    it("scales like contain (current implementation)", () => {
      const strokes = [[{ x: 10, y: 20 }, { x: 50, y: 80 }]];
      const fitted = fitStrokes(strokes, { width: 400, height: 400, mode: "none" });
      // Currently "none" behaves like "contain" - it scales
      const box = boundingBox(fitted);
      assert.ok(box!.minX > 10); // scaled
      assert.ok(box!.minY >= 20); // scaled (minY == 20 in this case)
    });
  });

  describe("circlePolyline", () => {
    it("generates closed circle with stepCount points", () => {
      const points = circlePolyline({ cx: 100, cy: 100, radius: 50, stepCount: 12 });
      assert.strictEqual(points.length, 13);
      assert.deepStrictEqual(points[0], points[points.length - 1]);
    });

    it("points are at correct distance from center", () => {
      const points = circlePolyline({ cx: 0, cy: 0, radius: 10, stepCount: 4 });
      for (const p of points) {
        const dist = Math.hypot(p.x, p.y);
        assert.ok(Math.abs(dist - 10) < 0.5);
      }
    });
  });

  describe("ellipsePolyline", () => {
    it("generates ellipse with correct bounds", () => {
      const points = ellipsePolyline({ x: 0, y: 0, width: 200, height: 100, stepCount: 12 });
      const box = boundingBox([points]);
      assert.deepStrictEqual(box, { minX: 0, minY: 0, maxX: 200, maxY: 100 });
    });
  });

  describe("rectanglePolyline", () => {
    it("generates rectangle with correct corners", () => {
      const points = rectanglePolyline({ x: 10, y: 20, width: 100, height: 50 });
      const box = boundingBox([points]);
      assert.deepStrictEqual(box, { minX: 10, minY: 20, maxX: 110, maxY: 70 });
    });
  });
});

describe("domain/solids - 3D projection", () => {
  it("imports without error", async () => {
    const solids = await import("../../src/domain/solids.js");
    assert.ok(typeof solids.projectMesh === "function");
    assert.ok(typeof solids.solidMesh === "function");
  });
});