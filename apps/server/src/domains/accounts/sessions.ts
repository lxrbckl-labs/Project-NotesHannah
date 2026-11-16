import { newId } from "@notes/schema";
import type { Db } from "../../db/client.js";
import { digestsEqual, randomToken, sha256, TOKEN_PATTERN } from "./secrets.js";

/** Sessions last 30 days from the last request (sliding). */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;
/** last_seen / expiry are written at most this often per session. */
export const SESSION_TOUCH_MS = 60_000;

export interface ResolvedSession {
  sessionId: string;
  userId: string;
  /** True when the expiry was just extended (re-send the cookie). */
  refreshed: boolean;
}

export function createSession(
  db: Db,
  userId: string,
  now: number,
  userAgent: string | null,
): { sessionId: string; token: string } {
  const token = randomToken();
  const sessionId = newId("session", now);
  db.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, created_at, last_seen_at, expires_at, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(sessionId, userId, sha256(token), now, now, now + SESSION_TTL_MS, userAgent);
  return { sessionId, token };
}

/** Look up a session token; null if unknown, expired, or the user is disabled. */
export function resolveSession(db: Db, token: string, now: number): ResolvedSession | null {
  if (!TOKEN_PATTERN.test(token)) return null;
  const digest = sha256(token);
  const row = db
    .prepare(
      `SELECT s.id, s.user_id, s.token_hash, s.last_seen_at, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND u.disabled_at IS NULL`,
    )
    .get(digest) as
    | { id: string; user_id: string; token_hash: Buffer; last_seen_at: number; expires_at: number }
    | undefined;
  if (!row || !digestsEqual(row.token_hash, digest)) return null;
  if (row.expires_at <= now) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(row.id);
    return null;
  }
  let refreshed = false;
  if (now - row.last_seen_at >= SESSION_TOUCH_MS) {
    db.prepare("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?").run(
      now,
      now + SESSION_TTL_MS,
      row.id,
    );
    refreshed = true;
  }
  return { sessionId: row.id, userId: row.user_id, refreshed };
}

export function deleteSession(db: Db, sessionId: string): void {
  db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
}

/** End every session of a user, optionally keeping one. */
export function deleteUserSessions(db: Db, userId: string, exceptSessionId?: string): number {
  if (exceptSessionId) {
    return db
      .prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?")
      .run(userId, exceptSessionId).changes;
  }
  return db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId).changes;
}

export function pruneExpiredSessions(db: Db, now: number): void {
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
}
