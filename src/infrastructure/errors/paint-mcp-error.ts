export type PaintMcpErrorCode =
  | "PAINT_NOT_RUNNING"
  | "PAINT_WINDOW_NOT_FOUND"
  | "UI_AUTOMATION_UNAVAILABLE"
  | "CANVAS_NOT_FOUND"
  | "INVALID_CANVAS_BOUNDS"
  | "DRAW_BOUNDS_OUTSIDE_CANVAS"
  | "INPUT_INJECTION_FAILED";

export class PaintMcpError extends Error {
  constructor(
    public readonly code: PaintMcpErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "PaintMcpError";
  }
}

export function isPaintMcpError(error: unknown): error is PaintMcpError {
  return error instanceof PaintMcpError;
}
