/** Machine-readable error codes. The worker maps these to user-facing messages. */
export type ErrorCode =
  | "UNSUPPORTED_TYPE"
  | "ENCRYPTED"
  | "CORRUPT_FILE"
  | "TOO_MANY_PAGES"
  | "FILE_TOO_LARGE"
  | "DECOMPRESSION_BOMB"
  | "PIXEL_BOMB"
  | "TIMEOUT"
  | "CONVERSION_FAILED"
  | "RESOURCE_LIMIT" // synthesised by run-sandboxed.sh when the container is OOM-killed
  | "BAD_USAGE"
  | "INTERNAL_ERROR";

export class ConvertError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ConvertError";
  }
}
