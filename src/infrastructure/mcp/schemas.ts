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
