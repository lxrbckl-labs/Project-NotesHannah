// Put a database snapshot into an (empty) /db volume. Runs inside the app image as root, only from scripts/restore.sh:
//   node /app/tools/restore-db.mjs --from /in/notes-<stamp>.db --sha256 <expected> --uid 10001 --gid 10001
// Refuses if /db/notes.db already exists. Copies, re-checks the hash and PRAGMA integrity_check, then hands the
// file to the app's uid/gid.

import { createHash } from "node:crypto";
import { chmodSync, chownSync, copyFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import Database from "better-sqlite3";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const from = opt("from");
const expected = opt("sha256");
const uid = Number(opt("uid") ?? 10001);
const gid = Number(opt("gid") ?? 10001);
const target = "/db/notes.db";
const die = (m) => {
  console.error(`restore-db: ${m}`);
  process.exit(1);
};
if (!from) die("--from is required");
if (existsSync(target)) die(`${target} already exists; refusing to overwrite`);
copyFileSync(from, target);
const actual = createHash("sha256").update(readFileSync(target)).digest("hex");
if (expected && actual !== expected) {
  rmSync(target, { force: true });
  die(`sha256 mismatch: expected ${expected}, got ${actual}`);
}
const db = new Database(target, { fileMustExist: true });
const result = db.pragma("integrity_check").map((r) => r.integrity_check);
db.close();
if (result.length !== 1 || result[0] !== "ok") {
  rmSync(target, { force: true });
  die(`integrity_check failed: ${result.slice(0, 3).join("; ")}`);
}
chmodSync(target, 0o600);
chownSync(target, uid, gid);
chownSync("/db", uid, gid);
console.log(JSON.stringify({ restored: target, sha256: actual }));
