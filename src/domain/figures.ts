/**
 * FIGURAS del dominio: matemática pura, sin dependencias.
 *
 * Cada figura es una función pura que devuelve puntos del lienzo (coordenadas
 * relativas al origen del área de dibujo, ver README → "Layout de Paint").
 * Las operaciones MCP (src/infrastructure/mcp/) usan estas figuras y delegan
 * el dibujo al puerto PaintPort.
 */

import type { Point2D } from "./drawing.js";

export interface LogarithmicSpiralOptions {
  /** Factor de crecimiento: radio = scale * growth^theta. */
  growth: number;
  /** Número de vueltas completas. */
  turns: number;
  /** Incremento de ángulo por punto, en radianes. */
  angleStep: number;
  /** Escala inicial del radio (px). */
  scale: number;
  /** Centro de la espiral (px, relativo al lienzo). */
  center: Point2D;
}

/**
 * Genera los puntos de una espiral logarítmica (r = a·b^θ, θ en radianes),
 * desde el centro hacia afuera.
 */
export function logarithmicSpiral(
  options: LogarithmicSpiralOptions,
): Point2D[] {
  const { growth, turns, angleStep, scale, center } = options;
  const totalAngle = 2 * Math.PI * turns;
  const points: Point2D[] = [];
  for (let theta = 0; theta <= totalAngle + 1e-9; theta += angleStep) {
    const radius = scale * Math.pow(growth, theta);
    points.push({
      x: Math.round(center.x + radius * Math.cos(theta)),
      y: Math.round(center.y + radius * Math.sin(theta)),
    });
  }
  return points;
}

/** Radio máximo alcanzado por la espiral (para validar que quepa en el lienzo). */
export function spiralMaxRadius(options: LogarithmicSpiralOptions): number {
  const { growth, turns, scale } = options;
  return scale * Math.pow(growth, turns * 2 * Math.PI);
}
