/**
 * Test de integración de la operación "Espiral Logarítmica"
 * (paint_draw_espiral_logaritmica, fase 0°): no recibe argumentos y dibuja
 * la espiral r = 7·1.1^θ (6 vueltas) con los parámetros fijos de la
 * herramienta.
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

test("paint_draw_espiral_logaritmica dibuja la espiral (fase 0°)", async () => {
  const result = await client.callTool({
    name: "paint_draw_espiral_logaritmica",
    arguments: {},
  });
  const s = result.structuredContent;
  assert.equal(s.success, true);
  assert.equal(s.pointCount, 754);
  assert.ok(["opened", "launched", "shell"].includes(s.createdBy));
  assert.ok(s.windowTitle.length > 0);
});
