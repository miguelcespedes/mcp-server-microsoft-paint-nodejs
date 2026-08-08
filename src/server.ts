/**
 * Punto de COMPOSICIÓN del patrón hexagonal:
 *   dominio puro (src/domain)   → tipos, puerto PaintPort y figuras.
 *   adaptador Win32             → src/infrastructure/win32/paint.ts
 *                                (implementa PaintPort con Win32).
 *   adaptador MCP               → src/infrastructure/mcp/ (operaciones).
 *
 * Aquí se crea el adaptador Win32 y se inyecta a las operaciones MCP; ni
 * el dominio ni las operaciones conocen la implementación concreta.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PaintController } from "./paint/paint-controller.js";
import { PaintSessionStore } from "./paint/session/paint-session.js";
import { createLogger } from "./infrastructure/logging/logger.js";
import { createWin32PaintDriver } from "./infrastructure/win32/paint.js";
import { AutomationClient } from "./infrastructure/windows/automation/automation-client.js";
import { registerOperations } from "./infrastructure/mcp/registry.js";
import { withRequestResponseTracing } from "./infrastructure/mcp/tracing.js";

const server = new McpServer({
  name: "mcp-server-microsoft-paint-nodejs",
  version: "1.0.0",
});

// Operaciones de automatización de Microsoft Paint (solo Windows).
const paint = createWin32PaintDriver();
const logger = createLogger();
const automationClient = new AutomationClient();
const sessionStore = new PaintSessionStore(logger);
const controller = new PaintController(sessionStore, automationClient, logger);
// Traza request/response con callId de correlación para cada tool call
// (ver infrastructure/mcp/tracing.ts). Desactivable con PAINT_MCP_TRACE=false.
const tracedServer = withRequestResponseTracing(server);
registerOperations(tracedServer, paint, controller);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();

  await server.connect(transport);

  // En un MCP con stdio, stdout queda reservado para el protocolo.
  // Los mensajes humanos deben enviarse por stderr.
  console.error("Servidor MCP de Microsoft Paint activo.");
}

main().catch((error: unknown) => {
  console.error("No se pudo iniciar el servidor MCP:", error);
  process.exitCode = 1;
});
