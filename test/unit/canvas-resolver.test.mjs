import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canvasPointsToClientPoints,
  ensurePointsInsideCanvas,
} from "../../dist/paint/discovery/canvas-resolver.js";

const canvas = {
  bounds: { x: 100, y: 200, width: 800, height: 600 },
  clientOrigin: { x: 100, y: 200 },
  width: 800,
  height: 600,
  logicalWidth: 800,
  logicalHeight: 600,
  source: "fixed-layout",
};

test("ensurePointsInsideCanvas accepts valid points", () => {
  assert.doesNotThrow(() =>
    ensurePointsInsideCanvas(canvas, [{ x: 10, y: 20 }, { x: 799, y: 599 }], "points"),
  );
});

test("ensurePointsInsideCanvas rejects out-of-bounds points", () => {
  assert.throws(
    () => ensurePointsInsideCanvas(canvas, [{ x: 750, y: 20 }, { x: 800, y: 20 }], "points"),
    /outside the resolved Paint canvas/,
  );
});

test("ensurePointsInsideCanvas rejects negative coordinates", () => {
  assert.throws(
    () => ensurePointsInsideCanvas(canvas, [{ x: -1, y: 20 }], "points"),
    /outside the resolved Paint canvas/,
  );
});

test("canvasPointsToClientPoints converts canvas-relative points", () => {
  const points = canvasPointsToClientPoints(canvas, [{ x: 10, y: 20 }], "points");
  assert.deepEqual(points, [{ x: 110, y: 220 }]);
});

test("canvasPointsToClientPoints applies the drawable inset", () => {
  const insetCanvas = {
    ...canvas,
    drawableInset: { x: 8, y: 8 },
  };
  const points = canvasPointsToClientPoints(
    insetCanvas,
    [{ x: 0, y: 0 }, { x: 799, y: 599 }],
    "points",
  );
  assert.deepEqual(points, [
    { x: 108, y: 208 },
    { x: 891, y: 791 },
  ]);
});
