export type CompulsiveErrorCode =
  | "INVALID_INPUT"
  | "INVALID_REMOTE"
  | "NOT_INITIALIZED"
  | "NOT_FOUND"
  | "AMBIGUOUS_MATCH"
  | "CONFLICT"
  | "GIT_FAILED"
  | "FILESYSTEM_FAILED";

export class CompulsiveError extends Error {
  readonly code: CompulsiveErrorCode;
  readonly details?: unknown;

  constructor(code: CompulsiveErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "CompulsiveError";
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}
