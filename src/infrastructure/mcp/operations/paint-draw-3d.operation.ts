import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PaintPort } from "../../../domain/drawing.js";
import type { PaintController } from "../../../paint/paint-controller.js";
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
  canvasSizeSchema,
  fitSchema,
  stepDelayMsSchema,
  thicknessSchema,
  toolSchema,
  verifySchema,
} from "../schemas.js";
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

const generator3dSchema = z.discriminatedUnion("kind", [
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
        "wireframe: los índices de 'edges' deben ser menores que la " +
        "cantidad de 'vertices'.",
      path: ["edges"],
    },
  ),
]);

const generator3dListSchema = z
  .array(generator3dSchema)
  .min(1)
  .max(100)
  .describe("Lista de sólidos/mallas 3D a dibujar (máximo 100).");

function generator3dToStrokes(generator: z.infer<typeof generator3dSchema>) {
  switch (generator.kind) {
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
  }
}

export function registerPaintDraw3d(
  server: McpServer,
  paint: PaintPort,
  controller: PaintController,
): void {
  server.registerTool(
    "paint_draw_3d",
    {
      title: "Dibujar sólidos/mallas 3D en Paint",
      description:
        "Dibuja sólidos y mallas 3D proyectados a alambre en Paint: poliedros " +
        "regulares, gran icosaedro, estrella octángula, tesseract (kind: 'solid'), " +
        "toro (kind: 'torus'), nudo toroidal (kind: 'torusKnot'), superficies de " +
        "revolución (kind: 'revolution', a partir de un perfil 2D rotado sobre el " +
        "eje Y) y mallas wireframe genéricas (kind: 'wireframe', vértices + aristas " +
        "explícitos). Cada generador se define centrado en el ORIGEN del modelo " +
        "(no soporta 'origin' como paint_draw — no tiene sentido para geometría " +
        "centrada por diseño), con rotaciones (rotX/rotY/rotZ, orden X→Y→Z) y " +
        "proyección ortográfica o perspectiva; cada arista resultante es un stroke. " +
        "'fit' (recomendado: 'contain') escala y centra la proyección 2D resultante " +
        "dentro del lienzo. El resultado incluye canvasBounds y, si 'verify' no se " +
        "desactivó, verificación por captura de pantalla (verified/verificationDetail).",
      inputSchema: {
        tool: toolSchema,
        fit: fitSchema.default("contain"),
        verify: verifySchema,
        generator: generator3dSchema.optional(),
        generators: generator3dListSchema.optional(),
        stepDelayMs: stepDelayMsSchema,
        thickness: thicknessSchema.optional().describe("Grosor de la brocha/lápiz en píxeles (1–50)."),
        canvas: canvasSizeSchema
          .optional()
          .describe("Redimensiona el lienzo ANTES de dibujar. Útil para preparar canvas a medida en una sola llamada."),
      },
    },
    async (args) => {
      logToolStarted("paint_draw_3d", args);
      let outcome: "success" | "error" = "error";
      let strokeProvenance: StrokeProvenanceEntry[] = [];
      try {
        if (!args.generator && !args.generators) {
          throw new Error("Debe proveerse 'generator' o 'generators'.");
        }

        let window = await paint.createWindow();
        window = await resizeCanvasIfRequested(paint, controller, args.canvas, window);

        const drawOptions = {
          stepDelayMs: args.stepDelayMs,
          skipToolSelection: args.tool === "pencil" ? false : undefined,
          thickness: args.thickness,
        };

        const generators = args.generators ?? [args.generator!];

        // Si el llamador ya pidió un tamaño explícito de canvas, se respeta
        // tal cual — no lo pisamos con el ajuste automático de aspecto.
        if (!args.canvas && generators.length > 0) {
          const { allStrokes: aspectStrokes } = buildStrokesWithProvenance(
            generators,
            generator3dToStrokes,
          );
          window = await autoResizeCanvasForAspect(paint, controller, args.fit, aspectStrokes, window);
        }

        const { allStrokes, provenance } = buildStrokesWithProvenance(
          generators,
          generator3dToStrokes,
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
                `3D drawing completed with ${generators.length} generator(s) on ` +
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
        return toolErrorResult("paint_draw_3d", error);
      } finally {
        logToolFinished("paint_draw_3d", outcome);
        notifyOperationFinished();
      }
    },
  );
}
