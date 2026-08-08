import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PaintPort } from "../../../domain/drawing.js";
import type { PaintController } from "../../../paint/paint-controller.js";
import { notifyOperationFinished } from "../../win32/process.js";
import { toolErrorResult } from "../errors.js";
import { logToolFinished, logToolStarted } from "../tool-logging.js";
import {
  pointSchema,
  stepDelayMsSchema,
} from "../schemas.js";

const editModeSchema = z.enum(["erase", "fill", "text", "crop"]);

const eraseSchema = z.object({
  kind: z.literal("erase"),
  points: z
    .array(pointSchema)
    .min(2)
    .max(1000)
    .describe("Puntos del trazo a borrar (polilínea)."),
  stepDelayMs: stepDelayMsSchema,
  thickness: z.number().int().min(1).max(50).optional().describe("Grosor del borrador (1-50)."),
});

const fillSchema = z.object({
  kind: z.literal("fill"),
  x: z.number().int().describe("Coordenada X del punto de relleno (píxeles lógicos)."),
  y: z.number().int().describe("Coordenada Y del punto de relleno (píxeles lógicos)."),
  stepDelayMs: stepDelayMsSchema,
});

const textSchema = z.object({
  kind: z.literal("text"),
  x: z.number().int().describe("Coordenada X de la esquina superior izquierda del cuadro de texto."),
  y: z.number().int().describe("Coordenada Y de la esquina superior izquierda del cuadro de texto."),
  width: z.number().int().min(10).describe("Ancho del cuadro de texto."),
  height: z.number().int().min(10).describe("Alto del cuadro de texto."),
  content: z.string().min(1).max(500).describe("Texto a insertar."),
  fontSize: z.number().int().min(6).max(200).default(24).describe("Tamaño de fuente en puntos."),
  fontFamily: z.string().default("Arial").describe("Familia de fuente (ej. Arial, Consolas)."),
  bold: z.boolean().default(false).describe("Negrita."),
  italic: z.boolean().default(false).describe("Cursiva."),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#000000").describe("Color hex (#RRGGBB)."),
  stepDelayMs: stepDelayMsSchema,
});

const cropSchema = z.object({
  kind: z.literal("crop"),
  x: z.number().int().min(0).describe("X de la esquina superior izquierda del recorte."),
  y: z.number().int().min(0).describe("Y de la esquina superior izquierda del recorte."),
  width: z.number().int().min(1).describe("Ancho del recorte."),
  height: z.number().int().min(1).describe("Alto del recorte."),
  stepDelayMs: stepDelayMsSchema,
});

const editActionSchema = z.discriminatedUnion("kind", [
  eraseSchema,
  fillSchema,
  textSchema,
  cropSchema,
]);

const editActionListSchema = z.array(editActionSchema).min(1).max(10);

export function registerPaintEdit(
  server: McpServer,
  paint: PaintPort,
  controller: PaintController,
): void {
  server.registerTool(
    "paint_edit",
    {
      title: "Editar en Paint",
      description:
        "Herramienta de edición para Paint. Soporta cuatro acciones: " +
        "'erase' (borrador: trazo libre que borra), " +
        "'fill' (cubo de pintura: relleno desde un punto), " +
        "'text' (texto: inserta un cuadro de texto con fuente/color), " +
        "'crop' (recortar: selecciona región y recorta la imagen). " +
        "Se pueden encadenar varias acciones en una sola llamada. " +
        "El lienzo se redimensiona automáticamente si se provee 'canvas'.",
      inputSchema: {
        actions: editActionListSchema,
        canvas: z
          .object({
            width: z.number().int().min(1).max(99999).describe("Ancho del lienzo en píxeles."),
            height: z.number().int().min(1).max(99999).describe("Alto del lienzo en píxeles."),
          })
          .optional()
          .describe("Redimensiona el lienzo ANTES de aplicar las ediciones."),
        stepDelayMs: stepDelayMsSchema,
      },
    },
    async (args) => {
      logToolStarted("paint_edit", args);
      let outcome: "success" | "error" = "error";
      try {
        let window = await paint.createWindow();

        // Optional canvas resize before edits
        if (args.canvas) {
          await controller.setCanvasSize(args.canvas.width, args.canvas.height);
          window = await paint.createWindow();
        }

        const results = [];

        for (const action of args.actions) {
          switch (action.kind) {
            case "erase": {
              const drawOptions = {
                stepDelayMs: action.stepDelayMs ?? args.stepDelayMs ?? 10,
                skipToolSelection: false,
                thickness: action.thickness,
              };
              const result = await window.drawFreehand(
                [{ points: action.points }],
                drawOptions,
              );
              results.push({ action: "erase", ...result });
              break;
            }
            case "fill": {
              // Fill requires selecting the fill tool and clicking
              const result = await window.fillAt(action.x, action.y, {
                stepDelayMs: action.stepDelayMs ?? args.stepDelayMs ?? 10,
              });
              results.push({ action: "fill", ...result });
              break;
            }
            case "text": {
              const result = await window.insertText({
                x: action.x,
                y: action.y,
                width: action.width,
                height: action.height,
                content: action.content,
                fontSize: action.fontSize,
                fontFamily: action.fontFamily,
                bold: action.bold,
                italic: action.italic,
                color: action.color,
                stepDelayMs: action.stepDelayMs ?? args.stepDelayMs ?? 10,
              });
              results.push({ action: "text", ...result });
              break;
            }
            case "crop": {
              const result = await window.crop({
                x: action.x,
                y: action.y,
                width: action.width,
                height: action.height,
                stepDelayMs: action.stepDelayMs ?? args.stepDelayMs ?? 10,
              });
              results.push({ action: "crop", ...result });
              break;
            }
          }
        }

        outcome = "success";
        return {
          content: [
            {
              type: "text",
              text:
                `Paint edit completed: ${results.length} action(s) on ` +
                `${results[results.length - 1]?.canvas?.logicalWidth ?? "?"}x` +
                `${results[results.length - 1]?.canvas?.logicalHeight ?? "?"} canvas.`,
            },
          ],
          structuredContent: { results },
        };
      } catch (error: unknown) {
        return toolErrorResult("paint_edit", error);
      } finally {
        logToolFinished("paint_edit", outcome);
        notifyOperationFinished();
      }
    },
  );
}