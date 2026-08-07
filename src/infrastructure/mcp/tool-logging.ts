import { createLogger } from "../logging/logger.js";

const logger = createLogger();

export function logToolStarted(toolName: string, args?: unknown): void {
  logger.info(`tool started: ${toolName}`, args);
}

export function logToolFinished(toolName: string, outcome: "success" | "error"): void {
  logger.info(`tool finished: ${toolName}`, { outcome });
}
