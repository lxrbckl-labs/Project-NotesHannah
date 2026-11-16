// Consistent snapshot of the live SQLite database, using SQLite's online backup API (never a file copy).
// Runs inside the app image: node /app/tools/db-snapshot.mjs --out /data/backups/db [--kind light|full] [--label text]
//
// 1. online backup of DB_PATH into <out>/.tmp-<name>  (safe while the server is writing)
// 2. switch the copy out of WAL mode, so the snapshot is one self-contained file
// 3. PRAGMA integrity_check and foreign_key_check on the copy
// 4. sha256, then rename into place, then write <name>.json (the manifest)
// A failed integrity check leaves nothing behind and exits 1. The manifest is printed on stdout.

import { createHash } from "node:crypto";
import { createReadStream, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const dbPath = process.env.DB_PATH ?? "/db/notes.db";
const outDir = opt("out", "/data/backups/db");
const kind = opt("kind", "full");
const label = opt("label", "");

const stamp = new Date()
  .toISOString()
  .replace(/[-:]/g, "")
  .replace(/\.\d+Z$/, "Z"); // 20261115T120000Z
const name = `notes-${stamp}.db`;
const tmp = join(outDir, `.tmp-${name}`);
mkdirSync(outDir, { recursive: true });

function sha256(path) {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(path)
      .on("data", (d) => h.update(d))
      .on("end", () => resolve(h.digest("hex")))
      .on("error", reject);
  });
}

const fail = (message) => {
  rmSync(tmp, { force: true });
  console.error(`db-snapshot: ${message}`);
  process.exit(1);
};

const live = new Database(dbPath, { fileMustExist: true });
live.pragma("busy_timeout = 10000");
const started = Date.now();
await live.backup(tmp);
live.close();

const copy = new Database(tmp);
copy.pragma("journal_mode = DELETE");
const integrity = copy.pragma("integrity_check").map((r) => r.integrity_check);
if (integrity.length !== 1 || integrity[0] !== "ok") {
  copy.close();
  fail(`integrity_check failed: ${integrity.slice(0, 5).join("; ")}`);
}
const fkProblems = copy.pragma("foreign_key_check");
if (fkProblems.length > 0) {
  copy.close();
  fail(`foreign_key_check reports ${fkProblems.length} problem(s)`);
}
const count = (table) => {
  try {
    return copy.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
  } catch {
    return null;
  }
};
const migrations = copy
  .prepare("SELECT name FROM _migrations ORDER BY name")
  .all()
  .map((r) => r.name);
let storageId = null;
try {
  storageId =
    copy.prepare("SELECT value FROM app_meta WHERE key = 'storage_id'").get()?.value ?? null;
} catch {}
const counts = {
  users: count("users"),
  nodes: count("nodes"),
  sourceFiles: count("source_files"),
  pages: count("pages"),
  documents: count("documents"),
  transcripts: count("transcripts"),
};
copy.close();

const digest = await sha256(tmp);
const final = join(outDir, name);
renameSync(tmp, final);
const manifest = {
  manifestVersion: 1,
  createdAt: new Date().toISOString(),
  kind,
  label,
  file: name,
  bytes: statSync(final).size,
  sha256: digest,
  integrityCheck: "ok",
  foreignKeyCheck: "ok",
  schemaMigrations: migrations,
  storageId,
  counts,
  tookMs: Date.now() - started,
};
writeFileSync(join(outDir, `${name}.json`), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest));
