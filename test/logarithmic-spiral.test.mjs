/**
 * Integration test for the "Logarithmic Spiral" operation
 * (paint_draw_logarithmic_spiral, phase 0 deg): takes no arguments and draws
 * the spiral r = 7·1.1^θ (6 turns) with the tool's fixed parameters.
 *
 * IMPORTANTE: mueve el mouse REAL de la sesión de Windows. Requiere build:
 *   npm run build
 *   npm test
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "./helpers.mjs";

let client;

before(async () => {
  client = await createClient();
});

after(async () => {
  if (client) {
    await client.close();
  }
});

test("paint_draw_logarithmic_spiral draws the spiral (phase 0 deg)", async () => {
  const result = await client.callTool({
    name: "paint_draw_logarithmic_spiral",
    arguments: {},
  });
  const s = result.structuredContent;
  assert.equal(s.success, true);
  assert.equal(s.pointCount, 754);
  assert.ok(["opened", "launched", "shell"].includes(s.createdBy));
  assert.ok(s.windowTitle.length > 0);
});
