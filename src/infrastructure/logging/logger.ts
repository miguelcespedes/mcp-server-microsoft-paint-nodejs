export type LogLevel = "debug" | "info" | "warn" | "error";

function shouldLogDebug(): boolean {
  return process.env.PAINT_MCP_DEBUG === "true";
}

export interface Logger {
  debug(message: string, details?: unknown): void;
  info(message: string, details?: unknown): void;
  warn(message: string, details?: unknown): void;
  error(message: string, details?: unknown): void;
}

function write(level: LogLevel, message: string, details?: unknown): void {
  if (level === "debug" && !shouldLogDebug()) {
    return;
  }

  const suffix =
    details === undefined ? "" : ` ${JSON.stringify(details, null, 0)}`;
  console.error(`[paint-mcp:${level}] ${message}${suffix}`);
}

export function createLogger(): Logger {
  return {
    debug(message, details) {
      write("debug", message, details);
    },
    info(message, details) {
      write("info", message, details);
    },
    warn(message, details) {
      write("warn", message, details);
    },
    error(message, details) {
      write("error", message, details);
    },
  };
}
