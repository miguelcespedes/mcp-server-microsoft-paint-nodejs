import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PaintPort } from "../../../domain/drawing.js";
import {
  boundingBox,
  fitStrokes,
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
import {
  greatIcosahedronFaces,
  projectClosedPolyline,
  projectMesh,
  projectPolyline,
  revolutionPolygons,
  solidMesh,
  torusKnotPoints,
  torusPolygons,
  wireframeStrokes,
} from "../../../domain/solids.js";
import { notifyOperationFinished } from "../../win32/process.js";
import { toolErrorResult } from "../errors.js";
import { logToolFinished, logToolStarted } from "../tool-logging.js";
import {
  ellipseHeightSchema,
  ellipseWidthSchema,
  ellipseXSchema,
  ellipseYSchema,
  fitSchema,
  pointSchema,
  stepDelayMsSchema,
  toolSchema,
} from "../schemas.js";
import type { PaintCanvasInfo, Stroke } from "../../../domain/drawing.js";

const drawModeSchema = z.enum(["freehand", "generator"]);

const projectionSchema = z
  .enum(["ortho", "perspective"])
  .default("ortho")
  .describe(
    "Proyección 3D→2D: 'ortho' (sin perspectiva) o 'perspective' " +
      "(la cámara está a 'perspectiveDistance' del origen; lo cercano se agranda).",
  );

const rotXSchema = z
  .number()
  .min(-360)
  .max(360)
  .default(-20)
  .describe("Rotación sobre el eje X en grados (orden X → Y → Z).");

const rotYSchema = z
  .number()
  .min(-360)
  .max(360)
  .default(25)
  .describe("Rotación sobre el eje Y en grados (orden X → Y → Z).");

const rotZSchema = z
  .number()
  .min(-360)
  .max(360)
  .default(0)
  .describe("Rotación sobre el eje Z en grados (orden X → Y → Z).");

const perspectiveDistanceSchema = z
  .number()
  .positive()
  .default(3)
  .describe(
    "Distancia de la cámara al origen en unidades del modelo (proyección perspective).",
  );

const solidNames = [
  "tetrahedron",
  "cube",
  "octahedron",
  "dodecahedron",
  "icosahedron",
  "greatIcosahedron",
  "starOctangula",
  "tesseract",
] as const;

const revolutionProfilePointSchema = z.object({
  x: z
    .number()
    .int()
    .min(0)
    .describe("Distancia del punto al eje de rotación (radio)."),
  y: z
    .number()
    .int()
    .describe("Altura del punto sobre el centro (puede ser negativa)."),
});

const generatorSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ellipse"),
    x: ellipseXSchema,
    y: ellipseYSchema,
    width: ellipseWidthSchema,
    height: ellipseHeightSchema,
    stepCount: z.number().int().min(12).max(360).default(72),
  }),
  z.object({
    kind: z.literal("circle"),
    cx: z.number().int().min(0),
    cy: z.number().int().min(0),
    radius: z.number().int().min(1),
    stepCount: z.number().int().min(12).max(360).default(72),
  }),
  z.object({
    kind: z.literal("disk"),
    cx: z.number().int().min(0),
    cy: z.number().int().min(0),
    radius: z.number().int().min(1),
    rowStep: z.number().int().min(1).max(20).default(4),
  }),
  z.object({
    kind: z.literal("arc"),
    cx: z.number().int().min(0),
    cy: z.number().int().min(0),
    radius: z.number().int().min(1),
    startDeg: z.number(),
    endDeg: z.number(),
    stepDeg: z.number().positive().max(45).default(4),
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
    radius: z.number().int().min(1).default(24),
    stepDeg: z.number().positive().max(45).default(12),
  }),
  z.object({
    kind: z.literal("polyline"),
    points: z.array(pointSchema).min(2).max(1000),
  }),
  z.object({
    kind: z.literal("logarithmicSpiral"),
    cx: z.number().int().min(0),
    cy: z.number().int().min(0),
    growth: z.number().positive().default(1.1),
    turns: z.number().int().min(1).max(20).default(6),
    angleStep: z.number().positive().max(1).default(0.05),
    scale: z.number().positive().default(7),
  }),
  z.object({
    kind: z.literal("regularPolygon"),
    cx: z.number().int().min(0),
    cy: z.number().int().min(0),
    radius: z.number().int().min(1),
    sides: z.number().int().min(3).max(64),
    rotationDeg: z.number().default(-90),
  }),
  z.object({
    kind: z.literal("starPolygon"),
    cx: z.number().int().min(0),
    cy: z.number().int().min(0),
    outerRadius: z.number().int().min(1),
    innerRadius: z.number().int().min(1),
    points: z.number().int().min(3).max(32),
    rotationDeg: z.number().default(-90),
  }),
  z.object({
    kind: z.literal("grid"),
    x: z.number().int().min(0).default(0),
    y: z.number().int().min(0).default(0),
    width: z.number().int().min(1),
    height: z.number().int().min(1),
    cols: z.number().int().min(1).max(50),
    rows: z.number().int().min(1).max(50),
    shape: z.enum(["circle", "disk", "rectangle", "ellipse"]).default("circle"),
    radius: z.number().int().min(1).default(4),
    itemWidth: z.number().int().min(1).default(20),
    itemHeight: z.number().int().min(1).default(20),
    stepCount: z.number().int().min(12).max(360).default(24),
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
    path: z.array(pointSchema).min(2).max(1000),
    radius: z.number().int().min(1).default(3),
    spacing: z.number().int().min(1).max(200).default(16),
    stepCount: z.number().int().min(12).max(360).default(24),
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
  z.object({
    kind: z.literal("solid"),
    solid: z.enum(solidNames),
    size: z.number().positive().max(2000).default(120),
    rotX: rotXSchema,
    rotY: rotYSchema,
    rotZ: rotZSchema,
    projection: projectionSchema,
    perspectiveDistance: perspectiveDistanceSchema,
    starFaces: z
      .boolean()
      .default(false)
      .describe(
        "Solo para greatIcosahedron: añade las 20 caras pentagrama que se " +
          "cruzan (aprox. visual; el esqueleto de 30 aristas es el exacto).",
      ),
  }),
  z.object({
    kind: z.literal("torus"),
    majorRadius: z.number().positive().default(100),
    tubeRadius: z.number().positive().default(35),
    segments: z.number().int().min(6).max(48).default(16),
    rings: z.number().int().min(3).max(24).default(8),
    rotX: rotXSchema,
    rotY: rotYSchema,
    rotZ: rotZSchema,
    projection: projectionSchema,
    perspectiveDistance: perspectiveDistanceSchema,
  }),
  z.object({
    kind: z.literal("torusKnot"),
    p: z.number().int().min(1).max(13),
    q: z.number().int().min(1).max(13),
    radius: z.number().positive().default(100),
    tubeRadius: z.number().positive().default(30),
    steps: z.number().int().min(50).max(1000).default(400),
    rotX: rotXSchema,
    rotY: rotYSchema,
    rotZ: rotZSchema,
    projection: projectionSchema,
    perspectiveDistance: perspectiveDistanceSchema,
  }),
  z.object({
    kind: z.literal("revolution"),
    profile: z
      .array(revolutionProfilePointSchema)
      .min(2)
      .max(100)
      .describe(
        "Perfil del jarrón/curva en el plano: {x = distancia al eje (radio), " +
          "y = altura}. Se rota alrededor del eje Y.",
      ),
    segments: z.number().int().min(4).max(64).default(16),
    rotX: rotXSchema,
    rotY: rotYSchema,
    rotZ: rotZSchema,
    projection: projectionSchema,
    perspectiveDistance: perspectiveDistanceSchema,
  }),
  z.object({
    kind: z.literal("wireframe"),
    vertices: z
      .array(
        z.object({
          x: z.number(),
          y: z.number(),
          z: z.number(),
        }),
      )
      .min(1)
      .max(256)
      .describe("Vértices 3D de la malla (coordenadas del modelo)."),
    edges: z
      .array(z.tuple([z.number().int().min(0), z.number().int().min(0)]))
      .min(1)
      .max(500)
      .describe("Aristas como pares de índices de 'vertices'."),
    size: z.number().positive().max(2000).default(120),
    rotX: rotXSchema,
    rotY: rotYSchema,
    rotZ: rotZSchema,
    projection: projectionSchema,
    perspectiveDistance: perspectiveDistanceSchema,
  }).refine(
    (wire) =>
      wire.edges.every(
        ([a, b]) => a < wire.vertices.length && b < wire.vertices.length,
      ),
    {
      message:
        "wireframe: los índices de 'edges' deben ser menores que la " +
        "cantidad de 'vertices'.",
      path: ["edges"],
    },
  ),
]);

const generatorListSchema = z
  .array(generatorSchema)
  .min(1)
  .max(100)
  .default([
    { kind: "ellipse", x: 100, y: 120, width: 300, height: 180, stepCount: 72 },
  ]);

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
    case "solid":
    case "torus":
    case "torusKnot":
    case "revolution":
    case "wireframe":
      // These kinds generate multiple strokes (or a single polyline) and
      // are handled in generatorToStrokes.
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
    case "solid": {
      const mesh = solidMesh(generator.solid);
      const strokes = projectMesh(
        mesh,
        generator.rotX,
        generator.rotY,
        generator.rotZ,
        generator.projection,
        generator.perspectiveDistance,
        generator.size,
      );
      if (generator.starFaces && generator.solid === "greatIcosahedron") {
        const faces = greatIcosahedronFaces().map((face) =>
          projectClosedPolyline(
            face,
            generator.rotX,
            generator.rotY,
            generator.rotZ,
            generator.projection,
            generator.perspectiveDistance,
            generator.size,
          )
        );
        strokes.push(...faces);
      }
      return strokes;
    }
    case "torus":
      return torusPolygons({
        majorRadius: generator.majorRadius,
        tubeRadius: generator.tubeRadius,
        segments: generator.segments,
        rings: generator.rings,
      }).map((polygon) =>
        projectClosedPolyline(
          polygon,
          generator.rotX,
          generator.rotY,
          generator.rotZ,
          generator.projection,
          generator.perspectiveDistance,
          1,
        )
      );
    case "torusKnot":
      return [
        projectPolyline(
          torusKnotPoints(generator),
          generator.rotX,
          generator.rotY,
          generator.rotZ,
          generator.projection,
          generator.perspectiveDistance,
          1,
        ),
      ];
    case "revolution":
      return revolutionPolygons({
        profile: generator.profile,
        segments: generator.segments,
      }).map((polygon) =>
        projectClosedPolyline(
          polygon,
          generator.rotX,
          generator.rotY,
          generator.rotZ,
          generator.projection,
          generator.perspectiveDistance,
          1,
        )
      );
    case "wireframe":
      return wireframeStrokes(
        { vertices: generator.vertices, edges: generator.edges },
        generator.rotX,
        generator.rotY,
        generator.rotZ,
        generator.projection,
        generator.perspectiveDistance,
        generator.size,
      );
    default:
      return [generatorToPoints(generator)];
  }
}

function fitStrokesToCanvas(
  strokes: Stroke[],
  fit: z.infer<typeof fitSchema>,
  canvas: PaintCanvasInfo,
): Stroke[] {
  if (fit === "none" || canvas.logicalWidth <= 0 || canvas.logicalHeight <= 0) {
    return strokes;
  }
  const fitted = fitStrokes(
    strokes.map((stroke) => stroke.points),
    {
      width: canvas.logicalWidth,
      height: canvas.logicalHeight,
      mode: fit,
      margin: 0.05,
    },
  );
  return fitted.map((points) => ({ points }));
}

function formatCanvasBounds(strokes: Stroke[]): string {
  const bounds = boundingBox(strokes.map((stroke) => stroke.points));
  if (bounds === null) {
    return "no content bounds";
  }
  return `bounds ${bounds.minX},${bounds.minY}..${bounds.maxX},${bounds.maxY}`;
}

export function registerPaintDraw(
  server: McpServer,
  paint: PaintPort,
): void {
  server.registerTool(
    "paint_draw",
    {
      title: "Dibujar en Paint",
      description:
        "Herramienta productiva principal para dibujar en Paint. Soporta dos modos: " +
        "'freehand' para uno o más strokes libres, y 'generator' para el DSL de " +
        "generadores matemáticos (ellipse, circle, disk, arc, rectangle, " +
        "roundedRectangle, regularPolygon, starPolygon, logarithmicSpiral, polyline, " +
        "grid, dotsAlongPath) y de sólidos 3D proyectados a alambre (solid, torus, " +
        "torusKnot, revolution, wireframe). 'grid' repite una figura en una retícula " +
        "cols × rows (mosaico de círculos) y 'dotsAlongPath' distribuye círculos " +
        "pequeños a lo largo de un sendero. Los sólidos 3D (poliedros regulares, " +
        "gran icosaedro, estrella octángula, tesseract, toro, nudo toroidal, " +
        "superficies de revolución y mallas wireframe genéricas) se definen " +
        "centrados en el origen con rotaciones y proyección ortográfica o " +
        "perspectiva; cada arista es un stroke. Opciones: 'tool' elige Brocha o " +
        "Lápiz, 'fit' (contain/fill) escala y centra el dibujo dentro del lienzo " +
        "(recomendado para los sólidos 3D). El resultado devuelve la geometría " +
        "del canvas y el bounding box del contenido dibujado (canvasBounds) para " +
        "autoverificación.",
      inputSchema: {
        mode: drawModeSchema.default("generator"),
        tool: toolSchema,
        fit: fitSchema,
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
      },
    },
    async (args) => {
      logToolStarted("paint_draw", args);
      let outcome: "success" | "error" = "error";
      try {
        const window = await paint.createWindow();
        const drawOptions = {
          stepDelayMs: args.stepDelayMs,
          skipToolSelection: args.tool === "pencil" ? false : undefined,
        };

        if (args.mode === "freehand") {
          const strokes = fitStrokesToCanvas(args.strokes, args.fit, window.canvas);
          const result = await window.drawFreehand(strokes, drawOptions);
          outcome = "success";
          return {
            content: [
              {
                type: "text",
                text:
                  `Freehand drawing completed: ${result.strokeCount} strokes, ` +
                  `${result.totalPoints} points on ` +
                  `${result.canvas.logicalWidth}x${result.canvas.logicalHeight} canvas ` +
                  `(${formatCanvasBounds(strokes)}) in "${result.windowTitle}".`,
              },
            ],
            structuredContent: result,
          };
        }

        const generators = args.generators ?? [args.generator];
        const allStrokes = generators.flatMap((generator) => generatorToStrokes(generator));
        const strokes = fitStrokesToCanvas(
          allStrokes.map((points) => ({ points })),
          args.fit,
          window.canvas,
        );
        const result = strokes.length === 1
          ? await window.drawPolyline(strokes[0].points, drawOptions)
          : await window.drawFreehand(strokes, drawOptions);
        outcome = "success";
        return {
          content: [
            {
              type: "text",
              text:
                `Generator drawing completed with ${generators.length} generator(s) on ` +
                `${result.canvas.logicalWidth}x${result.canvas.logicalHeight} canvas ` +
                `(${formatCanvasBounds(strokes)}) in "${result.windowTitle}".`,
            },
          ],
          structuredContent: {
            ...result,
            generators,
          },
        };
      } catch (error: unknown) {
        return toolErrorResult("paint_draw", error);
      } finally {
        logToolFinished("paint_draw", outcome);
        notifyOperationFinished();
      }
    },
  );
}
