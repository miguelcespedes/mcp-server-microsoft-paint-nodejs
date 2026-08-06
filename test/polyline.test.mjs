/**
 * Test de integración de la operación "Dibujar polilínea"
 * (paint_draw_polyline): dibuja la espiral logarítmica (fase 120°) con los
 * mismos parámetros de la herramienta de espiral, en un único arrastre.
 *
 * IMPORTANTE: mueve el mouse REAL de la sesión de Windows. Requiere build:
 *   npm run build
 *   npm test
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient, spiralPoints } from "./helpers.mjs";

let client;

before(async () => {
  client = await createClient();
});

after(async () => {
  if (client) {
    await client.close();
  }
});

test("paint_draw_polyline dibuja la misma espiral (fase 120°)", async () => {
  const result = await client.callTool({
    name: "paint_draw_polyline",
    arguments: { points: spiralPoints((2 * Math.PI) / 3), stepDelayMs: 8 },
  });
  const s = result.structuredContent;
  assert.equal(s.success, true);
  assert.equal(s.pointCount, 754);
  assert.ok(s.startScreen && s.endScreen);
});
