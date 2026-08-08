/**
 * "El codex de la servilleta": primitivos de sketch inspirados en
 * *The Back of the Napkin* de Dan Roam. Viven separados de figures.ts (que
 * tiene los primitivos genéricos: círculos, polígonos, espirales, grids) a
 * propósito, para no mezclar el vocabulario visual de negocio de Roam con
 * la geometría de propósito general.
 *
 * El libro organiza casi cualquier idea con la "regla 6×6": 6 preguntas
 * (quién/qué, cuánto, dónde, cuándo, cómo, por qué) mapeadas a 6 formas de
 * mostrarlas (retrato, gráfico, mapa, línea de tiempo, diagrama de flujo,
 * gráfico de causa-efecto). Ese mapeo es el que implementa este módulo: no
 * es una lista arbitraria de formas, es EL codex del libro.
 *
 * Igual que figures.ts: funciones puras, sin dependencias, que devuelven
 * puntos/strokes en coordenadas de lienzo. Se apoyan en los primitivos
 * genéricos existentes (circlePolyline, rectanglePolyline, starPolygon) por
 * composición en vez de reimplementar geometría básica.
 */

import type { Point2D } from "./drawing.js";
import { circlePolyline, rectanglePolyline, starPolygon } from "./figures.js";

function pt(x: number, y: number): Point2D {
  return { x: Math.round(x), y: Math.round(y) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Primitivos base: flecha y monigote. Roam los usa en casi todo el resto del
// codex (flujo, señalar, causa-efecto), así que se definen una sola vez.
// ─────────────────────────────────────────────────────────────────────────────

export interface ArrowOptions {
  from: Point2D;
  to: Point2D;
  /** Largo de las dos líneas de la punta, en px. Default: 12% del largo del eje (mín. 6). */
  headSize?: number;
}

/**
 * Flecha: un stroke para el eje (from → to) y dos strokes cortos para la
 * punta, en ángulo de 25° respecto al eje. No existía una punta de flecha
 * en el DSL de figuras genéricas — es central en el vocabulario de Roam
 * (señalar, conectar pasos de un proceso, mostrar causa→efecto).
 */
export function arrowPolyline(options: ArrowOptions): Point2D[][] {
  const { from, to } = options;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) {
    return [[from, to]];
  }
  const headSize = options.headSize ?? Math.max(6, length * 0.12);
  const angle = Math.atan2(dy, dx);
  const headAngle = (25 * Math.PI) / 180;

  const left = pt(
    to.x - headSize * Math.cos(angle - headAngle),
    to.y - headSize * Math.sin(angle - headAngle),
  );
  const right = pt(
    to.x - headSize * Math.cos(angle + headAngle),
    to.y - headSize * Math.sin(angle + headAngle),
  );

  return [
    [pt(from.x, from.y), pt(to.x, to.y)],
    [left, pt(to.x, to.y)],
    [right, pt(to.x, to.y)],
  ];
}

export type StickFigurePose = "standing" | "walking" | "pointing" | "sitting" | "thinking";

export interface StickFigureOptions {
  /** Centro horizontal de la figura. */
  x: number;
  /** Posición de los pies (nivel de suelo). */
  y: number;
  /** Radio de la cabeza, define la escala de toda la figura. Default: 20. */
  scale?: number;
  pose?: StickFigurePose;
}

/**
 * Monigote de palitos con proporciones fijas (cabeza = scale, torso y
 * piernas ≈ 2.5×scale, brazos ≈ 2×scale) para que toda figura generada
 * salga anatómicamente consistente, sin recalcular ángulos a mano cada vez.
 * Cada pose ajusta solo brazos/piernas sobre el mismo esqueleto base.
 */
export function stickFigure(options: StickFigureOptions): Point2D[][] {
  const { x, y, scale: R = 20, pose = "standing" } = options;
  const legLength = R * 2.5;
  const torsoLength = R * 2.5;
  const armLength = R * 2;

  const hipY = y - legLength;
  const shoulderY = hipY - torsoLength;
  const headCenterY = shoulderY - R;

  const strokes: Point2D[][] = [
    circlePolyline({ cx: x, cy: headCenterY, radius: R, stepCount: 24 }),
    [pt(x, shoulderY), pt(x, hipY)],
  ];

  // Piernas
  if (pose === "sitting") {
    const kneeY = hipY + legLength * 0.55;
    strokes.push(
      [pt(x, hipY), pt(x, kneeY), pt(x + legLength * 0.5, kneeY)],
      [pt(x, hipY), pt(x - legLength * 0.3, kneeY), pt(x - legLength * 0.3, y)],
    );
  } else if (pose === "walking") {
    strokes.push(
      [pt(x, hipY), pt(x + legLength * 0.5, y)],
      [pt(x, hipY), pt(x - legLength * 0.5, y - legLength * 0.15)],
    );
  } else {
    strokes.push(
      [pt(x, hipY), pt(x - R * 0.8, y)],
      [pt(x, hipY), pt(x + R * 0.8, y)],
    );
  }

  // Brazos
  if (pose === "pointing") {
    // Un solo brazo extendido señalando; se omite el otro a propósito
    // (estilo minimalista de Roam — un segundo brazo corto "colgando" cerca
    // del torso se lee visualmente como una marca suelta y desconectada).
    strokes.push(
      ...arrowPolyline({
        from: pt(x, shoulderY),
        to: pt(x + armLength * 1.4, shoulderY - R * 0.4),
        headSize: R * 0.5,
      }),
    );
  } else if (pose === "thinking") {
    strokes.push(
      [pt(x, shoulderY), pt(x + R * 0.6, shoulderY - R * 0.2), pt(x + R * 0.3, headCenterY + R * 0.5)],
      [pt(x, shoulderY), pt(x - R * 0.7, shoulderY + armLength * 0.8)],
    );
  } else if (pose === "walking") {
    strokes.push(
      [pt(x, shoulderY), pt(x - R * 0.9, shoulderY + armLength * 0.7)],
      [pt(x, shoulderY), pt(x + R * 0.9, shoulderY + armLength * 0.5)],
    );
  } else if (pose === "sitting") {
    strokes.push(
      [pt(x, shoulderY), pt(x - R * 0.7, hipY)],
      [pt(x, shoulderY), pt(x + R * 0.7, hipY)],
    );
  } else {
    strokes.push(
      [pt(x, shoulderY), pt(x - R * 0.9, shoulderY + armLength * 0.8)],
      [pt(x, shoulderY), pt(x + R * 0.9, shoulderY + armLength * 0.8)],
    );
  }

  return strokes;
}

// ─────────────────────────────────────────────────────────────────────────────
// El codex 6×6: una función por pregunta del libro.
// ─────────────────────────────────────────────────────────────────────────────

export interface PortraitOptions extends StickFigureOptions {}

/** Quién/qué: delega en stickFigure — el retrato del libro. */
export function portraitStrokes(options: PortraitOptions): Point2D[][] {
  return stickFigure(options);
}

export interface ChartOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Valores relativos de cada barra (se escalan al más alto = height). */
  values: number[];
  /** Fracción del ancho de barra usada como separación. Default: 0.3. */
  gap?: number;
}

/** Cuánto: eje en L + una barra por valor, escalada al máximo. */
export function chartStrokes(options: ChartOptions): Point2D[][] {
  const { x, y, width, height, values, gap = 0.3 } = options;
  const strokes: Point2D[][] = [
    // Eje en L: vertical (cantidad) + horizontal (categorías)
    [pt(x, y), pt(x, y + height), pt(x + width, y + height)],
  ];
  if (values.length === 0) {
    return strokes;
  }
  const maxValue = Math.max(...values, 1e-9);
  const slot = width / values.length;
  const barWidth = slot * (1 - gap);
  values.forEach((value, index) => {
    const barHeight = Math.max(0, (value / maxValue) * height);
    const barX = x + index * slot + (slot - barWidth) / 2;
    strokes.push(
      rectanglePolyline({
        x: Math.round(barX),
        y: Math.round(y + height - barHeight),
        width: Math.round(barWidth),
        height: Math.round(barHeight),
      }),
    );
  });
  return strokes;
}

export interface MapOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Marcadores dentro de la región, en coordenadas relativas [0,1]×[0,1]. */
  markers: Point2D[];
  /** Radio del marcador (estrella de 5 puntas). Default: min(width,height)*0.06. */
  markerRadius?: number;
}

/** Dónde: región (rectángulo) + un marcador (estrella) por punto de interés. */
export function mapStrokes(options: MapOptions): Point2D[][] {
  const { x, y, width, height, markers } = options;
  const markerRadius = options.markerRadius ?? Math.min(width, height) * 0.06;
  const strokes: Point2D[][] = [rectanglePolyline({ x, y, width, height })];
  for (const marker of markers) {
    strokes.push(
      starPolygon({
        cx: Math.round(x + marker.x * width),
        cy: Math.round(y + marker.y * height),
        outerRadius: Math.round(markerRadius),
        innerRadius: Math.round(markerRadius * 0.45),
        points: 5,
      }),
    );
  }
  return strokes;
}

export interface TimelineOptions {
  x: number;
  y: number;
  length: number;
  /** Número de eventos, espaciados uniformemente a lo largo de la línea. */
  events: number;
  /** Alto de cada marca de evento. Default: 14. */
  tickHeight?: number;
}

/** Cuándo: línea horizontal + una marca vertical por evento. */
export function timelineStrokes(options: TimelineOptions): Point2D[][] {
  const { x, y, length, events } = options;
  const tickHeight = options.tickHeight ?? 14;
  const strokes: Point2D[][] = [[pt(x, y), pt(x + length, y)]];
  if (events <= 0) {
    return strokes;
  }
  for (let i = 0; i < events; i += 1) {
    const eventX = events === 1 ? x + length / 2 : x + (length * i) / (events - 1);
    strokes.push([pt(eventX, y - tickHeight / 2), pt(eventX, y + tickHeight / 2)]);
  }
  return strokes;
}

export interface FlowOptions {
  x: number;
  y: number;
  boxWidth: number;
  boxHeight: number;
  /** Separación horizontal entre cajas. */
  gap: number;
  /** Número de pasos (cajas) en secuencia. */
  steps: number;
}

/** Cómo: N cajas en secuencia horizontal, conectadas por flechas. */
export function flowStrokes(options: FlowOptions): Point2D[][] {
  const { x, y, boxWidth, boxHeight, gap, steps } = options;
  const strokes: Point2D[][] = [];
  for (let i = 0; i < steps; i += 1) {
    const boxX = x + i * (boxWidth + gap);
    strokes.push(rectanglePolyline({ x: boxX, y, width: boxWidth, height: boxHeight }));
    if (i > 0) {
      const prevRight = x + (i - 1) * (boxWidth + gap) + boxWidth;
      strokes.push(
        ...arrowPolyline({
          from: pt(prevRight, y + boxHeight / 2),
          to: pt(boxX, y + boxHeight / 2),
        }),
      );
    }
  }
  return strokes;
}

export interface CauseEffectOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Dirección de la tendencia mostrada. Default: "up". */
  trend?: "up" | "down";
}

/** Por qué: dos ejes + una curva simple mostrando la tendencia (causa→efecto). */
export function causeEffectStrokes(options: CauseEffectOptions): Point2D[][] {
  const { x, y, width, height, trend = "up" } = options;
  const originY = y + height;
  const strokes: Point2D[][] = [
    ...arrowPolyline({ from: pt(x, originY), to: pt(x + width, originY) }), // eje X
    ...arrowPolyline({ from: pt(x, originY), to: pt(x, y) }), // eje Y
  ];
  const curvePoints: Point2D[] = [];
  const steps = 12;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const eased = t * t; // curva suave, no una línea recta
    const curveY = trend === "up" ? originY - eased * height * 0.85 : y + eased * height * 0.85;
    curvePoints.push(pt(x + t * width * 0.9, curveY));
  }
  strokes.push(curvePoints);
  return strokes;
}

// ─────────────────────────────────────────────────────────────────────────────
// Etiquetas de texto: Roam casi nunca dibuja una figura del codex sin su
// texto (una barra sin etiqueta, un mapa sin nombres, no comunican nada).
// Estas funciones son puras: calculan DÓNDE va cada etiqueta según la misma
// geometría que ya usan las funciones de arriba, pero no insertan texto —
// eso requiere la ventana de Paint (efecto de I/O), y vive en la capa MCP
// (paint-napkin.operation.ts), que llama a estas funciones y luego a
// window.insertText por cada ancla devuelta.
// ─────────────────────────────────────────────────────────────────────────────

export interface TextAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
  content: string;
}

/** Estima el tamaño del cuadro de texto a partir del contenido y el tamaño de fuente. */
function estimateTextBox(content: string, fontSize: number): { width: number; height: number } {
  return {
    width: Math.max(24, Math.round(content.length * fontSize * 0.62)),
    height: Math.round(fontSize * 1.6),
  };
}

/** Ancla centrada bajo los pies del monigote. */
export function portraitLabelAnchor(
  options: PortraitOptions,
  label: string,
  fontSize: number,
): TextAnchor {
  const { x, y } = options;
  const box = estimateTextBox(label, fontSize);
  return { x: Math.round(x - box.width / 2), y: y + 6, width: box.width, height: box.height, content: label };
}

/** Una ancla por barra, centrada justo debajo del eje horizontal. */
export function chartLabelAnchors(
  options: ChartOptions,
  labels: string[],
  fontSize: number,
): TextAnchor[] {
  const { x, y, width, height, values } = options;
  const slot = width / values.length;
  return labels.map((label, index) => {
    const barCenterX = x + index * slot + slot / 2;
    const box = estimateTextBox(label, fontSize);
    return {
      x: Math.round(barCenterX - box.width / 2),
      y: y + height + 4,
      width: box.width,
      height: box.height,
      content: label,
    };
  });
}

/** Una ancla por marcador, a la derecha del punto. */
export function mapLabelAnchors(
  options: MapOptions,
  labels: string[],
  fontSize: number,
): TextAnchor[] {
  const { x, y, width, height, markers } = options;
  const markerRadius = options.markerRadius ?? Math.min(width, height) * 0.06;
  return labels.map((label, index) => {
    const marker = markers[index];
    const box = estimateTextBox(label, fontSize);
    return {
      x: Math.round(x + marker.x * width + markerRadius + 4),
      y: Math.round(y + marker.y * height - box.height / 2),
      width: box.width,
      height: box.height,
      content: label,
    };
  });
}

/** Una ancla por evento, centrada arriba de cada marca. */
export function timelineLabelAnchors(
  options: TimelineOptions,
  labels: string[],
  fontSize: number,
): TextAnchor[] {
  const { x, y, length, events } = options;
  const tickHeight = options.tickHeight ?? 14;
  return labels.map((label, index) => {
    const eventX = events === 1 ? x + length / 2 : x + (length * index) / (events - 1);
    const box = estimateTextBox(label, fontSize);
    return {
      x: Math.round(eventX - box.width / 2),
      y: Math.round(y - tickHeight / 2 - box.height - 4),
      width: box.width,
      height: box.height,
      content: label,
    };
  });
}

/** Una ancla por caja, centrada dentro de cada una. */
export function flowLabelAnchors(
  options: FlowOptions,
  labels: string[],
  fontSize: number,
): TextAnchor[] {
  const { x, y, boxWidth, boxHeight, gap } = options;
  return labels.map((label, index) => {
    const boxX = x + index * (boxWidth + gap);
    const box = estimateTextBox(label, fontSize);
    return {
      x: Math.round(boxX + boxWidth / 2 - box.width / 2),
      y: Math.round(y + boxHeight / 2 - box.height / 2),
      width: box.width,
      height: box.height,
      content: label,
    };
  });
}

export interface CauseEffectLabels {
  xLabel?: string;
  yLabel?: string;
}

/** Anclas para los rótulos de los ejes X e Y (0, 1 o 2 anclas según cuáles se pidan). */
export function causeEffectLabelAnchors(
  options: CauseEffectOptions,
  labels: CauseEffectLabels,
  fontSize: number,
): TextAnchor[] {
  const { x, y, width, height } = options;
  const originY = y + height;
  const anchors: TextAnchor[] = [];
  if (labels.xLabel) {
    const box = estimateTextBox(labels.xLabel, fontSize);
    anchors.push({
      x: Math.round(x + width - box.width),
      y: Math.round(originY + 6),
      width: box.width,
      height: box.height,
      content: labels.xLabel,
    });
  }
  if (labels.yLabel) {
    const box = estimateTextBox(labels.yLabel, fontSize);
    anchors.push({
      x: Math.round(x - box.width / 2),
      y: Math.round(y - box.height - 4),
      width: box.width,
      height: box.height,
      content: labels.yLabel,
    });
  }
  return anchors;
}
