/**
 * Test de integración de la operación "Dibujo Libre"
 * (paint_draw_libre): dibuja la espiral logarítmica (fase 240°) dividida en
 * 6 trazos, uno por vuelta, cada uno con su propio arrastre del mouse.
 *
 * IMPORTANTE: mueve el mouse REAL de la sesión de Windows. Requiere build:
 *   npm run build
 *   npm test
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient, spiralStrokesPerVuelta } from "./helpers.mjs";

let client;

before(async () => {
  client = await createClient();
});

after(async () => {
  if (client) {
    await client.close();
  }
});

test("paint_draw_libre dibuja la espiral en 6 trazos (fase 240°)", async () => {
  const result = await client.callTool({
    name: "paint_draw_libre",
    arguments: {
      trazos: spiralStrokesPerVuelta((4 * Math.PI) / 3),
      stepDelayMs: 8,
    },
  });
  const s = result.structuredContent;
  assert.equal(s.success, true);
  assert.equal(s.strokeCount, 6);
  assert.equal(s.totalPoints, 756);
});
