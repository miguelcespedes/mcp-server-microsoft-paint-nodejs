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
 * Herramienta de dibujo: "brush" es la Brocha por defecto de Paint (no se
 * toca el toolbar); "pencil" selecciona el Lápiz en la barra de herramientas
 * antes de dibujar (trazo fino, ideal para contornos y órbitas).
 */
export const toolSchema = z
  .enum(["brush", "pencil"])
  .default("brush")
  .describe(
    "Herramienta de dibujo: 'brush' (Brocha, por defecto) o 'pencil' " +
      "(Lápiz, trazo fino; se selecciona en la barra de herramientas antes " +
      "de dibujar).",
  );

/**
 * Ajuste del dibujo al lienzo: "none" usa las coordenadas tal cual,
 * "contain" escala y centra el dibujo dentro del lienzo preservando la
 * proporción, y "fill" lo estira hasta ocuparlo.
 */
export const fitSchema = z
  .enum(["none", "contain", "fill"])
  .default("none")
  .describe(
    "Ajuste del dibujo al lienzo: 'none' (coordenadas tal cual), 'contain' " +
      "(escala y centra preservando proporción) o 'fill' (estira para " +
      "ocupar el lienzo).",
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

export const windowModeSchema = z
  .enum(["current", "new"])
  .default("current")
  .describe("Whether to use the current Paint window or create a new one.");

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
