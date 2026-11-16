import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

export type Db = Database.Database;

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

/**
 * Open the database with the settings every connection must have.
 * Pass ":memory:" for tests.
 */
export function openDatabase(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = FULL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  return db;
}

/**
 * Apply every migration that has not run yet, in file-name order.
 * Migrations are plain SQL files named `NNNN_name.sql`. Each lane owns a
 * number range so parallel work never collides:
 *   0001-0099 accounts and core   0100-0199 library
 *   0200-0299 files and inbox     0300-0399 documents
 *   0400-0499 practice            0500-0599 concepts and canvas
 *   0600-0699 agent layer and integration   0700-0799 requests
 *   0800-0899 references
 *   0600-0699 integration (changes that span domains)
 */
export function migrate(db: Db, dir: string = MIGRATIONS_DIR): string[] {
  db.exec(
    "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  const done = new Set(
    (db.prepare("SELECT name FROM _migrations").all() as Array<{ name: string }>).map(
      (row) => row.name,
    ),
  );
  const files = readdirSync(dir)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  const applied: string[] = [];
  for (const name of files) {
    if (done.has(name)) continue;
    const sql = readFileSync(join(dir, name), "utf8");
    db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)").run(
        name,
        new Date().toISOString(),
      );
    })();
    applied.push(name);
  }
  return applied;
}

/** A fresh, fully migrated in-memory database for tests. */
export function createTestDatabase(): Db {
  const db = openDatabase(":memory:");
  migrate(db);
  return db;
}
