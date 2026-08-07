/**
 * Registro central de operaciones MCP.
 *
 * Patrón hexagonal: cada operación es un archivo en
 * src/infrastructure/mcp/<operacion>.ts que exporta
 * register<Nombre>(server, paint) y registra UNA herramienta MCP contra el
 * puerto PaintPort. Para agregar una operación nueva:
 *   1. Crea la figura pura en src/domain/figures.ts (si la necesita).
 *   2. Crea el archivo de operación con su esquema zod y su handler.
 *   3. Regístrala aquí.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PaintPort } from "../../domain/drawing.js";
import type { PaintController } from "../../paint/paint-controller.js";
import { registerPaintDebugCanvas } from "./operations/paint-debug-canvas.operation.js";
import { registerPaintDebugUi } from "./operations/paint-debug-ui.operation.js";
import { registerPaintDraw } from "./operations/paint-draw.operation.js";

export function registerOperations(
  server: McpServer,
  paint: PaintPort,
  controller: PaintController,
): void {
  registerPaintDraw(server, paint, controller);
  registerPaintDebugUi(server, controller);
  registerPaintDebugCanvas(server, controller);
}
