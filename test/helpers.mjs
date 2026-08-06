/**
 * Helpers compartidos por los tests de integración: arranque de un cliente
 * MCP contra el servidor (dist/server.js) y generadores de puntos.
 * Requiere `npm run build` previo.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export const CENTER = { x: 446, y: 361 };
export const GROWTH = 1.1;
export const TURNS = 6;
export const ANGLE_STEP = 0.05;
export const SCALE = 7;

/** Crea y conecta un cliente MCP contra dist/server.js. */
export async function createClient() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/server.js"],
    cwd: process.cwd(),
  });
  const client = new Client({ name: "paint-test", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

/** Logarithmic spiral points with an initial phase (rotation) in radians. */
export function spiralPoints(phaseRadians) {
  const points = [];
  const totalAngle = TURNS * 2 * Math.PI;
  for (
    let theta = phaseRadians;
    theta <= phaseRadians + totalAngle + 1e-9;
    theta += ANGLE_STEP
  ) {
    const radius = SCALE * Math.pow(GROWTH, theta);
    points.push({
      x: Math.round(CENTER.x + radius * Math.cos(theta)),
      y: Math.round(CENTER.y + radius * Math.sin(theta)),
    });
  }
  return points;
}

/** The spiral split into strokes (one per turn), with an initial phase. */
export function spiralStrokesPerTurn(phaseRadians) {
  const strokes = [];
  for (let k = 0; k < TURNS; k += 1) {
    const from = phaseRadians + k * 2 * Math.PI;
    const to = phaseRadians + (k + 1) * 2 * Math.PI;
    const points = [];
    for (let theta = from; theta <= to + 1e-9; theta += ANGLE_STEP) {
      const radius = SCALE * Math.pow(GROWTH, theta);
      points.push({
        x: Math.round(CENTER.x + radius * Math.cos(theta)),
        y: Math.round(CENTER.y + radius * Math.sin(theta)),
      });
    }
    strokes.push({ points });
  }
  return strokes;
}
