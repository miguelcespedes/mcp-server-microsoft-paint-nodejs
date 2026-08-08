import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PaintPort } from "../../../domain/drawing.js";
import type { PaintController } from "../../../paint/paint-controller.js";
import {
  arrowPolyline,
  causeEffectLabelAnchors,
  causeEffectStrokes,
  chartLabelAnchors,
  chartStrokes,
  flowLabelAnchors,
  flowStrokes,
  mapLabelAnchors,
  mapStrokes,
  portraitLabelAnchor,
  portraitStrokes,
  timelineLabelAnchors,
  timelineStrokes,
  type TextAnchor,
} from "../../../domain/napkin.js";
import { notifyOperationFinished } from "../../win32/process.js";
import { toolErrorResult } from "../errors.js";
import { logToolFinished, logToolStarted } from "../tool-logging.js";
import {
  canvasSizeSchema,
  fitSchema,
  pointSchema,
  positiveIntSchema,
  relativeIntSchema,
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

const poseSchema = z
  .enum(["standing", "walking", "pointing", "sitting", "thinking"])
  .default("standing")
  .describe("Pose del monigote. Default: standing.");

const relativeMarkerSchema = z.object({
  x: z.number().min(0).max(1).describe("Posición horizontal relativa dentro de la región (0–1)."),
  y: z.number().min(0).max(1).describe("Posición vertical relativa dentro de la región (0–1)."),
});

const labelTextSchema = z.string().min(1).max(40);

const napkinGeneratorSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("portrait"),
    x: relativeIntSchema("Center X").describe("Centro horizontal de la figura."),
    y: relativeIntSchema("Feet Y").describe("Posición de los pies (nivel de suelo)."),
    scale: positiveIntSchema("Head radius").default(20).describe("Radio de la cabeza (define la escala). Default: 20."),
    pose: poseSchema,
    label: labelTextSchema.optional().describe("Nombre/etiqueta bajo la figura (opcional)."),
  }),
  z.object({
    kind: z.literal("arrow"),
    from: pointSchema.describe("Punto de origen del eje de la flecha."),
    to: pointSchema.describe("Punto de destino (donde va la punta)."),
    headSize: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Largo de las líneas de la punta. Default: 12% del largo del eje (mín. 6)."),
  }),
  z.object({
    kind: z.literal("chart"),
    x: relativeIntSchema("X"),
    y: relativeIntSchema("Y"),
    width: positiveIntSchema("Width"),
    height: positiveIntSchema("Height"),
    values: z
      .array(z.number().min(0))
      .min(1)
      .max(30)
      .describe("Valores relativos de cada barra (se escalan al más alto = height)."),
    gap: z
      .number()
      .min(0)
      .max(0.9)
      .default(0.3)
      .describe("Fracción del espacio de cada barra usada como separación. Default: 0.3."),
    labels: z
      .array(labelTextSchema)
      .max(30)
      .optional()
      .describe("Una etiqueta por barra, en el mismo orden que 'values' (opcional)."),
  }).refine(
    (chart) => !chart.labels || chart.labels.length === chart.values.length,
    { message: "labels debe tener la misma longitud que values.", path: ["labels"] },
  ),
  z.object({
    kind: z.literal("map"),
    x: relativeIntSchema("X"),
    y: relativeIntSchema("Y"),
    width: positiveIntSchema("Width"),
    height: positiveIntSchema("Height"),
    markers: z
      .array(relativeMarkerSchema)
      .min(1)
      .max(50)
      .describe("Marcadores dentro de la región, en coordenadas relativas [0,1]×[0,1]."),
    markerRadius: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Radio del marcador (estrella). Default: min(width,height)*0.06."),
    labels: z
      .array(labelTextSchema)
      .max(50)
      .optional()
      .describe("Una etiqueta por marcador, en el mismo orden que 'markers' (opcional)."),
  }).refine(
    (map) => !map.labels || map.labels.length === map.markers.length,
    { message: "labels debe tener la misma longitud que markers.", path: ["labels"] },
  ),
  z.object({
    kind: z.literal("timeline"),
    x: relativeIntSchema("X"),
    y: relativeIntSchema("Y"),
    length: positiveIntSchema("Length"),
    events: z.number().int().min(0).max(100).describe("Número de eventos, espaciados uniformemente."),
    tickHeight: positiveIntSchema("Tick height").default(14).describe("Alto de cada marca de evento. Default: 14."),
    labels: z
      .array(labelTextSchema)
      .max(100)
      .optional()
      .describe("Una etiqueta por evento, en el mismo orden (opcional)."),
  }).refine(
    (timeline) => !timeline.labels || timeline.labels.length === timeline.events,
    { message: "labels debe tener la misma longitud que events.", path: ["labels"] },
  ),
  z.object({
    kind: z.literal("flow"),
    x: relativeIntSchema("X"),
    y: relativeIntSchema("Y"),
    boxWidth: positiveIntSchema("Box width"),
    boxHeight: positiveIntSchema("Box height"),
    gap: positiveIntSchema("Gap").describe("Separación horizontal entre cajas."),
    steps: z.number().int().min(1).max(20).describe("Número de pasos (cajas) en secuencia."),
    labels: z
      .array(labelTextSchema)
      .max(20)
      .optional()
      .describe("Una etiqueta por caja, en el mismo orden (opcional)."),
  }).refine(
    (flow) => !flow.labels || flow.labels.length === flow.steps,
    { message: "labels debe tener la misma longitud que steps.", path: ["labels"] },
  ),
  z.object({
    kind: z.literal("causeEffect"),
    x: relativeIntSchema("X"),
    y: relativeIntSchema("Y"),
    width: positiveIntSchema("Width"),
    height: positiveIntSchema("Height"),
    trend: z.enum(["up", "down"]).default("up").describe("Dirección de la tendencia mostrada. Default: up."),
    xLabel: labelTextSchema.optional().describe("Rótulo del eje X (opcional)."),
    yLabel: labelTextSchema.optional().describe("Rótulo del eje Y (opcional)."),
  }),
]);

const napkinGeneratorListSchema = z
  .array(napkinGeneratorSchema)
  .min(1)
  .max(50)
  .describe("Lista de elementos del codex a dibujar (máximo 50).");

type NapkinGenerator = z.infer<typeof napkinGeneratorSchema>;

function napkinGeneratorToStrokes(generator: NapkinGenerator) {
  switch (generator.kind) {
    case "portrait":
      return portraitStrokes(generator);
    case "arrow":
      return arrowPolyline(generator);
    case "chart":
      return chartStrokes(generator);
    case "map":
      return mapStrokes(generator);
    case "timeline":
      return timelineStrokes(generator);
    case "flow":
      return flowStrokes(generator);
    case "causeEffect":
      return causeEffectStrokes(generator);
  }
}

/** Roam casi nunca dibuja una figura del codex sin su texto — ver anclas puras en napkin.ts. */
function napkinGeneratorToLabelAnchors(generator: NapkinGenerator, fontSize: number): TextAnchor[] {
  switch (generator.kind) {
    case "portrait":
      return generator.label ? [portraitLabelAnchor(generator, generator.label, fontSize)] : [];
    case "arrow":
      return [];
    case "chart":
      return generator.labels ? chartLabelAnchors(generator, generator.labels, fontSize) : [];
    case "map":
      return generator.labels ? mapLabelAnchors(generator, generator.labels, fontSize) : [];
    case "timeline":
      return generator.labels ? timelineLabelAnchors(generator, generator.labels, fontSize) : [];
    case "flow":
      return generator.labels ? flowLabelAnchors(generator, generator.labels, fontSize) : [];
    case "causeEffect":
      return causeEffectLabelAnchors(
        generator,
        { xLabel: generator.xLabel, yLabel: generator.yLabel },
        fontSize,
      );
  }
}

export function registerPaintNapkin(
  server: McpServer,
  paint: PaintPort,
  controller: PaintController,
): void {
  server.registerTool(
    "paint_napkin",
    {
      title: "Dibujar sketches estilo Dan Roam (codex 6×6)",
      description:
        "Dibuja en Paint con el vocabulario visual de 'The Back of the Napkin' de Dan " +
        "Roam ('Tu mundo en una servilleta'): la regla 6×6 del libro mapea 6 preguntas " +
        "a 6 formas de mostrarlas. kind: 'portrait' (quién/qué — monigote con pose: " +
        "standing/walking/pointing/sitting/thinking), 'chart' (cuánto — barras), 'map' " +
        "(dónde — región + marcadores), 'timeline' (cuándo — línea + eventos), 'flow' " +
        "(cómo — cajas conectadas por flechas), 'causeEffect' (por qué — ejes + curva " +
        "de tendencia). 'arrow' es un primitivo transversal (señalar, conectar) usado " +
        "también internamente por 'flow' y 'portrait' (pose pointing). La mayoría de " +
        "los kinds aceptan 'label'/'labels' (texto real insertado con la herramienta de " +
        "texto de Paint, alineado automáticamente con la figura y afectado por 'fit' " +
        "igual que el dibujo) porque en el libro una figura sin su texto no comunica " +
        "nada. Sin 'origin': cada elemento ya define su propia posición vía x/y. 'fit' " +
        "(recomendado: 'contain') escala y centra la composición dentro del lienzo.",
      inputSchema: {
        tool: toolSchema,
        fit: fitSchema.default("contain"),
        verify: verifySchema,
        generator: napkinGeneratorSchema.optional(),
        generators: napkinGeneratorListSchema.optional(),
        stepDelayMs: stepDelayMsSchema,
        thickness: thicknessSchema.optional().describe("Grosor de la brocha/lápiz en píxeles (1–50)."),
        fontSize: z
          .number()
          .int()
          .min(6)
          .max(72)
          .default(14)
          .describe(
            "Tamaño de fuente (px) para todas las etiquetas de la llamada. Default: 14. " +
              "Paint solo ofrece un set fijo de tamaños en su cinta (8,9,10,11,12,14,16,18," +
              "20,22,24,26,28,36,48,...); se aplica el más cercano al pedido.",
          ),
        fontFamily: z.string().default("Arial").describe("Familia de fuente para las etiquetas. Default: Arial."),
        labelColor: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .default("#000000")
          .describe("Color hex (#RRGGBB) de las etiquetas. Default: negro."),
        canvas: canvasSizeSchema
          .optional()
          .describe("Redimensiona el lienzo ANTES de dibujar. Útil para preparar canvas a medida en una sola llamada."),
      },
    },
    async (args) => {
      logToolStarted("paint_napkin", args);
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
            napkinGeneratorToStrokes,
          );
          window = await autoResizeCanvasForAspect(paint, controller, args.fit, aspectStrokes, window);
        }

        const { allStrokes, provenance } = buildStrokesWithProvenance(
          generators,
          napkinGeneratorToStrokes,
        );
        strokeProvenance = provenance;

        // Las anclas de texto se calculan en el mismo espacio de diseño que
        // las strokes y se fit-transforman EN LA MISMA llamada (como
        // strokes de dos puntos: esquina superior-izquierda e inferior-
        // derecha del cuadro), para que 'fit'/'origin' las muevan y
        // ESCALEN exactamente igual que al dibujo. insertText valida AMBAS
        // esquinas contra el canvas (ver paint.ts) — si solo se
        // fit-transformara la posición y no el tamaño, un auto-ajuste de
        // aspecto que achica el canvas puede dejar la esquina
        // inferior-derecha del cuadro fuera de rango.
        const labelAnchors = generators.flatMap((g) => napkinGeneratorToLabelAnchors(g, args.fontSize));
        const anchorCornerStrokes = labelAnchors.map((anchor) => [
          { x: anchor.x, y: anchor.y },
          { x: anchor.x + anchor.width, y: anchor.y + anchor.height },
        ]);

        const combined = fitStrokesToCanvas(
          [...allStrokes, ...anchorCornerStrokes].map((points) => ({ points })),
          args.fit,
          window.canvas,
        );
        const strokes = combined.slice(0, allStrokes.length);
        const fittedAnchorCorners = combined.slice(allStrokes.length);

        const result = strokes.length === 1
          ? await window.drawPolyline(strokes[0].points, drawOptions)
          : await window.drawFreehand(strokes, drawOptions);
        outcome = "success";

        for (let i = 0; i < labelAnchors.length; i += 1) {
          const anchor = labelAnchors[i];
          const [topLeft, bottomRight] = fittedAnchorCorners[i].points;
          await window.insertText({
            x: topLeft.x,
            y: topLeft.y,
            width: Math.max(1, bottomRight.x - topLeft.x),
            height: Math.max(1, bottomRight.y - topLeft.y),
            content: anchor.content,
            fontSize: args.fontSize,
            fontFamily: args.fontFamily,
            bold: false,
            italic: false,
            color: args.labelColor,
            stepDelayMs: args.stepDelayMs,
          });
        }

        const verification = await verifyDrawnRegion(result.canvas, args.verify);

        return {
          content: [
            {
              type: "text",
              text:
                `Napkin sketch completed with ${generators.length} element(s) ` +
                `(${labelAnchors.length} label(s)) on ` +
                `${result.canvas.logicalWidth}x${result.canvas.logicalHeight} canvas ` +
                `(${formatCanvasBounds(strokes)}) in "${result.windowTitle}". ` +
                verificationMessage(verification),
            },
          ],
          structuredContent: {
            ...result,
            generators,
            labelCount: labelAnchors.length,
            verified: verification.hasInk,
            verificationDetail: verification,
          },
        };
      } catch (error: unknown) {
        annotateStrokeProvenanceError(error, strokeProvenance);
        return toolErrorResult("paint_napkin", error);
      } finally {
        logToolFinished("paint_napkin", outcome);
        notifyOperationFinished();
      }
    },
  );
}
