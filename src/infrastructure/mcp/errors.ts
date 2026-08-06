/**
 * Presentación de errores de las operaciones MCP: convierte cualquier error
 * a un resultado MCP de error (sin fallos silenciosos).
 */

export function toolErrorResult(toolName: string, error: unknown) {
  const message =
    error instanceof Error ? error.message : "Error desconocido";
  return {
    content: [
      {
        type: "text" as const,
        text: `${toolName} falló: ${message}`,
      },
    ],
    isError: true,
  };
}
