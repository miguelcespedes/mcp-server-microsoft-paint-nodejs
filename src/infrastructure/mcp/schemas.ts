/**
 * Esquemas zod de entrada de las operaciones MCP (contrato del adaptador).
 * Viven aquí, separados de las operaciones, para que cada responsabilidad
 * tenga su propio archivo (ver README → "Estructura del proyecto").
 */

import { z } from "zod";

/** Punto {x, y} en el espacio de diseño (enteros; negativos permitidos con fit). */
export const pointSchema = z.object({
  x: z
    .number()
    .int()
    .describe("Coordenada X del punto (puede ser negativa si se usa fit)."),
  y: z
    .number()
    .int()
    .describe("Coordenada Y del punto (puede ser negativa si se usa fit)."),
});

/**
 * Herramienta de dibujo: "brush" (Brocha) o "pencil" (Lápiz, trazo fino,
 * ideal para contornos y órbitas). Antes de CADA dibujo se verifica la
 * herramienta realmente activa (puede haber quedado en "Selección" por una
 * operación previa de recorte/selección) y se corrige si hace falta: Lápiz
 * vía su atajo directo (tecla P), Brocha vía la KeyTip de la cinta
 * (Alt suelto, luego B) — ambos mecanismos son confiables, pero si la
 * herramienta activa no coincide con la pedida, esa corrección añade
 * ~300-600ms a la llamada.
 */
export const toolSchema = z
  .enum(["brush", "pencil"])
  .default("brush")
  .describe(
    "Herramienta de dibujo: 'brush' (Brocha, por defecto) o 'pencil' " +
      "(Lápiz, trazo fino). Se verifica/corrige la herramienta activa antes " +
      "de dibujar (vía atajo de teclado), añadiendo ~300-600ms si hacía " +
      "falta cambiarla.",
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

/** Grosor de la brocha/lápiz en píxeles (1–50). */
export const thicknessSchema = z
  .number()
  .int()
  .min(1)
  .max(50)
  .describe("Grosor de la brocha o lápiz en píxeles (1–50).");

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

export const relativeIntSchema = (name: string) =>
  z
    .number()
    .int()
    .describe(
      `${name} in the design space (negative allowed; 'fit' maps it onto the canvas).`,
    );

export const positiveIntSchema = (name: string) =>
  z
    .number()
    .int()
    .min(1)
    .describe(`${name} as a positive integer.`);

export const ellipseXSchema = relativeIntSchema("Ellipse X")
  .default(100)
  .describe("Ellipse X in design-space coordinates. Default: 100.");

export const ellipseYSchema = relativeIntSchema("Ellipse Y")
  .default(120)
  .describe("Ellipse Y in design-space coordinates. Default: 120.");

export const ellipseWidthSchema = positiveIntSchema("Ellipse width")
  .default(300)
  .describe("Ellipse width as a positive integer. Default: 300.");

export const ellipseHeightSchema = positiveIntSchema("Ellipse height")
  .default(180)
  .describe("Ellipse height as a positive integer. Default: 180.");

/** Si verificar por captura de pantalla que el dibujo cambió píxeles realmente. */
export const verifySchema = z
  .boolean()
  .default(true)
  .describe(
    "Si true (default), verifica con una captura de pantalla que el " +
      "dibujo realmente cambió píxeles en el canvas (campo 'verified' en " +
      "el resultado). Desactivar ahorra ~200-400ms por llamada; útil en " +
      "lotes donde ya se confirmó que la automatización funciona.",
  );

/** Tamaño de lienzo {width, height} para redimensionar antes de dibujar. */
export const canvasSizeSchema = z.object({
  width: z.number().int().min(1).max(99999).describe("Ancho del lienzo en píxeles."),
  height: z.number().int().min(1).max(99999).describe("Alto del lienzo en píxeles."),
});
