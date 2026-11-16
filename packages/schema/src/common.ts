import { z } from "zod";
import { ApiKeyId, UserId } from "./ids.js";

/** ISO 8601 timestamp in UTC, e.g. "2026-11-15T18:20:00.000Z". */
export const Timestamp = z.iso.datetime();

/** Who did something: the signed-in user, or an agent acting through an API key. */
export const Actor = z.discriminatedUnion("type", [
  z.object({ type: z.literal("user"), userId: UserId }),
  z.object({
    type: z.literal("agent"),
    keyId: ApiKeyId,
    /** Free-text label the agent gives itself, e.g. "Claude Code". */
    label: z.string().max(80).optional(),
  }),
]);
export type Actor = z.infer<typeof Actor>;

/** Cursor paging. Listings are light; full content is fetched separately. */
export const PageRequest = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(200).default(50),
});
export type PageRequest = z.infer<typeof PageRequest>;

export function pageOf<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
}

/**
 * Error codes shared by the web API and the MCP layer. Every error carries a
 * message a person can read and, where it helps, a hint and a valid example,
 * so an agent can correct itself.
 */
export const ErrorCode = z.enum([
  "unauthenticated",
  "forbidden",
  "read_only_key",
  "not_found",
  "invalid_input",
  "conflict",
  "rate_limited",
  "too_large",
  "unsupported_type",
  "encrypted_file",
  "corrupt_file",
  "too_many_pages",
  "conversion_failed",
  "storage_unavailable",
  "internal",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ApiError = z.object({
  code: ErrorCode,
  message: z.string(),
  hint: z.string().optional(),
  example: z.unknown().optional(),
  /** Seconds to wait before retrying, for rate limits. */
  retryAfter: z.number().int().positive().optional(),
});
export type ApiError = z.infer<typeof ApiError>;
