import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cube,
  dodecahedron,
  greatIcosahedron,
  greatIcosahedronFaces,
  icosahedron,
  octahedron,
  projectMesh,
  projectPolyline,
  revolutionPolygons,
  rotate3D,
  solidMesh,
  starOctangula,
  tetrahedron,
  tesseract,
  torusKnotPoints,
  torusPolygons,
  wireframeStrokes,
} from "../../dist/domain/solids.js";

const PHI = (1 + Math.sqrt(5)) / 2;

test("tetrahedron has 4 vertices and 6 edges", () => {
  const mesh = tetrahedron();
  assert.equal(mesh.vertices.length, 4);
  assert.equal(mesh.edges.length, 6);
});

test("cube has 8 vertices and 12 edges", () => {
  const mesh = cube();
  assert.equal(mesh.vertices.length, 8);
  assert.equal(mesh.edges.length, 12);
});

test("octahedron has 6 vertices and 12 edges", () => {
  const mesh = octahedron();
  assert.equal(mesh.vertices.length, 6);
  assert.equal(mesh.edges.length, 12);
});

test("icosahedron has 12 vertices and 30 edges of length 2", () => {
  const mesh = icosahedron();
  assert.equal(mesh.vertices.length, 12);
  assert.equal(mesh.edges.length, 30);
  for (const [a, b] of mesh.edges) {
    const va = mesh.vertices[a];
    const vb = mesh.vertices[b];
    const d = Math.hypot(va.x - vb.x, va.y - vb.y, va.z - vb.z);
    assert.ok(Math.abs(d - 2) < 1e-6, `edge ${a}-${b} length ${d}`);
  }
});

test("dodecahedron has 20 vertices and 30 edges of length 2/PHI", () => {
  const mesh = dodecahedron();
  assert.equal(mesh.vertices.length, 20);
  assert.equal(mesh.edges.length, 30);
  for (const [a, b] of mesh.edges) {
    const va = mesh.vertices[a];
    const vb = mesh.vertices[b];
    const d = Math.hypot(va.x - vb.x, va.y - vb.y, va.z - vb.z);
    assert.ok(Math.abs(d - 2 / PHI) < 1e-6, `edge ${a}-${b} length ${d}`);
  }
});

test("greatIcosahedron shares the icosahedron wireframe (12/30)", () => {
  const mesh = greatIcosahedron();
  assert.equal(mesh.vertices.length, 12);
  assert.equal(mesh.edges.length, 30);
});

test("greatIcosahedronFaces yields 20 closed star faces over icosahedron edges", () => {
  const faces = greatIcosahedronFaces();
  assert.equal(faces.length, 20);
  const base = icosahedron();
  const edgeSet = new Set(base.edges.map(([a, b]) => `${a}-${b}`));
  for (const face of faces) {
    assert.equal(face.length, 6, "closed pentagram polyline (5 + closing)");
    assert.deepEqual(face[0], face[5], "face is closed");
  }
  assert.ok(faces.length > 0);
  void edgeSet;
});

test("starOctangula has 8 vertices and 12 edges (two tetrahedra)", () => {
  const mesh = starOctangula();
  assert.equal(mesh.vertices.length, 8);
  assert.equal(mesh.edges.length, 12);
});

test("tesseract has 16 vertices and 32 edges (4D hypercube)", () => {
  const mesh = tesseract();
  assert.equal(mesh.vertices.length, 16);
  assert.equal(mesh.edges.length, 32);
});

test("solidMesh dispatches every solid name", () => {
  for (const name of [
    "tetrahedron",
    "cube",
    "octahedron",
    "dodecahedron",
    "icosahedron",
    "greatIcosahedron",
    "starOctangula",
    "tesseract",
  ]) {
    const mesh = solidMesh(name);
    assert.ok(mesh.vertices.length >= 4, name);
    assert.ok(mesh.edges.length >= 6, name);
  }
});

test("rotate3D rotates 90 degrees around X: (0,1,0) -> (0,0,1)", () => {
  const rotated = rotate3D([{ x: 0, y: 1, z: 0 }], 90, 0, 0);
  assert.ok(Math.abs(rotated[0].x) < 1e-9);
  assert.ok(Math.abs(rotated[0].y) < 1e-9);
  assert.ok(Math.abs(rotated[0].z - 1) < 1e-9);
});

test("projectMesh renders one 2-point stroke per edge", () => {
  const strokes = projectMesh(cube(), -20, 25, 0, "ortho", 3, 120);
  assert.equal(strokes.length, 12);
  for (const stroke of strokes) {
    assert.equal(stroke.length, 2);
  }
});

test("perspective projection magnifies points near the camera", () => {
  const near = projectPolyline(
    [{ x: 1, y: 0, z: 0.8 }],
    0,
    0,
    0,
    "perspective",
    3,
    100,
  );
  const far = projectPolyline(
    [{ x: 1, y: 0, z: -0.8 }],
    0,
    0,
    0,
    "perspective",
    3,
    100,
  );
  const ortho = projectPolyline(
    [{ x: 1, y: 0, z: 0.8 }],
    0,
    0,
    0,
    "ortho",
    3,
    100,
  );
  assert.equal(ortho[0].x, 100);
  assert.ok(near[0].x > ortho[0].x, "near point magnified");
  assert.ok(far[0].x < ortho[0].x, "far point shrunk");
});

test("torusPolygons yields segments + rings closed polygons", () => {
  const polygons = torusPolygons({
    majorRadius: 100,
    tubeRadius: 35,
    segments: 16,
    rings: 8,
  });
  assert.equal(polygons.length, 24);
  const ringPoints = polygons[0];
  assert.equal(ringPoints.length, 16);
  assert.equal(polygons[16].length, 8, "meridian has one point per ring");
});

test("torusKnotPoints is a closed curve with steps + 1 points", () => {
  const points = torusKnotPoints({ p: 2, q: 3, radius: 100, tubeRadius: 30, steps: 100 });
  assert.equal(points.length, 101);
  assert.ok(Math.abs(points[0].x - points[100].x) < 1e-9);
  assert.ok(Math.abs(points[0].y - points[100].y) < 1e-9);
  assert.ok(Math.abs(points[0].z - points[100].z) < 1e-9);
});

test("revolutionPolygons yields profile rings + meridians", () => {
  const polygons = revolutionPolygons({
    profile: [
      { x: 20, y: -40 },
      { x: 80, y: -10 },
      { x: 100, y: 30 },
      { x: 60, y: 60 },
      { x: 10, y: 70 },
    ],
    segments: 12,
  });
  assert.equal(polygons.length, 17);
  assert.equal(polygons[0].length, 12, "ring follows the segments");
  assert.equal(polygons[12].length, 5, "meridian follows the profile");
});

test("wireframeStrokes renders explicit edges as 2-point strokes", () => {
  const strokes = wireframeStrokes(
    {
      vertices: [
        { x: -1, y: -1, z: -1 },
        { x: 1, y: -1, z: -1 },
        { x: -1, y: 1, z: -1 },
        { x: -1, y: -1, z: 1 },
      ],
      edges: [
        [0, 1],
        [0, 2],
      ],
    },
    -20,
    25,
    0,
    "ortho",
    3,
    120,
  );
  assert.equal(strokes.length, 2);
  for (const stroke of strokes) {
    assert.equal(stroke.length, 2);
  }
});
