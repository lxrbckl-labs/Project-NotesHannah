import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** 32 random bytes as 43 URL-safe base64 characters. */
export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Shape of every token made by `randomToken`. Checked before any lookup. */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** SHA-256 digest; the only form in which tokens and API keys are stored. */
export function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Constant-time comparison of two digests. */
export function digestsEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

export function iso(ms: number): string {
  return new Date(ms).toISOString();
}

export function isoOrNull(ms: number | null): string | null {
  return ms === null ? null : iso(ms);
}
