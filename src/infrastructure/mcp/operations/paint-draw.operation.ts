import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PaintPort } from "../../../domain/drawing.js";
import type { PaintController } from "../../../paint/paint-controller.js";
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
  relativeIntSchema,
  stepDelayMsSchema,
  toolSchema,
} from "../schemas.js";
import type { PaintCanvasInfo, Point2D, Stroke } from "../../../domain/drawing.js";

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
        "grid demasiado grande: cols Ã— rows debe ser â‰¤ 400 (el dibujo " +
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
        "dotsAlongPath generarÃ­a mÃ¡s de 500 cÃ­rculos (el dibujo queda " +
        "limitado a 500 trazos por llamada). Aumenta 'spacing' o acorta el " +
        "sendero.",
      path: ["spacing"],
    },
  ),
  z.object({
    kind: z.literal("solid"),
    solid: z.enum(solidNames),
    size: z
      .number()
      .positive()
      .max(2000)
      .default(120)
      .describe("Tamaño del sólido (unidades del modelo). Default: 120."),
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
    majorRadius: z
      .number()
      .positive()
      .default(100)
      .describe("Radio mayor (del centro del tubo al centro del toro). Default: 100."),
    tubeRadius: z
      .number()
      .positive()
      .default(35)
      .describe("Radio del tubo (sección transversal). Default: 35."),
    segments: z
      .number()
      .int()
      .min(6)
      .max(48)
      .default(16)
      .describe("Segmentos alrededor del tubo (resolución circunferencial). Default: 16."),
    rings: z
      .number()
      .int()
      .min(3)
      .max(24)
      .default(8)
      .describe("Anillos alrededor del toro (resolución longitudinal). Default: 8."),
    rotX: rotXSchema,
    rotY: rotYSchema,
    rotZ: rotZSchema,
    projection: projectionSchema,
    perspectiveDistance: perspectiveDistanceSchema,
  }),
  z.object({
    kind: z.literal("torusKnot"),
    p: z
      .number()
      .int()
      .min(1)
      .max(13)
      .describe("Veces que el nudo rodea el eje del toro (entero 1–13)."),
    q: z
      .number()
      .int()
      .min(1)
      .max(13)
      .describe("Veces que el nudo pasa por el agujero del toro (entero 1–13)."),
    radius: z
      .number()
      .positive()
      .default(100)
      .describe("Radio del toro base. Default: 100."),
    tubeRadius: z
      .number()
      .positive()
      .default(30)
      .describe("Radio del tubo del nudo. Default: 30."),
    steps: z
      .number()
      .int()
      .min(50)
      .max(1000)
      .default(400)
      .describe("Puntos de muestreo a lo largo del nudo. Default: 400."),
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
    segments: z
      .number()
      .int()
      .min(4)
      .max(64)
      .default(16)
      .describe("Segmentos de rotación (resolución angular). Default: 16."),
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
    size: z
      .number()
      .positive()
      .max(2000)
      .default(120)
      .describe("Factor de escala del modelo. Default: 120."),
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
        "wireframe: los Ã­ndices de 'edges' deben ser menores que la " +
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
  ])
  .describe("Lista de generadores a dibujar (máximo 100).");

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
  controller: PaintController,
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
        origin: pointSchema.optional().describe("Origen global (offset) aplicado a todas las coordenadas de los generadores. Default: {0,0}."),
      },
    },
    async (args) => {
      logToolStarted("paint_draw", args);
      let outcome: "success" | "error" = "error";
      try {
        let window = await paint.createWindow();
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

        function applyOriginToGenerator(generator: z.infer<typeof generatorSchema>, origin: Point2D) {
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
    // 3D generators are centered at model origin, no 2D offset
  }
  return g;
}

        const generators = args.generators ?? [args.generator];
        const origin = args.origin ?? { x: 0, y: 0 };
        const offsetGenerators = generators.map((g) => applyOriginToGenerator(g, origin));

        // P2: auto-resize canvas to match content aspect ratio when using fit
        if ((args.fit === "contain" || args.fit === "fill") && offsetGenerators.length > 0) {
          const allStrokes = offsetGenerators.flatMap((g) => generatorToStrokes(g));
          const contentBox = boundingBox(allStrokes);
          if (contentBox) {
            const contentWidth = contentBox.maxX - contentBox.minX;
            const contentHeight = contentBox.maxY - contentBox.minY;
            if (contentWidth > 0 && contentHeight > 0) {
              const contentAspect = contentWidth / contentHeight;
              const canvasAspect = window.canvas.logicalWidth / window.canvas.logicalHeight;
              const aspectDiff = Math.abs(contentAspect - canvasAspect) / Math.max(contentAspect, canvasAspect);
              if (aspectDiff > 0.15) {
                // Resize canvas to match content aspect, keeping max dimension ~1920
                const maxDim = Math.max(window.canvas.logicalWidth, window.canvas.logicalHeight);
                let newWidth: number, newHeight: number;
                if (contentAspect >= 1) {
                  newWidth = maxDim;
                  newHeight = Math.round(maxDim / contentAspect);
                } else {
                  newHeight = maxDim;
                  newWidth = Math.round(maxDim * contentAspect);
                }
                await controller.setCanvasSize(newWidth, newHeight);
                // Re-get window with new canvas size
                window = await paint.createWindow();
              }
            }
          }
        }

        const allStrokes = offsetGenerators.flatMap((generator) => generatorToStrokes(generator));
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
