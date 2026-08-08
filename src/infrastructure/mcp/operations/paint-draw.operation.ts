import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PaintPort } from "../../../domain/drawing.js";
import type { PaintController } from "../../../paint/paint-controller.js";
import {
  arcPolyline,
  circlePolyline,
  diskStrokes,
  dotsAlongPath,
  ellipsePolyline,
  gridItems,
  logarithmicSpiral,
  rectanglePolyline,
  regularPolygon,
  roundedRectanglePolyline,
  starPolygon,
} from "../../../domain/figures.js";
import { notifyOperationFinished } from "../../win32/process.js";
import { toolErrorResult } from "../errors.js";
import { logToolFinished, logToolStarted } from "../tool-logging.js";
import {
  canvasSizeSchema,
  ellipseHeightSchema,
  ellipseWidthSchema,
  ellipseXSchema,
  ellipseYSchema,
  fitSchema,
  pointSchema,
  relativeIntSchema,
  stepDelayMsSchema,
  thicknessSchema,
  toolSchema,
  verifySchema,
} from "../schemas.js";
import type { Point2D } from "../../../domain/drawing.js";
import {
  annotateStrokeProvenanceError,
  autoResizeCanvasForAspect,
  buildStrokesWithProvenance,
  fitStrokesToCanvas,
  formatCanvasBounds,
  resizeCanvasIfRequested,
  verificationMessage,
  verifyDrawnRegion,
  type StrokeProvenanceEntry,
} from "./draw-shared.js";

const drawModeSchema = z.enum(["freehand", "generator"]);

const generatorSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ellipse"),
    x: ellipseXSchema,
    y: ellipseYSchema,
    width: ellipseWidthSchema,
    height: ellipseHeightSchema,
    stepCount: z
      .number()
      .int()
      .min(12)
      .max(360)
      .default(72)
      .describe("Número de segmentos (pasos) para aproximar la elipse. Default: 72."),
  }),
  z.object({
    kind: z.literal("circle"),
    cx: relativeIntSchema("Center X"),
    cy: relativeIntSchema("Center Y"),
    radius: z
      .number()
      .int()
      .min(1)
      .describe("Radio del círculo en unidades de diseño (entero positivo)."),
    stepCount: z
      .number()
      .int()
      .min(12)
      .max(360)
      .default(72)
      .describe("Número de segmentos (pasos) para aproximar el círculo. Default: 72."),
  }),
  z.object({
    kind: z.literal("disk"),
    cx: relativeIntSchema("Center X"),
    cy: relativeIntSchema("Center Y"),
    radius: z
      .number()
      .int()
      .min(1)
      .describe("Radio del disco en unidades de diseño (entero positivo)."),
    rowStep: z
      .number()
      .int()
      .min(1)
      .max(20)
      .default(4)
      .describe("Paso entre filas concéntricas (1 = cada fila, 4 = cada 4ª fila). Default: 4."),
  }),
  z.object({
    kind: z.literal("arc"),
    cx: relativeIntSchema("Center X"),
    cy: relativeIntSchema("Center Y"),
    radius: z
      .number()
      .int()
      .min(1)
      .describe("Radio del arco en unidades de diseño (entero positivo)."),
    startDeg: z.number().describe("Ángulo inicial en grados (0 = 3 en punto, sentido horario)."),
    endDeg: z.number().describe("Ángulo final en grados (sentido horario desde startDeg)."),
    stepDeg: z
      .number()
      .positive()
      .max(45)
      .default(4)
      .describe("Incremento angular entre puntos (grados). Default: 4."),
  }),
  z.object({
    kind: z.literal("rectangle"),
    x: ellipseXSchema,
    y: ellipseYSchema,
    width: ellipseWidthSchema,
    height: ellipseHeightSchema,
  }),
  z.object({
    kind: z.literal("roundedRectangle"),
    x: ellipseXSchema,
    y: ellipseYSchema,
    width: ellipseWidthSchema,
    height: ellipseHeightSchema,
    radius: z
      .number()
      .int()
      .min(1)
      .default(24)
      .describe("Radio de las esquinas redondeadas. Default: 24."),
    stepDeg: z
      .number()
      .positive()
      .max(45)
      .default(12)
      .describe("Incremento angular para las esquinas (grados). Default: 12."),
  }),
  z.object({
    kind: z.literal("polyline"),
    points: z
      .array(pointSchema)
      .min(2)
      .max(1000)
      .describe("Array de puntos {x,y} del polilínea (mínimo 2, máximo 1000)."),
  }),
  z.object({
    kind: z.literal("logarithmicSpiral"),
    cx: relativeIntSchema("Center X"),
    cy: relativeIntSchema("Center Y"),
    growth: z
      .number()
      .positive()
      .default(1.1)
      .describe("Factor de crecimiento por vuelta (>1 = se aleja del centro). Default: 1.1."),
    turns: z
      .number()
      .int()
      .min(1)
      .max(20)
      .default(6)
      .describe("Número de vueltas completas. Default: 6."),
    angleStep: z
      .number()
      .positive()
      .max(1)
      .default(0.05)
      .describe("Incremento angular entre puntos (radianes). Default: 0.05."),
    scale: z
      .number()
      .positive()
      .default(7)
      .describe("Factor de escala global. Default: 7."),
  }),
  z.object({
    kind: z.literal("regularPolygon"),
    cx: relativeIntSchema("Center X"),
    cy: relativeIntSchema("Center Y"),
    radius: z
      .number()
      .int()
      .min(1)
      .describe("Radio del polígono (distancia del centro a vértices)."),
    sides: z
      .number()
      .int()
      .min(3)
      .max(64)
      .describe("Número de lados (3 = triángulo, 4 = cuadrado, etc.)."),
    rotationDeg: z
      .number()
      .default(-90)
      .describe("Rotación inicial en grados (default -90 = vértice arriba)."),
  }),
  z.object({
    kind: z.literal("starPolygon"),
    cx: relativeIntSchema("Center X"),
    cy: relativeIntSchema("Center Y"),
    outerRadius: z
      .number()
      .int()
      .min(1)
      .describe("Radio exterior (puntas de la estrella)."),
    innerRadius: z
      .number()
      .int()
      .min(1)
      .describe("Radio interior (valles de la estrella)."),
    points: z
      .number()
      .int()
      .min(3)
      .max(32)
      .describe("Número de puntas de la estrella."),
    rotationDeg: z
      .number()
      .default(-90)
      .describe("Rotación inicial en grados (default -90 = punta arriba)."),
  }),
  z.object({
    kind: z.literal("grid"),
    x: relativeIntSchema("Grid X").default(0),
    y: relativeIntSchema("Grid Y").default(0),
    width: z
      .number()
      .int()
      .min(1)
      .describe("Ancho total de la cuadrícula en unidades de diseño."),
    height: z
      .number()
      .int()
      .min(1)
      .describe("Alto total de la cuadrícula en unidades de diseño."),
    cols: z
      .number()
      .int()
      .min(1)
      .max(50)
      .describe("Número de columnas."),
    rows: z
      .number()
      .int()
      .min(1)
      .max(50)
      .describe("Número de filas."),
    shape: z
      .enum(["circle", "disk", "rectangle", "ellipse"])
      .default("circle")
      .describe("Forma de cada celda. Default: circle."),
    radius: z
      .number()
      .int()
      .min(1)
      .default(4)
      .describe("Radio de la forma (para circle/disk) o radio de esquinas (roundedRectangle). Default: 4."),
    itemWidth: z
      .number()
      .int()
      .min(1)
      .default(20)
      .describe("Ancho de cada celda. Default: 20."),
    itemHeight: z
      .number()
      .int()
      .min(1)
      .default(20)
      .describe("Alto de cada celda. Default: 20."),
    stepCount: z
      .number()
      .int()
      .min(12)
      .max(360)
      .default(24)
      .describe("Segmentos por forma (para circle/ellipse). Default: 24."),
  }).refine(
    (grid) => grid.cols * grid.rows <= 400,
    {
      message:
        "grid demasiado grande: cols × rows debe ser ≤ 400 (el dibujo " +
        "queda limitado a 500 trazos por llamada).",
      path: ["cols"],
    },
  ),
  z.object({
    kind: z.literal("dotsAlongPath"),
    path: z
      .array(pointSchema)
      .min(2)
      .max(1000)
      .describe("Array de puntos {x,y} que define el sendero (mínimo 2, máximo 1000)."),
    radius: z
      .number()
      .int()
      .min(1)
      .default(3)
      .describe("Radio de cada círculo pequeño a lo largo del sendero. Default: 3."),
    spacing: z
      .number()
      .int()
      .min(1)
      .max(200)
      .default(16)
      .describe("Distancia entre centros de círculos consecutivos. Default: 16."),
    stepCount: z
      .number()
      .int()
      .min(12)
      .max(360)
      .default(24)
      .describe("Segmentos por círculo. Default: 24."),
  }).refine(
    (dots) => {
      let length = 0;
      for (let i = 1; i < dots.path.length; i += 1) {
        length += Math.hypot(
          dots.path[i].x - dots.path[i - 1].x,
          dots.path[i].y - dots.path[i - 1].y,
        );
      }
      return Math.floor(length / dots.spacing) <= 500;
    },
    {
      message:
        "dotsAlongPath generaría más de 500 círculos (el dibujo queda " +
        "limitado a 500 trazos por llamada). Aumenta 'spacing' o acorta el " +
        "sendero.",
      path: ["spacing"],
    },
  ),
]);

const generatorListSchema = z
  .array(generatorSchema)
  .min(1)
  .max(100)
  .default([
    { kind: "ellipse", x: 100, y: 120, width: 300, height: 180, stepCount: 72 },
  ])
  .describe("Lista de generadores 2D a dibujar (máximo 100).");

function generatorToPoints(generator: z.infer<typeof generatorSchema>) {
  switch (generator.kind) {
    case "ellipse":
      return ellipsePolyline(generator);
    case "circle":
      return circlePolyline(generator);
    case "arc":
      return arcPolyline(generator);
    case "rectangle":
      return rectanglePolyline(generator);
    case "roundedRectangle":
      return roundedRectanglePolyline(generator);
    case "polyline":
      return generator.points;
    case "logarithmicSpiral":
      return logarithmicSpiral({
        growth: generator.growth,
        turns: generator.turns,
        angleStep: generator.angleStep,
        scale: generator.scale,
        center: { x: generator.cx, y: generator.cy },
      });
    case "regularPolygon":
      return regularPolygon(generator);
    case "starPolygon":
      return starPolygon(generator);
    case "disk":
    case "grid":
    case "dotsAlongPath":
      // Estos kinds generan múltiples strokes y se manejan en generatorToStrokes.
      return [];
  }
}

function generatorToStrokes(generator: z.infer<typeof generatorSchema>) {
  switch (generator.kind) {
    case "disk":
      return diskStrokes(generator);
    case "grid":
      return gridItems(generator);
    case "dotsAlongPath":
      return dotsAlongPath(generator);
    default:
      return [generatorToPoints(generator)];
  }
}

function applyOriginToGenerator(
  generator: z.infer<typeof generatorSchema>,
  origin: Point2D,
): z.infer<typeof generatorSchema> {
  if (origin.x === 0 && origin.y === 0) {
    return generator;
  }
  const g = { ...generator } as any;
  switch (generator.kind) {
    case "ellipse":
    case "rectangle":
    case "roundedRectangle":
    case "grid":
      g.x = (g.x ?? 0) + origin.x;
      g.y = (g.y ?? 0) + origin.y;
      break;
    case "circle":
    case "disk":
    case "arc":
    case "logarithmicSpiral":
    case "regularPolygon":
    case "starPolygon":
      g.cx = (g.cx ?? 0) + origin.x;
      g.cy = (g.cy ?? 0) + origin.y;
      break;
    case "polyline":
      g.points = g.points.map((p: Point2D) => ({ x: p.x + origin.x, y: p.y + origin.y }));
      break;
    case "dotsAlongPath":
      g.path = g.path.map((p: Point2D) => ({ x: p.x + origin.x, y: p.y + origin.y }));
      break;
  }
  return g;
}

export function registerPaintDraw(
  server: McpServer,
  paint: PaintPort,
  controller: PaintController,
): void {
  server.registerTool(
    "paint_draw",
    {
      title: "Dibujar en Paint (2D)",
      description:
        "Herramienta principal para dibujar figuras 2D en Paint. Soporta dos modos: " +
        "'freehand' para uno o más strokes libres, y 'generator' para el DSL de " +
        "generadores matemáticos (ellipse, circle, disk, arc, rectangle, " +
        "roundedRectangle, regularPolygon, starPolygon, logarithmicSpiral, polyline, " +
        "grid, dotsAlongPath). 'grid' repite una figura en una retícula cols × rows " +
        "(mosaico de círculos) y 'dotsAlongPath' distribuye círculos pequeños a lo " +
        "largo de un sendero. Para sólidos y mallas 3D usa la tool 'paint_draw_3d'. " +
        "Opciones: 'tool' elige Brocha o Lápiz, 'fit' (contain/fill) escala y centra " +
        "el dibujo dentro del lienzo, 'canvas' redimensiona el lienzo antes de " +
        "dibujar. Orden de aplicación: 'origin' desplaza las coordenadas PRIMERO, " +
        "luego (si corresponde) el lienzo se auto-ajusta a la proporción del " +
        "contenido, y por último 'fit' escala/centra el resultado — con fit: " +
        "contain/fill el desplazamiento de 'origin' queda mayormente absorbido por " +
        "ese auto-centrado. El resultado devuelve la geometría del canvas, el " +
        "bounding box del contenido dibujado (canvasBounds) y, si 'verify' no se " +
        "desactivó, verificación por captura de pantalla de que el dibujo cambió " +
        "píxeles realmente (verified/verificationDetail).",
      inputSchema: {
        mode: drawModeSchema.default("generator"),
        tool: toolSchema,
        fit: fitSchema,
        verify: verifySchema,
        strokes: z
          .array(
            z.object({
              points: z.array(pointSchema).min(2).max(1000),
            }),
          )
          .min(1)
          .max(500)
          .default([
            {
              points: [
                { x: 100, y: 100 },
                { x: 170, y: 220 },
                { x: 240, y: 100 },
                { x: 310, y: 220 },
                { x: 380, y: 100 },
              ],
            },
            {
              points: [
                { x: 120, y: 300 },
                { x: 220, y: 360 },
                { x: 320, y: 300 },
              ],
            },
          ]),
        generator: generatorSchema
          .default({ kind: "ellipse", x: 100, y: 120, width: 300, height: 180, stepCount: 72 }),
        generators: generatorListSchema.optional(),
        stepDelayMs: stepDelayMsSchema,
        thickness: thicknessSchema.optional().describe("Grosor de la brocha/lápiz en píxeles (1–50)."),
        origin: pointSchema
          .optional()
          .describe(
            "Origen global (offset) aplicado a las coordenadas de los generadores, " +
              "ANTES de 'fit'. Con fit: contain/fill ese offset queda mayormente " +
              "neutralizado por el auto-centrado — combínalo con fit: none si " +
              "necesitas una posición absoluta real. Default: {0,0}.",
          ),
        canvas: canvasSizeSchema
          .optional()
          .describe("Redimensiona el lienzo ANTES de dibujar. Útil para preparar canvas a medida en una sola llamada."),
      },
    },
    async (args) => {
      logToolStarted("paint_draw", args);
      let outcome: "success" | "error" = "error";
      let strokeProvenance: StrokeProvenanceEntry[] = [];
      try {
        let window = await paint.createWindow();
        window = await resizeCanvasIfRequested(paint, controller, args.canvas, window);

        const drawOptions = {
          stepDelayMs: args.stepDelayMs,
          skipToolSelection: args.tool === "pencil" ? false : undefined,
          thickness: args.thickness,
        };

        if (args.mode === "freehand") {
          const strokes = fitStrokesToCanvas(args.strokes, args.fit, window.canvas);
          const result = await window.drawFreehand(strokes, drawOptions);
          outcome = "success";

          const verification = await verifyDrawnRegion(result.canvas, args.verify);

          return {
            content: [
              {
                type: "text",
                text:
                  `Freehand drawing completed: ${result.strokeCount} strokes, ` +
                  `${result.totalPoints} points on ` +
                  `${result.canvas.logicalWidth}x${result.canvas.logicalHeight} canvas ` +
                  `(${formatCanvasBounds(strokes)}) in "${result.windowTitle}". ` +
                  verificationMessage(verification),
              },
            ],
            structuredContent: {
              ...result,
              verified: verification.hasInk,
              verificationDetail: verification,
            },
          };
        }

        const generators = args.generators ?? [args.generator];
        const origin = args.origin ?? { x: 0, y: 0 };
        const offsetGenerators = generators.map((g) => applyOriginToGenerator(g, origin));

        // P2: auto-resize canvas to match content aspect ratio when using fit
        // — pero solo si no se pidió un tamaño explícito, para no pisarlo.
        if (!args.canvas && offsetGenerators.length > 0) {
          const { allStrokes: aspectStrokes } = buildStrokesWithProvenance(
            offsetGenerators,
            generatorToStrokes,
          );
          window = await autoResizeCanvasForAspect(paint, controller, args.fit, aspectStrokes, window);
        }

        const { allStrokes, provenance } = buildStrokesWithProvenance(
          offsetGenerators,
          generatorToStrokes,
        );
        strokeProvenance = provenance;
        const strokes = fitStrokesToCanvas(
          allStrokes.map((points) => ({ points })),
          args.fit,
          window.canvas,
        );
        const result = strokes.length === 1
          ? await window.drawPolyline(strokes[0].points, drawOptions)
          : await window.drawFreehand(strokes, drawOptions);
        outcome = "success";

        const verification = await verifyDrawnRegion(result.canvas, args.verify);

        return {
          content: [
            {
              type: "text",
              text:
                `Generator drawing completed with ${generators.length} generator(s) on ` +
                `${result.canvas.logicalWidth}x${result.canvas.logicalHeight} canvas ` +
                `(${formatCanvasBounds(strokes)}) in "${result.windowTitle}". ` +
                verificationMessage(verification),
            },
          ],
          structuredContent: {
            ...result,
            generators,
            verified: verification.hasInk,
            verificationDetail: verification,
          },
        };
      } catch (error: unknown) {
        annotateStrokeProvenanceError(error, strokeProvenance);
        return toolErrorResult("paint_draw", error);
      } finally {
        logToolFinished("paint_draw", outcome);
        notifyOperationFinished();
      }
    },
  );
}
