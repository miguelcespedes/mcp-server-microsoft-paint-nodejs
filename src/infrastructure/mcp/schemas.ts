/**
 * Esquemas zod de entrada de las operaciones MCP (contrato del adaptador).
 * Viven aquí, separados de las operaciones, para que cada responsabilidad
 * tenga su propio archivo (ver README → "Estructura del proyecto").
 */

import { z } from "zod";

/** Punto {x, y} en coordenadas de lienzo (enteros ≥ 0). */
export const pointSchema = z.object({
  x: z
    .number()
    .int()
    .min(0)
    .describe("Coordenada X del punto, relativa al lienzo."),
  y: z
    .number()
    .int()
    .min(0)
    .describe("Coordenada Y del punto, relativa al lienzo."),
});

/**
 * Selección de herramienta: por defecto no se toca el toolbar y se dibuja
 * con la herramienta activa (Paint inicia con la Brocha); con false se
 * selecciona el Lápiz.
 */
export const skipToolSelectionSchema = z
  .boolean()
  .optional()
  .describe(
    "Si es false, se selecciona la herramienta Lápiz en la barra de " +
      "herramientas antes de dibujar. Por defecto no se toca el toolbar: " +
      "se dibuja con la herramienta activa (Paint inicia con la Brocha).",
  );

/** Retraso entre movimientos del mouse (0–200 ms, por defecto 10). */
export const stepDelayMsSchema = z
  .number()
  .int()
  .min(0)
  .max(200)
  .default(10)
  .describe(
    "Retraso entre movimientos del mouse en ms (0–200, " +
      "por defecto 10). Más bajo = más rápido.",
  );

export const inventoryMaxDepthSchema = z
  .number()
  .int()
  .min(1)
  .max(10)
  .default(6)
  .describe("Maximum UI Automation tree depth to inspect (1-10). Default: 6.");

export const includeBoundingRectanglesSchema = z
  .boolean()
  .default(false)
  .describe("Include bounding rectangles in inventory output for diagnostics.");

export const inventoryFilterSchema = z
  .string()
  .trim()
  .min(1)
  .optional()
  .describe("Optional case-insensitive filter applied to discovered controls.");

export const shapeNameSchema = z
  .enum(["ellipse"])
  .describe("Shape identifier to resolve in Paint. Current POC supports only 'ellipse'.");

export const windowModeSchema = z
  .enum(["current", "new"])
  .default("current")
  .describe("Whether to use the current Paint window or create a new one.");

export const shapeStyleMenuSchema = z
  .enum(["outline", "fill", "size"])
  .describe("Style dropdown to inspect: outline, fill, or size.");

export const debugFilterSchema = z
  .string()
  .trim()
  .min(1)
  .optional()
  .describe("Optional case-insensitive filter for debug candidates.");

export const debugMaxItemsSchema = z
  .number()
  .int()
  .min(1)
  .max(20)
  .default(8)
  .describe("Maximum number of debug items to include in the summarized output.");

export const nonNegativeIntSchema = (name: string) =>
  z
    .number()
    .int()
    .min(0)
    .describe(`${name} in canvas-relative coordinates.`);

export const positiveIntSchema = (name: string) =>
  z
    .number()
    .int()
    .min(1)
    .describe(`${name} as a positive integer.`);

export const ellipseXSchema = nonNegativeIntSchema("Ellipse X")
  .default(100)
  .describe("Ellipse X in canvas-relative coordinates. Default: 100.");

export const ellipseYSchema = nonNegativeIntSchema("Ellipse Y")
  .default(120)
  .describe("Ellipse Y in canvas-relative coordinates. Default: 120.");

export const ellipseWidthSchema = positiveIntSchema("Ellipse width")
  .default(300)
  .describe("Ellipse width as a positive integer. Default: 300.");

export const ellipseHeightSchema = positiveIntSchema("Ellipse height")
  .default(180)
  .describe("Ellipse height as a positive integer. Default: 180.");

export const durationMsSchema = z
  .number()
  .int()
  .min(50)
  .max(5000)
  .default(600)
  .describe("Ellipse drag duration in milliseconds (50-5000). Default: 600.");
