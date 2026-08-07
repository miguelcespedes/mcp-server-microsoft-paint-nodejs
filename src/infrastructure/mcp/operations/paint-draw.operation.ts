import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PaintPort } from "../../../domain/drawing.js";
import {
  arcPolyline,
  circlePolyline,
  diskStrokes,
  ellipsePolyline,
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
  ellipseHeightSchema,
  ellipseWidthSchema,
  ellipseXSchema,
  ellipseYSchema,
  pointSchema,
  stepDelayMsSchema,
  windowModeSchema,
} from "../schemas.js";

const drawModeSchema = z.enum(["freehand", "generator"]);

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
      // Disk is handled separately because it generates multiple strokes.
      return [];
  }
}

function generatorToStrokes(generator: z.infer<typeof generatorSchema>) {
  if (generator.kind === "disk") {
    return diskStrokes(generator);
  }
  return [generatorToPoints(generator)];
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
        "roundedRectangle, regularPolygon, starPolygon, logarithmicSpiral, polyline).",
      inputSchema: {
        mode: drawModeSchema.default("generator"),
        strokes: z
          .array(
            z.object({
              points: z.array(pointSchema).min(2).max(1000),
            }),
          )
          .min(1)
          .max(100)
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
        windowMode: windowModeSchema,
      },
    },
    async (args) => {
      logToolStarted("paint_draw", args);
      let outcome: "success" | "error" = "error";
      try {
        if (args.mode === "freehand") {
          const window = await paint.createWindow();
          const result = await window.drawFreehand(args.strokes, {
            stepDelayMs: args.stepDelayMs,
          });
          outcome = "success";
          return {
            content: [
              {
                type: "text",
                text:
                  `Freehand drawing completed: ${result.strokeCount} strokes, ` +
                  `${result.totalPoints} points in "${result.windowTitle}".`,
              },
            ],
            structuredContent: result,
          };
        }

        const generators = args.generators ?? [args.generator];
        const allStrokes = generators.flatMap((generator) => generatorToStrokes(generator));
        const window = await paint.createWindow();
        const result = allStrokes.length === 1
          ? await window.drawPolyline(allStrokes[0], {
              stepDelayMs: args.stepDelayMs,
            })
          : await window.drawFreehand(
              allStrokes.map((points) => ({ points })),
              {
                stepDelayMs: args.stepDelayMs,
              },
            );
        outcome = "success";
        return {
          content: [
            {
              type: "text",
              text:
                `Generator drawing completed with ${generators.length} generator(s) in ` +
                `"${result.windowTitle}".`,
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
