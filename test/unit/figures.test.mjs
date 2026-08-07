import { test } from "node:test";
import assert from "node:assert/strict";
import {
  boundingBox,
  dotsAlongPath,
  fitStrokes,
  gridItems,
  placePoints,
  rotatePoints,
  scalePoints,
  translatePoints,
} from "../../dist/domain/figures.js";

const square = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

test("translatePoints shifts every point", () => {
  assert.deepEqual(translatePoints(square, 5, -3), [
    { x: 5, y: -3 },
    { x: 15, y: -3 },
    { x: 15, y: 7 },
    { x: 5, y: 7 },
  ]);
});

test("scalePoints scales around the origin", () => {
  assert.deepEqual(scalePoints(square, 2, 0.5), [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 5 },
    { x: 0, y: 5 },
  ]);
});

test("rotatePoints rotates 90 degrees around the origin", () => {
  assert.deepEqual(rotatePoints(square, 90), [
    { x: 0, y: 0 },
    { x: 0, y: 10 },
    { x: -10, y: 10 },
    { x: -10, y: 0 },
  ]);
});

test("placePoints puts a local figure on an orbit position", () => {
  const planet = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 4 },
    { x: 0, y: 4 },
  ];
  const placed = placePoints(planet, {
    angleDeg: 0,
    radius: 50,
    center: { x: 100, y: 100 },
  });
  assert.deepEqual(placed, [
    { x: 150, y: 100 },
    { x: 154, y: 100 },
    { x: 154, y: 104 },
    { x: 150, y: 104 },
  ]);
});

test("boundingBox returns the joint bounds of all strokes", () => {
  assert.deepEqual(
    boundingBox([square, [{ x: 20, y: -5 }]]),
    { minX: 0, minY: -5, maxX: 20, maxY: 10 },
  );
  assert.equal(boundingBox([]), null);
});

test("fitStrokes contain centers the drawing preserving aspect ratio", () => {
  const fitted = fitStrokes([square], { width: 100, height: 100, mode: "contain", margin: 0 });
  assert.deepEqual(fitted, [
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ],
  ]);
});

test("fitStrokes contain preserves aspect on non-square canvas", () => {
  const fitted = fitStrokes([square], { width: 200, height: 100, mode: "contain", margin: 0 });
  assert.deepEqual(fitted, [
    [
      { x: 50, y: 0 },
      { x: 150, y: 0 },
      { x: 150, y: 100 },
      { x: 50, y: 100 },
    ],
  ]);
});

test("fitStrokes fill stretches to the whole canvas", () => {
  const fitted = fitStrokes([square], { width: 200, height: 100, mode: "fill", margin: 0 });
  assert.deepEqual(fitted, [
    [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 100 },
      { x: 0, y: 100 },
    ],
  ]);
});

test("fitStrokes respects the margin", () => {
  const fitted = fitStrokes([square], {
    width: 100,
    height: 100,
    mode: "contain",
    margin: 0.25,
  });
  assert.deepEqual(fitted, [
    [
      { x: 25, y: 25 },
      { x: 75, y: 25 },
      { x: 75, y: 75 },
      { x: 25, y: 75 },
    ],
  ]);
});

test("gridItems places one stroke per cell, centered in each cell", () => {
  const strokes = gridItems({
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    cols: 2,
    rows: 2,
    shape: "circle",
    radius: 4,
  });
  assert.equal(strokes.length, 4);
  const centers = strokes.map((stroke) => {
    const box = boundingBox([stroke]);
    return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
  });
  assert.deepEqual(centers, [
    { x: 25, y: 25 },
    { x: 75, y: 25 },
    { x: 25, y: 75 },
    { x: 75, y: 75 },
  ]);
  const box = boundingBox(strokes);
  assert.deepEqual(box, { minX: 21, minY: 21, maxX: 79, maxY: 79 });
});

test("gridItems fills a disk mosaic across the whole region", () => {
  const strokes = gridItems({
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    cols: 4,
    rows: 2,
    shape: "disk",
    radius: 5,
  });
  assert.ok(strokes.length > 8, "each disk expands to multiple fill rows");
  const box = boundingBox(strokes);
  assert.deepEqual(box, { minX: 20, minY: 20, maxX: 180, maxY: 78 });
});

test("gridItems with rectangle shape centers boxes in cells", () => {
  const strokes = gridItems({
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    cols: 2,
    rows: 1,
    shape: "rectangle",
    itemWidth: 10,
    itemHeight: 20,
  });
  assert.equal(strokes.length, 2);
  const box = boundingBox(strokes);
  assert.deepEqual(box, { minX: 20, minY: 15, maxX: 80, maxY: 35 });
});

test("dotsAlongPath spaces dots evenly along a straight path", () => {
  const strokes = dotsAlongPath({
    path: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
    radius: 2,
    spacing: 20,
  });
  assert.equal(strokes.length, 5);
  const centers = strokes.map((stroke) => {
    const box = boundingBox([stroke]);
    return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
  });
  assert.deepEqual(centers, [
    { x: 20, y: 0 },
    { x: 40, y: 0 },
    { x: 60, y: 0 },
    { x: 80, y: 0 },
    { x: 100, y: 0 },
  ]);
});

test("dotsAlongPath follows corners of a polyline path", () => {
  const strokes = dotsAlongPath({
    path: [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 50 },
    ],
    radius: 2,
    spacing: 25,
  });
  const centers = strokes.map((stroke) => {
    const box = boundingBox([stroke]);
    return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
  });
  assert.deepEqual(centers, [
    { x: 25, y: 0 },
    { x: 50, y: 0 },
    { x: 50, y: 25 },
    { x: 50, y: 50 },
  ]);
});

test("dotsAlongPath returns no dots for degenerate paths", () => {
  assert.deepEqual(dotsAlongPath({ path: [{ x: 0, y: 0 }], radius: 2, spacing: 10 }), []);
});
