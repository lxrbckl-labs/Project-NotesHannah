import type { ApiError, ErrorCode } from "@notes/schema";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

const STATUS: Record<ErrorCode, ContentfulStatusCode> = {
  unauthenticated: 401,
  forbidden: 403,
  read_only_key: 403,
  not_found: 404,
  invalid_input: 400,
  conflict: 409,
  rate_limited: 429,
  too_large: 413,
  unsupported_type: 415,
  encrypted_file: 422,
  corrupt_file: 422,
  too_many_pages: 422,
  conversion_failed: 422,
  storage_unavailable: 503,
  internal: 500,
};

/**
 * The one error type services throw. The web API and the MCP layer both turn
 * it into the shared ApiError shape, so a person or an agent gets the same
 * message, hint and example.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly hint?: string;
  readonly example?: unknown;
  readonly retryAfter?: number;

  constructor(
    code: ErrorCode,
    message: string,
    extra: { hint?: string; example?: unknown; retryAfter?: number } = {},
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.hint = extra.hint;
    this.example = extra.example;
    this.retryAfter = extra.retryAfter;
  }

  toApiError(): ApiError {
    return {
      code: this.code,
      message: this.message,
      ...(this.hint !== undefined ? { hint: this.hint } : {}),
      ...(this.example !== undefined ? { example: this.example } : {}),
      ...(this.retryAfter !== undefined ? { retryAfter: this.retryAfter } : {}),
    };
  }
}

export function statusFor(code: ErrorCode): ContentfulStatusCode {
  return STATUS[code];
}

/** Turn any thrown value into the `{ error }` response body. Use as `app.onError(handleError)`. */
export function handleError(error: unknown, c: Context): Response {
  if (error instanceof AppError) {
    if (error.retryAfter !== undefined) c.header("Retry-After", String(error.retryAfter));
    return c.json({ error: error.toApiError() }, statusFor(error.code));
  }
  console.error(error);
  const body: ApiError = { code: "internal", message: "Something went wrong on the server." };
  return c.json({ error: body }, 500);
}
