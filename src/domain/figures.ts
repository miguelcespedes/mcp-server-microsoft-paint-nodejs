/**
 * FIGURAS del dominio: matemática pura, sin dependencias.
 *
 * Cada figura es una función pura que devuelve puntos del lienzo (coordenadas
 * relativas al origen del área de dibujo, ver README → "Layout de Paint").
 * Las operaciones MCP (src/infrastructure/mcp/) usan estas figuras y delegan
 * el dibujo al puerto PaintPort.
 */

import type { BoundingBox, Point2D } from "./drawing.js";

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

// ─────────────────────────────────────────────────────────────────────────────
// Repetición: grids y mosaicos.
// "gridItems" repite una figura simple en una retícula rectangular (mosaico
// de círculos, rejilla de puntos, tableros...); "dotsAlongPath" distribuye
// círculos pequeños espaciados a lo largo de un sendero (los puntos de un
// laberinto de Pac-Man, caminos punteados...). Cada ítem es un stroke propio.
// ─────────────────────────────────────────────────────────────────────────────

/** Formas disponibles como ítem de una grid. */
export type GridItemShape = "circle" | "disk" | "rectangle" | "ellipse";

export interface GridOptions {
  /** Región superior-izquierda de la retícula. */
  x: number;
  y: number;
  /** Tamaño de la región que ocupa la retícula completa. */
  width: number;
  height: number;
  /** Número de columnas (ítems horizontales). */
  cols: number;
  /** Número de filas (ítems verticales). */
  rows: number;
  /** Forma de cada ítem: círculo (contorno), disco (relleno), rectángulo o elipse. */
  shape: GridItemShape;
  /** Radio del ítem (circle/disk). */
  radius?: number;
  /** Ancho del ítem (rectangle/ellipse). */
  itemWidth?: number;
  /** Alto del ítem (rectangle/ellipse). */
  itemHeight?: number;
  /** Resolución del contorno (circle/ellipse). */
  stepCount?: number;
}

function gridItemStrokes(
  cx: number,
  cy: number,
  options: GridOptions,
): Point2D[][] {
  const {
    shape,
    radius = 4,
    itemWidth = 20,
    itemHeight = 20,
    stepCount = 24,
  } = options;
  switch (shape) {
    case "circle":
      return [circlePolyline({ cx, cy, radius, stepCount })];
    case "disk":
      return diskStrokes({ cx, cy, radius });
    case "rectangle":
      return [
        rectanglePolyline({
          x: cx - Math.round(itemWidth / 2),
          y: cy - Math.round(itemHeight / 2),
          width: itemWidth,
          height: itemHeight,
        }),
      ];
    case "ellipse":
      return [
        ellipsePolyline({
          x: cx - Math.round(itemWidth / 2),
          y: cy - Math.round(itemHeight / 2),
          width: itemWidth,
          height: itemHeight,
          stepCount,
        }),
      ];
  }
}

/**
 * Repite una figura en una retícula de cols × rows centrada dentro de la
 * región [x, y, width, height]. Las formas de contorno (circle, rectangle,
 * ellipse) devuelven un stroke por ítem; los discos se expanden en varias
 * filas de relleno (una fila por stroke). Es el mecanismo para mosaicos de
 * círculos (puntos de un laberinto), rejillas de casillas (tableros), etc.
 */
export function gridItems(options: GridOptions): Point2D[][] {
  const { x, y, width, height, cols, rows } = options;
  if (cols <= 0 || rows <= 0 || width <= 0 || height <= 0) {
    return [];
  }
  const cellWidth = width / cols;
  const cellHeight = height / rows;
  const strokes: Point2D[][] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const cx = Math.round(x + cellWidth * (col + 0.5));
      const cy = Math.round(y + cellHeight * (row + 0.5));
      strokes.push(...gridItemStrokes(cx, cy, options));
    }
  }

  return strokes;
}

export interface PathDotsOptions {
  /** Sobre qué puntos del lienzo (2–1000). */
  path: Point2D[];
  /** Radio de cada círculo. */
  radius: number;
  /** Distancia entre centros de círculos consecutivos a lo largo del sendero. */
  spacing: number;
  /** Resolución del contorno de cada círculo. */
  stepCount?: number;
}

/**
 * Distribuye círculos pequeños a intervalos regulares a lo largo de un
 * sendero polilínea (corredores de Pac-Man, caminos punteados). El primer
 * círculo cae a `spacing` px del inicio del sendero. Un círculo por stroke.
 */
export function dotsAlongPath(options: PathDotsOptions): Point2D[][] {
  const { path, radius, spacing, stepCount = 24 } = options;
  if (path.length < 2 || spacing <= 0 || radius <= 0) {
    return [];
  }
  const strokes: Point2D[][] = [];
  let cursor = path[0];
  let remaining = spacing;

  for (let i = 1; i < path.length; i += 1) {
    const next = path[i];
    let dx = next.x - cursor.x;
    let dy = next.y - cursor.y;
    let segmentLength = Math.hypot(dx, dy);
    if (segmentLength === 0) {
      continue;
    }
    while (remaining <= segmentLength) {
      const t = remaining / segmentLength;
      const centerX = cursor.x + dx * t;
      const centerY = cursor.y + dy * t;
      strokes.push(
        circlePolyline({
          cx: Math.round(centerX),
          cy: Math.round(centerY),
          radius,
          stepCount,
        }),
      );
      segmentLength -= remaining;
      cursor = { x: centerX, y: centerY };
      dx = next.x - cursor.x;
      dy = next.y - cursor.y;
      remaining = spacing;
    }
    remaining -= segmentLength;
    cursor = next;
  }

  return strokes;
}

// ─────────────────────────────────────────────────────────────────────────────
// Transformaciones y composición: matemática pura para escenas.
// Las figuras se definen en el origen (o en coordenadas locales) y se
// componen con translate/rotate/scale/placeAt; el agente no necesita
// calcular coordenadas absolutas a mano.
// ─────────────────────────────────────────────────────────────────────────────

/** Traslada los puntos por (dx, dy). */
export function translatePoints(
  points: Point2D[],
  dx: number,
  dy: number,
): Point2D[] {
  return points.map((point) => ({
    x: Math.round(point.x + dx),
    y: Math.round(point.y + dy),
  }));
}

/** Escala los puntos alrededor del origen. */
export function scalePoints(
  points: Point2D[],
  sx: number,
  sy: number,
): Point2D[] {
  return points.map((point) => ({
    x: Math.round(point.x * sx),
    y: Math.round(point.y * sy),
  }));
}

/** Rota los puntos alrededor de un centro (por defecto el origen). */
export function rotatePoints(
  points: Point2D[],
  angleDeg: number,
  center: Point2D = { x: 0, y: 0 },
): Point2D[] {
  const angleRad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  return points.map((point) => {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    return {
      x: Math.round(center.x + dx * cos - dy * sin),
      y: Math.round(center.y + dx * sin + dy * cos),
    };
  });
}

export interface PlaceOptions {
  /** Ángulo en grados respecto al centro (0° = derecha, en sentido horario). */
  angleDeg: number;
  /** Distancia desde el centro. */
  radius: number;
  /** Centro de la composición. */
  center: Point2D;
}

/**
 * Coloca una figura definida en el origen sobre un punto de una órbita
 * circular: rota la figura `angleDeg` y la traslada a `center + radius`.
 * Es el mecanismo para componer escenas (p. ej. planetas sobre órbitas).
 */
export function placePoints(
  points: Point2D[],
  options: PlaceOptions,
): Point2D[] {
  const { angleDeg, radius, center } = options;
  const angleRad = (angleDeg * Math.PI) / 180;
  return translatePoints(
    rotatePoints(points, angleDeg),
    center.x + radius * Math.cos(angleRad),
    center.y + radius * Math.sin(angleRad),
  );
}

/** Caja envolvente de todos los strokes en coordenadas de lienzo. */
export function boundingBox(strokes: Point2D[][]): BoundingBox | null {
  if (strokes.length === 0) {
    return null;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const stroke of strokes) {
    for (const point of stroke) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }
  return { minX, minY, maxX, maxY };
}

export interface FitOptions {
  /** Ancho objetivo (lienzo lógico). */
  width: number;
  /** Alto objetivo (lienzo lógico). */
  height: number;
  /**
   * "contain": escala preservando proporción y centra.
   * "fill": estira hasta ocupar el lienzo (no preserva proporción).
   */
  mode: "contain" | "fill";
  /** Margen libre alrededor del dibujo, como fracción del lienzo (0–0.49). */
  margin?: number;
}

/**
 * Ajusta uno o más strokes para que quepan dentro del área objetivo:
 * calcula el bounding box conjunto, escala (contain o fill) y centra.
 * Permite dibujar en un espacio de diseño propio sin conocer el lienzo.
 */
export function fitStrokes(
  strokes: Point2D[][],
  options: FitOptions,
): Point2D[][] {
  const { width, height, mode, margin = 0.05 } = options;
  const box = boundingBox(strokes);
  if (box === null || width <= 0 || height <= 0) {
    return strokes;
  }
  const contentWidth = box.maxX - box.minX;
  const contentHeight = box.maxY - box.minY;
  if (contentWidth === 0 && contentHeight === 0) {
    return strokes;
  }
  const availableWidth = width * (1 - 2 * Math.min(Math.max(margin, 0), 0.49));
  const availableHeight = height * (1 - 2 * Math.min(Math.max(margin, 0), 0.49));

  const sx = mode === "fill"
    ? availableWidth / contentWidth
    : Math.min(availableWidth / contentWidth, availableHeight / contentHeight);
  const sy = mode === "fill"
    ? availableHeight / contentHeight
    : sx;

  const scaledWidth = contentWidth * sx;
  const scaledHeight = contentHeight * sy;
  const dx = (width - scaledWidth) / 2 - box.minX * sx;
  const dy = (height - scaledHeight) / 2 - box.minY * sy;

  return strokes.map((stroke) =>
    stroke.map((point) => ({
      x: Math.round(point.x * sx + dx),
      y: Math.round(point.y * sy + dy),
    })),
  );
}
