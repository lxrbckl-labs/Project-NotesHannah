import type { Db } from "../../db/client.js";
import { randomToken, sha256, TOKEN_PATTERN } from "./secrets.js";

/** Browsers forget a device after this long without a sign-in (and browsers cap cookies at 400 days). */
export const DEVICE_TTL_MS = 400 * 24 * 60 * 60_000;

/** True when this device token has signed in to this user before. See throttle.ts. */
export function isKnownDevice(db: Db, userId: string, token: string | undefined, now: number) {
  if (!token || !TOKEN_PATTERN.test(token)) return false;
  const row = db
    .prepare("SELECT last_used_at FROM known_devices WHERE token_hash = ? AND user_id = ?")
    .get(sha256(token), userId) as { last_used_at: number } | undefined;
  return row !== undefined && now - row.last_used_at < DEVICE_TTL_MS;
}

/**
 * Remember the device after a successful sign-in. Reuses the browser's
 * existing device token (one browser may know several accounts) or makes a
 * new one. Returns the token to put in the cookie.
 */
export function rememberDevice(
  db: Db,
  userId: string,
  existing: string | undefined,
  now: number,
): string {
  const token = existing && TOKEN_PATTERN.test(existing) ? existing : randomToken();
  db.prepare(
    `INSERT INTO known_devices (token_hash, user_id, created_at, last_used_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (token_hash, user_id) DO UPDATE SET last_used_at = excluded.last_used_at`,
  ).run(sha256(token), userId, now, now);
  db.prepare("DELETE FROM known_devices WHERE last_used_at < ?").run(now - DEVICE_TTL_MS);
  return token;
}

/** Forget a user's devices, optionally keeping the current one. */
export function forgetDevices(db: Db, userId: string, keepToken?: string): void {
  if (keepToken && TOKEN_PATTERN.test(keepToken)) {
    db.prepare("DELETE FROM known_devices WHERE user_id = ? AND token_hash != ?").run(
      userId,
      sha256(keepToken),
    );
  } else {
    db.prepare("DELETE FROM known_devices WHERE user_id = ?").run(userId);
  }
}
