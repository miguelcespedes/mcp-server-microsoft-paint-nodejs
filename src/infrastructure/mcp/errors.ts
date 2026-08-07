/**
 * Presentación de errores de las operaciones MCP: convierte cualquier error
 * a un resultado MCP de error (sin fallos silenciosos).
 */

import {
  isPaintMcpError,
  type PaintMcpErrorCode,
} from "../errors/paint-mcp-error.js";

type StructuredToolError = Record<string, unknown> & {
  success: false;
  code?: PaintMcpErrorCode;
  message: string;
  details?: unknown;
};

export function toolErrorResult(toolName: string, error: unknown) {
  const structured: StructuredToolError = isPaintMcpError(error)
    ? {
        success: false,
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      }
    : {
        success: false,
        message:
          error instanceof Error ? error.message : "Unknown error",
      };

  const detailLines: string[] = [];
  if (structured.details && typeof structured.details === "object") {
    const details = structured.details as Record<string, unknown>;
    if (typeof details.errorType === "string" && details.errorType.length > 0) {
      detailLines.push(`Type: ${details.errorType}`);
    }
    if (
      typeof details.positionMessage === "string" &&
      details.positionMessage.length > 0
    ) {
      detailLines.push(`Position: ${details.positionMessage}`);
    }
    if (typeof details.stderr === "string" && details.stderr.trim().length > 0) {
      detailLines.push(`stderr: ${details.stderr.trim()}`);
    }
  }

  return {
    content: [
      {
        type: "text" as const,
        text:
          `${toolName} failed: ${structured.message}` +
          (structured.code ? ` [${structured.code}]` : "") +
          (detailLines.length > 0 ? `\n${detailLines.join("\n")}` : ""),
      },
    ],
    structuredContent: structured,
    isError: true,
  };
}
