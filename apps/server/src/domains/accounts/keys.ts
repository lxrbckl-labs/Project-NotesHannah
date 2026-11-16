import {
  API_KEY_PATTERN,
  type ApiKey,
  type ApiKeyScope,
  type CreateApiKeyInput,
  type CreatedApiKey,
  idKind,
  newId,
} from "@notes/schema";
import type { Db } from "../../db/client.js";
import { AppError } from "../../http/errors.js";
import { digestsEqual, iso, isoOrNull, randomToken, sha256 } from "./secrets.js";

/** `lastUsedAt` is written at most this often per key. */
export const KEY_TOUCH_MS = 60_000;
/** Characters of the secret kept in clear to tell keys apart. */
export const PREVIEW_LENGTH = 12;

interface KeyRow {
  id: string;
  user_id: string;
  name: string;
  scope: ApiKeyScope;
  preview: string;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
}

const COLUMNS = "id, user_id, name, scope, preview, created_at, last_used_at, revoked_at";

function toApiKey(row: KeyRow): ApiKey {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    scope: row.scope,
    preview: row.preview,
    createdAt: iso(row.created_at),
    lastUsedAt: isoOrNull(row.last_used_at),
    revokedAt: isoOrNull(row.revoked_at),
  };
}

export function createApiKey(
  db: Db,
  userId: string,
  input: CreateApiKeyInput,
  now: number,
): CreatedApiKey {
  const secret = `nh_${input.scope}_${randomToken()}`;
  const row: KeyRow = {
    id: newId("apiKey", now),
    user_id: userId,
    name: input.name.trim() || input.name,
    scope: input.scope,
    preview: secret.slice(0, PREVIEW_LENGTH),
    created_at: now,
    last_used_at: null,
    revoked_at: null,
  };
  db.prepare(
    `INSERT INTO api_keys (id, user_id, name, scope, secret_hash, preview, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(row.id, row.user_id, row.name, row.scope, sha256(secret), row.preview, row.created_at);
  return { key: toApiKey(row), secret };
}

/** A user's keys, revoked included, newest first. */
export function listApiKeys(db: Db, userId: string): ApiKey[] {
  const rows = db
    .prepare(`SELECT ${COLUMNS} FROM api_keys WHERE user_id = ? ORDER BY created_at DESC, id DESC`)
    .all(userId) as KeyRow[];
  return rows.map(toApiKey);
}

/** Revoke one of the user's keys. Another user's key is `not_found`. Idempotent. */
export function revokeApiKey(db: Db, userId: string, keyId: string, now: number): void {
  if (idKind(keyId) !== "apiKey") throw new AppError("not_found", "No such API key.");
  const row = db
    .prepare("SELECT revoked_at FROM api_keys WHERE id = ? AND user_id = ?")
    .get(keyId, userId) as { revoked_at: number | null } | undefined;
  if (!row) throw new AppError("not_found", "No such API key.");
  if (row.revoked_at === null) {
    db.prepare("UPDATE api_keys SET revoked_at = ? WHERE id = ?").run(now, keyId);
  }
}

export interface KeyAuth {
  keyId: string;
  userId: string;
  scope: ApiKeyScope;
}

/**
 * Resolve a bearer secret. The lookup is by SHA-256 digest (an index probe on
 * a value the caller cannot steer), then the digests are compared in
 * constant time. Revoked keys and disabled users are refused.
 */
export function authenticateApiKey(db: Db, secret: string, now: number): KeyAuth | null {
  if (!API_KEY_PATTERN.test(secret)) return null;
  const digest = sha256(secret);
  const row = db
    .prepare(
      `SELECT k.id, k.user_id, k.scope, k.secret_hash, k.last_used_at
       FROM api_keys k JOIN users u ON u.id = k.user_id
       WHERE k.secret_hash = ? AND k.revoked_at IS NULL AND u.disabled_at IS NULL`,
    )
    .get(digest) as
    | {
        id: string;
        user_id: string;
        scope: ApiKeyScope;
        secret_hash: Buffer;
        last_used_at: number | null;
      }
    | undefined;
  if (!row || !digestsEqual(row.secret_hash, digest)) return null;
  if (row.last_used_at === null || now - row.last_used_at >= KEY_TOUCH_MS) {
    db.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").run(now, row.id);
  }
  return { keyId: row.id, userId: row.user_id, scope: row.scope };
}
