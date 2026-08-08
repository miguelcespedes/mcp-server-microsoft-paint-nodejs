/**
 * Trazabilidad de ida/vuelta para cada llamada MCP: registra request y
 * response (o error) con un callId de correlación y duración, sin tener
 * que tocar cada archivo de operación individual.
 *
 * Se implementa envolviendo McpServer#registerTool en un Proxy: cada
 * herramienta registrada queda automáticamente instrumentada. Complementa
 * (no reemplaza) tool-logging.ts, que solo deja constancia del outcome
 * ("success"/"error") a nivel de negocio dentro de cada operación.
 *
 * Activar con PAINT_MCP_TRACE=true (los payloads pueden ser grandes, p. ej.
 * generadores con cientos de puntos, por lo que no se registran por
 * defecto). El nivel de detalle de los payloads se controla igual que el
 * resto de logs con PAINT_MCP_DEBUG (ver logging/logger.ts): si no está en
 * debug, solo se registran tamaños/resúmenes, no el contenido completo.
 */

import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createLogger } from "../logging/logger.js";

const logger = createLogger();

function isTracingEnabled(): boolean {
  return process.env.PAINT_MCP_TRACE !== "false";
}

const MAX_INLINE_PAYLOAD_CHARS = 4000;

/**
 * Serializa un payload para log, truncándolo si es muy grande. Nunca lanza:
 * un payload no serializable se reporta como tal en vez de romper el log.
 */
function summarizePayload(value: unknown): unknown {
  let json: string;
  try {
    json = JSON.stringify(value) ?? "null";
  } catch {
    return { unserializable: true };
  }

  if (json.length <= MAX_INLINE_PAYLOAD_CHARS) {
    try {
      return JSON.parse(json);
    } catch {
      return value;
    }
  }

  return {
    truncated: true,
    byteLength: json.length,
    preview: json.slice(0, MAX_INLINE_PAYLOAD_CHARS),
  };
}

function summarizeError(error: unknown): unknown {
  if (error instanceof Error) {
    const withCode = error as Error & { code?: string; details?: unknown };
    return {
      name: error.name,
      message: error.message,
      code: withCode.code,
      details: withCode.details === undefined ? undefined : summarizePayload(withCode.details),
    };
  }
  return summarizePayload(error);
}

/**
 * Envuelve un McpServer para que cada tool call registrada vía
 * registerTool quede instrumentada con un callId de correlación y el
 * payload completo de ida (args) y vuelta (resultado o error), más la
 * duración en ms. El objeto devuelto sigue siendo un McpServer utilizable
 * normalmente por el resto del código (registerOperations, etc.).
 */
export function withRequestResponseTracing(server: McpServer): McpServer {
  if (!isTracingEnabled()) {
    return server;
  }

  return new Proxy(server, {
    get(target, prop, receiver) {
      if (prop === "registerTool") {
        return (
          name: string,
          config: unknown,
          handler: (...handlerArgs: unknown[]) => unknown,
        ) => {
          const tracedHandler = async (...handlerArgs: unknown[]) => {
            const callId = randomUUID();
            const startedAt = Date.now();
            const args = handlerArgs[0];

            logger.info("mcp call → request", {
              callId,
              tool: name,
              direction: "request",
              args: summarizePayload(args),
            });

            try {
              const result = await handler(...handlerArgs);
              logger.info("mcp call ← response", {
                callId,
                tool: name,
                direction: "response",
                outcome: "success",
                durationMs: Date.now() - startedAt,
                result: summarizePayload(result),
              });
              return result;
            } catch (error) {
              logger.error("mcp call ← response", {
                callId,
                tool: name,
                direction: "response",
                outcome: "error",
                durationMs: Date.now() - startedAt,
                error: summarizeError(error),
              });
              throw error;
            }
          };

          const registerToolFn = Reflect.get(target, "registerTool", target) as (
            ...registerArgs: unknown[]
          ) => unknown;
          return registerToolFn.call(target, name, config, tracedHandler);
        };
      }

      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as McpServer;
}
