/**
 * Integration test for the "Freehand Drawing" operation
 * (paint_draw_freehand): draws the logarithmic spiral (phase 240 deg) split
 * into 6 strokes, one per turn, each with its own mouse drag.
 *
 * IMPORTANTE: mueve el mouse REAL de la sesión de Windows. Requiere build:
 *   npm run build
 *   npm test
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient, spiralStrokesPerTurn } from "./helpers.mjs";

let client;

before(async () => {
  client = await createClient();
});

after(async () => {
  if (client) {
    await client.close();
  }
});

test("paint_draw_freehand draws the spiral in 6 strokes (phase 240 deg)", async () => {
  const result = await client.callTool({
    name: "paint_draw_freehand",
    arguments: {
      strokes: spiralStrokesPerTurn((4 * Math.PI) / 3),
      stepDelayMs: 8,
    },
  });
  const s = result.structuredContent;
  assert.equal(s.success, true);
  assert.equal(s.strokeCount, 6);
  assert.equal(s.totalPoints, 756);
});
