import type { ToolingErrorCode } from "../types/index.js";

export class ToolingError extends Error {
  public readonly code: ToolingErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    code: ToolingErrorCode,
    details?: Record<string, unknown>,
    _options?: unknown
  ) {
    super(message);
    this.name = "ToolingError";
    this.code = code;
    this.details = details;
  }
}
