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

export interface EllipseGeneratorOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  stepCount?: number;
}

export function ellipsePolyline(
  options: EllipseGeneratorOptions,
): Point2D[] {
  const { x, y, width, height, stepCount = 72 } = options;
  const cx = x + width / 2;
  const cy = y + height / 2;
  const rx = width / 2;
  const ry = height / 2;
  const points: Point2D[] = [];

  for (let i = 0; i <= stepCount; i += 1) {
    const theta = (i / stepCount) * Math.PI * 2;
    points.push({
      x: Math.round(cx + rx * Math.cos(theta)),
      y: Math.round(cy + ry * Math.sin(theta)),
    });
  }

  return points;
}

export interface CircleGeneratorOptions {
  cx: number;
  cy: number;
  radius: number;
  stepCount?: number;
}

export function circlePolyline(
  options: CircleGeneratorOptions,
): Point2D[] {
  const { cx, cy, radius, stepCount = 72 } = options;
  return ellipsePolyline({
    x: cx - radius,
    y: cy - radius,
    width: radius * 2,
    height: radius * 2,
    stepCount,
  });
}

export interface DiskGeneratorOptions {
  cx: number;
  cy: number;
  radius: number;
  rowStep?: number;
}

export function diskStrokes(
  options: DiskGeneratorOptions,
): Point2D[][] {
  const { cx, cy, radius, rowStep = 4 } = options;
  const strokes: Point2D[][] = [];

  for (let dy = -radius; dy <= radius; dy += rowStep) {
    const dx = Math.sqrt(Math.max(0, radius * radius - dy * dy));
    strokes.push([
      { x: Math.round(cx - dx), y: Math.round(cy + dy) },
      { x: Math.round(cx + dx), y: Math.round(cy + dy) },
    ]);
  }

  return strokes;
}

export interface ArcGeneratorOptions {
  cx: number;
  cy: number;
  radius: number;
  startDeg: number;
  endDeg: number;
  stepDeg?: number;
}

export function arcPolyline(
  options: ArcGeneratorOptions,
): Point2D[] {
  const { cx, cy, radius, startDeg, endDeg, stepDeg = 4 } = options;
  const startRad = (startDeg * Math.PI) / 180;
  const endRad = (endDeg * Math.PI) / 180;
  const delta = endRad - startRad;
  const steps = Math.max(2, Math.ceil(Math.abs(endDeg - startDeg) / stepDeg));
  const points: Point2D[] = [];

  for (let i = 0; i <= steps; i += 1) {
    const theta = startRad + (delta * i) / steps;
    points.push({
      x: Math.round(cx + radius * Math.cos(theta)),
      y: Math.round(cy + radius * Math.sin(theta)),
    });
  }

  return points;
}

export interface RectangleGeneratorOptions {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function rectanglePolyline(
  options: RectangleGeneratorOptions,
): Point2D[] {
  const { x, y, width, height } = options;
  return [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
    { x, y },
  ];
}

export interface RoundedRectangleGeneratorOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  stepDeg?: number;
}

export function roundedRectanglePolyline(
  options: RoundedRectangleGeneratorOptions,
): Point2D[] {
  const { x, y, width, height, radius, stepDeg = 12 } = options;
  const r = Math.min(radius, Math.floor(Math.min(width, height) / 2));
  const points: Point2D[] = [];

  points.push({ x: x + r, y });
  points.push({ x: x + width - r, y });
  points.push(...arcPolyline({ cx: x + width - r, cy: y + r, radius: r, startDeg: -90, endDeg: 0, stepDeg }).slice(1));
  points.push({ x: x + width, y: y + height - r });
  points.push(...arcPolyline({ cx: x + width - r, cy: y + height - r, radius: r, startDeg: 0, endDeg: 90, stepDeg }).slice(1));
  points.push({ x: x + r, y: y + height });
  points.push(...arcPolyline({ cx: x + r, cy: y + height - r, radius: r, startDeg: 90, endDeg: 180, stepDeg }).slice(1));
  points.push({ x, y: y + r });
  points.push(...arcPolyline({ cx: x + r, cy: y + r, radius: r, startDeg: 180, endDeg: 270, stepDeg }).slice(1));

  return points;
}

export interface RegularPolygonOptions {
  cx: number;
  cy: number;
  radius: number;
  sides: number;
  rotationDeg?: number;
}

export function regularPolygon(
  options: RegularPolygonOptions,
): Point2D[] {
  const { cx, cy, radius, sides, rotationDeg = -90 } = options;
  const rotationRad = (rotationDeg * Math.PI) / 180;
  const points: Point2D[] = [];

  for (let i = 0; i <= sides; i += 1) {
    const theta = rotationRad + ((i % sides) * Math.PI * 2) / sides;
    points.push({
      x: Math.round(cx + radius * Math.cos(theta)),
      y: Math.round(cy + radius * Math.sin(theta)),
    });
  }

  return points;
}

export interface StarPolygonOptions {
  cx: number;
  cy: number;
  outerRadius: number;
  innerRadius: number;
  points: number;
  rotationDeg?: number;
}

export function starPolygon(
  options: StarPolygonOptions,
): Point2D[] {
  const {
    cx,
    cy,
    outerRadius,
    innerRadius,
    points,
    rotationDeg = -90,
  } = options;
  const rotationRad = (rotationDeg * Math.PI) / 180;
  const result: Point2D[] = [];
  const vertices = points * 2;

  for (let i = 0; i <= vertices; i += 1) {
    const theta = rotationRad + ((i % vertices) * Math.PI) / points;
    const radius = i % 2 === 0 ? outerRadius : innerRadius;
    result.push({
      x: Math.round(cx + radius * Math.cos(theta)),
      y: Math.round(cy + radius * Math.sin(theta)),
    });
  }

  return result;
}
