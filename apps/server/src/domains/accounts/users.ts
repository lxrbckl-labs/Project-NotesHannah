import { newId, type User, Username } from "@notes/schema";
import type { Db } from "../../db/client.js";
import { AppError } from "../../http/errors.js";
import { iso, isoOrNull } from "./secrets.js";

export interface UserRow {
  id: string;
  username: string;
  display_name: string;
  created_at: number;
  disabled_at: number | null;
}

export function toUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    createdAt: iso(row.created_at),
    disabledAt: isoOrNull(row.disabled_at),
  };
}

/** Usernames are compared lower-cased and trimmed. */
export function normaliseUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function findUserByUsername(db: Db, username: string): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE username = ?").get(username) as UserRow | undefined;
}

export function findUserById(db: Db, id: string): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
}

export function listUsers(db: Db): UserRow[] {
  return db.prepare("SELECT * FROM users ORDER BY created_at, id").all() as UserRow[];
}

export function getPasswordHash(db: Db, userId: string): string | undefined {
  const row = db.prepare("SELECT hash FROM password_hashes WHERE user_id = ?").get(userId) as
    | { hash: string }
    | undefined;
  return row?.hash;
}

export function setPasswordHash(db: Db, userId: string, hash: string, now: number): void {
  db.prepare(
    `INSERT INTO password_hashes (user_id, hash, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET hash = excluded.hash, updated_at = excluded.updated_at`,
  ).run(userId, hash, now);
}

/** Insert a user with an already computed password hash. */
export function insertUser(
  db: Db,
  input: { username: string; displayName: string; passwordHash: string },
  now: number,
): UserRow {
  const username = Username.safeParse(normaliseUsername(input.username));
  if (!username.success) {
    throw new AppError("invalid_input", `Invalid username: ${username.error.issues[0]?.message}`, {
      example: "hannah",
    });
  }
  const displayName = input.displayName.trim();
  if (displayName.length < 1 || displayName.length > 80) {
    throw new AppError("invalid_input", "Display name must be 1 to 80 characters.");
  }
  if (findUserByUsername(db, username.data)) {
    throw new AppError("conflict", `User ${username.data} already exists.`);
  }
  const row: UserRow = {
    id: newId("user", now),
    username: username.data,
    display_name: displayName,
    created_at: now,
    disabled_at: null,
  };
  db.transaction(() => {
    db.prepare(
      "INSERT INTO users (id, username, display_name, created_at, disabled_at) VALUES (?, ?, ?, ?, NULL)",
    ).run(row.id, row.username, row.display_name, row.created_at);
    setPasswordHash(db, row.id, input.passwordHash, now);
  })();
  return row;
}

/**
 * Disable or re-enable a user. Disabling also ends every session; API keys
 * are kept (so re-enabling restores them) but are refused while disabled.
 */
export function setUserDisabled(db: Db, userId: string, disabled: boolean, now: number): void {
  db.transaction(() => {
    db.prepare("UPDATE users SET disabled_at = ? WHERE id = ?").run(disabled ? now : null, userId);
    if (disabled) db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  })();
}
