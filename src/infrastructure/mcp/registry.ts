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
import { registerFreehand } from "./operations/freehand.operation.js";
import { registerPolyline } from "./operations/polyline.operation.js";
import { registerLogarithmicSpiral } from "./operations/logarithmic-spiral.operation.js";

export function registerOperations(
  server: McpServer,
  paint: PaintPort,
): void {
  registerFreehand(server, paint);
  registerPolyline(server, paint);
  registerLogarithmicSpiral(server, paint);
}
