// Verify a database against a storage directory. Runs inside the app image:
//   node /app/tools/verify.mjs [--db /db/notes.db] [--data /data] [--quick]
//
//   - PRAGMA integrity_check and foreign_key_check on the database
//   - the storage marker matches the storage id the database is bound to
//   - every source file's original exists at originals/<user>/<sha256>, has that size, and (unless --quick)
//     its content hashes to the sha256 in its file name
//   - every converted file has exactly page_count page images and thumbnails on disk, and as many `pages` rows
// Prints one JSON report on stdout. Exit 0 when nothing is wrong, 1 otherwise.

import { createHash } from "node:crypto";
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const dbPath = opt("db", process.env.DB_PATH ?? "/db/notes.db");
const data = opt("data", process.env.DATA_DIR ?? "/data");
const quick = args.includes("--quick");
// Rows newer than the file backup (restore of a newer database over an older tree) point at originals the tree
// never had. With --allow-missing they are reported as warnings instead of failures.
const allowMissing = args.includes("--allow-missing");
const warnings = [];

const problems = [];
const problem = (kind, detail) => problems.push({ kind, ...detail });

const sha256 = (path) =>
  new Promise((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(path)
      .on("data", (d) => h.update(d))
      .on("end", () => resolve(h.digest("hex")))
      .on("error", reject);
  });

const db = new Database(dbPath, { readonly: true, fileMustExist: true });
const integrity = db.pragma("integrity_check").map((r) => r.integrity_check);
if (integrity.length !== 1 || integrity[0] !== "ok")
  problem("integrity_check", { detail: integrity.slice(0, 5) });
const fk = db.pragma("foreign_key_check");
if (fk.length > 0) problem("foreign_key_check", { count: fk.length });

let marker = null;
try {
  marker = JSON.parse(readFileSync(join(data, ".notes-storage"), "utf8"));
} catch {
  problem("storage_marker", { detail: "missing or unreadable" });
}
const bound =
  db.prepare("SELECT value FROM app_meta WHERE key = 'storage_id'").get()?.value ?? null;
if (marker && bound && marker.storageId !== bound)
  problem("storage_id_mismatch", { marker: marker.storageId, database: bound });

const files = db
  .prepare(
    "SELECT id, user_id, sha256, bytes, status, page_count, created_at, trashed_at FROM source_files ORDER BY id",
  )
  .all();
const pageRows = new Map(
  db
    .prepare("SELECT file_id, count(*) AS n FROM pages GROUP BY file_id")
    .all()
    .map((r) => [r.file_id, r.n]),
);
const referenced = new Set();
let originalsChecked = 0;
let pageImages = 0;
const hasPages = new Set(["converted", "transcribed", "filed"]);
for (const f of files) {
  const rel = join("originals", f.user_id, f.sha256);
  referenced.add(rel);
  const path = join(data, rel);
  let st;
  try {
    st = statSync(path);
  } catch {
    if (allowMissing)
      warnings.push({
        kind: "original_missing",
        file: f.id,
        status: f.status,
        createdAt: f.created_at,
      });
    else problem("original_missing", { file: f.id, path: rel });
    continue;
  }
  if (st.size !== f.bytes)
    problem("original_size", { file: f.id, path: rel, expected: f.bytes, actual: st.size });
  else if (!quick) {
    const actual = await sha256(path);
    if (actual !== f.sha256) problem("original_hash", { file: f.id, path: rel, actual });
  }
  originalsChecked++;
  if (hasPages.has(f.status)) {
    const dir = join(data, "pages", f.user_id, f.id);
    const list = (d) =>
      existsSync(d) ? readdirSync(d).filter((n) => /^\d{4}\.webp$/.test(n)) : [];
    const pages = list(dir);
    const thumbs = list(join(dir, "thumbs"));
    pageImages += pages.length;
    const rows = pageRows.get(f.id) ?? 0;
    if (pages.length !== f.page_count)
      problem("page_images", { file: f.id, expected: f.page_count, actual: pages.length });
    if (thumbs.length !== f.page_count)
      problem("thumbnails", { file: f.id, expected: f.page_count, actual: thumbs.length });
    if (rows !== f.page_count)
      problem("page_rows", { file: f.id, expected: f.page_count, actual: rows });
  }
}
// Information only: originals nothing refers to (an upload newer than the snapshot, or leftovers).
let unreferenced = 0;
const originalsRoot = join(data, "originals");
if (existsSync(originalsRoot)) {
  for (const user of readdirSync(originalsRoot)) {
    for (const name of readdirSync(join(originalsRoot, user))) {
      if (!referenced.has(join("originals", user, name))) unreferenced++;
    }
  }
}
db.close();

const report = {
  ok: problems.length === 0,
  mode: quick ? "quick (existence and size)" : "full (sha256 of every original)",
  files: files.length,
  originalsChecked,
  pageImages,
  unreferencedOriginals: unreferenced,
  missingOriginals: warnings.length,
  warnings: warnings.slice(0, 50),
  problems: problems.slice(0, 50),
  problemCount: problems.length,
};
console.log(JSON.stringify(report));
process.exit(report.ok ? 0 : 1);
