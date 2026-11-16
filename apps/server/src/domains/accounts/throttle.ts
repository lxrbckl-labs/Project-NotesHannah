import type { Db } from "../../db/client.js";

/**
 * Sign-in throttling (A2).
 *
 * Two counters are kept in the database: one per account (keyed by the
 * submitted username, whether or not it exists, so unknown usernames behave
 * exactly like real ones) and one per client address. After FREE_FAILURES
 * failures a counter locks for BASE_LOCK, doubling with every further
 * failure up to MAX_LOCK. Attempts made while locked are refused before any
 * password check, so they neither count nor cost a hash. A counter forgets
 * its failures after DECAY of quiet; a successful sign-in clears both
 * counters involved.
 *
 * Failures are counted *before* the password is checked (and cleared again on
 * success). Checking and counting happen in one synchronous step, so a burst
 * of parallel guesses cannot all slip past the check before the first
 * failure is recorded.
 *
 * The lock-out trade-off. A per-account lock lets anyone who knows the
 * username keep the real user locked out indefinitely, simply by failing
 * every hour. We accept the per-account lock (it is what stops a slow,
 * distributed guess against one account) but exempt *known devices*: a
 * browser that has signed in to that account before carries an HttpOnly
 * device cookie, and for it only the per-address limit applies. The real
 * user on her own iPad or phone can therefore always sign in, while an
 * attacker on a new device faces both limits. The cost: someone holding a
 * stolen device cookie gets per-address limits only (still five tries, then
 * growing delays). Known devices are forgotten when the password changes,
 * and an admin `reset-password` forgets them all. A new device during an
 * active attack is locked out until the lock expires (at most an hour per
 * step); the admin can clear it with `reset-password`.
 */
export const FREE_FAILURES = 5;
export const BASE_LOCK_MS = 60_000;
export const MAX_LOCK_MS = 60 * 60_000;
export const DECAY_MS = 24 * 60 * 60_000;

export type ThrottleKind = "account" | "address";

interface Row {
  failures: number;
  last_failure_at: number;
  locked_until: number | null;
}

export function lockDuration(failures: number): number {
  if (failures < FREE_FAILURES) return 0;
  const doublings = Math.min(failures - FREE_FAILURES, 20);
  return Math.min(BASE_LOCK_MS * 2 ** doublings, MAX_LOCK_MS);
}

export class LoginThrottle {
  constructor(private readonly db: Db) {}

  private row(kind: ThrottleKind, subject: string): Row | undefined {
    return this.db
      .prepare(
        "SELECT failures, last_failure_at, locked_until FROM login_throttle WHERE kind = ? AND subject = ?",
      )
      .get(kind, subject) as Row | undefined;
  }

  /** Milliseconds until this counter unlocks; 0 when not locked. */
  waitMs(kind: ThrottleKind, subject: string, now: number): number {
    const row = this.row(kind, subject);
    if (!row || row.locked_until === null) return 0;
    return Math.max(0, row.locked_until - now);
  }

  recordFailure(kind: ThrottleKind, subject: string, now: number): void {
    const row = this.row(kind, subject);
    let failures = row?.failures ?? 0;
    const locked = row?.locked_until != null && row.locked_until > now;
    if (row && !locked && now - row.last_failure_at > DECAY_MS) failures = 0;
    failures += 1;
    const lock = lockDuration(failures);
    this.db
      .prepare(
        `INSERT INTO login_throttle (kind, subject, failures, last_failure_at, locked_until)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (kind, subject) DO UPDATE SET
           failures = excluded.failures,
           last_failure_at = excluded.last_failure_at,
           locked_until = excluded.locked_until`,
      )
      .run(kind, subject, failures, now, lock > 0 ? now + lock : null);
  }

  clear(kind: ThrottleKind, subject: string): void {
    this.db.prepare("DELETE FROM login_throttle WHERE kind = ? AND subject = ?").run(kind, subject);
  }

  /** Drop counters that have been quiet for longer than DECAY and are not locked. */
  prune(now: number): void {
    this.db
      .prepare(
        "DELETE FROM login_throttle WHERE last_failure_at < ? AND (locked_until IS NULL OR locked_until < ?)",
      )
      .run(now - DECAY_MS, now);
  }
}
