import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({
  name: "jarvis-network-mcp",
  version: "1.0.0",
});

server.registerTool(
  "network_get_public_ip",
  {
    title: "Obtener IP pública",
    description:
      "Obtiene la dirección IP pública desde la que esta computadora se conecta a Internet.",
  },
  async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5_000);

    try {
      const response = await fetch("https://api.ipify.org?format=json", {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        return {
          content: [
            {
              type: "text",
              text: `No se pudo obtener la IP pública. El servicio respondió con HTTP ${response.status}.`,
            },
          ],
          isError: true,
        };
      }

      const data: unknown = await response.json();

      if (
        typeof data !== "object" ||
        data === null ||
        !("ip" in data) ||
        typeof data.ip !== "string"
      ) {
        return {
          content: [
            {
              type: "text",
              text: "El servicio respondió, pero el formato de la respuesta no es válido.",
            },
          ],
          isError: true,
        };
      }

      const result = {
        ip: data.ip,
        source: "api.ipify.org",
        obtainedAt: new Date().toISOString(),
      };

      return {
        content: [
          {
            type: "text",
            text: `Tu dirección IP pública es ${result.ip}.`,
          },
        ],
        structuredContent: result,
      };
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Error desconocido";

      const explanation =
        error instanceof Error && error.name === "AbortError"
          ? "La consulta tardó más de cinco segundos y fue cancelada."
          : `No fue posible consultar la IP pública: ${message}`;

      return {
        content: [
          {
            type: "text",
            text: explanation,
          },
        ],
        isError: true,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();

  await server.connect(transport);

  // En un MCP con stdio, stdout queda reservado para el protocolo.
  // Los mensajes humanos deben enviarse por stderr.
  console.error("Jarvis Network MCP está activo.");
}

main().catch((error: unknown) => {
  console.error("No se pudo iniciar el servidor MCP:", error);
  process.exitCode = 1;
});