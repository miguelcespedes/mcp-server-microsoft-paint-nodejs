import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canvasBoundsToClientDrag,
  ensureBoundsInsideCanvas,
  validateDurationMs,
} from "../../dist/paint/discovery/canvas-resolver.js";

const canvas = {
  bounds: { x: 100, y: 200, width: 800, height: 600 },
  clientOrigin: { x: 100, y: 200 },
  width: 800,
  height: 600,
  source: "fixed-layout",
};

test("ensureBoundsInsideCanvas accepts valid ellipse bounds", () => {
  assert.doesNotThrow(() =>
    ensureBoundsInsideCanvas(canvas, { x: 10, y: 20, width: 100, height: 80 }),
  );
});

test("ensureBoundsInsideCanvas rejects out-of-bounds ellipses", () => {
  assert.throws(
    () => ensureBoundsInsideCanvas(canvas, { x: 750, y: 20, width: 100, height: 80 }),
    /does not fit inside the Paint canvas/,
  );
});

test("canvasBoundsToClientDrag converts canvas-relative bounds", () => {
  const drag = canvasBoundsToClientDrag(canvas, {
    x: 10,
    y: 20,
    width: 100,
    height: 80,
  });
  assert.deepEqual(drag, {
    start: { x: 110, y: 220 },
    end: { x: 210, y: 300 },
  });
});

test("validateDurationMs enforces range", () => {
  assert.equal(validateDurationMs(600), 600);
  assert.throws(() => validateDurationMs(20), /between 50 and 5000/);
  assert.throws(() => validateDurationMs(6000), /between 50 and 5000/);
});
