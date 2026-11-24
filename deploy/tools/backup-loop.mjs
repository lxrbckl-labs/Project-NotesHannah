// The backup sidecar: snapshots of the live SQLite database onto the external drive, from inside Docker.
//
// Why a container and not a host job: on macOS a launchd job needs a privacy grant (TCC) to read or write an external
// drive, and without it the host-side backup.sh fails after writing (sha256sum: Operation not permitted). The app
// container already reaches the drives through Docker's own file sharing, so a sidecar in the same compose project
// backs up without any grant. The live database stays in the named volume, where SQLite is safe; only snapshots land
// on the drives. docs/backups.md, "The sidecar", has the full picture and the restore path.
//
// Every BACKUP_INTERVAL_SECONDS (default 300):
//   1. db-snapshot.mjs (SQLite online backup API, integrity_check, foreign_key_check, sha256, manifest) into
//      /data/backups/db on the first drive
//   2. re-hash the file that reached the drive; a mismatch is a failure and the file is removed
//   3. a second copy into /copy/db on the second drive, verified by checksum, when /copy carries the
//      .notes-backup-target marker (the same marker backup.sh requires)
//   4. the retention ladder on both directories (same rules as scripts/lib/ladder.sh)
//   5. status files in /data/backups/status: last-snapshot.json (the same shape backup.sh writes) and
//      sidecar.json (a heartbeat the compose healthcheck reads)
// Runs as the app's uid. Never touches originals/ or pages/ (restic, run from the host, still covers the file tree).
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== "" ? process.env[k] : d);
const INTERVAL = Math.max(60, Number(env("BACKUP_INTERVAL_SECONDS", 300)));
const BACKUPS = env("BACKUPS_DIR", "/data/backups");
const COPY = env("BACKUP_COPY_MOUNT", "/copy");
const LADDER = {
  allHours: Number(env("RETAIN_ALL_HOURS", 2)),
  hourlyHours: Number(env("RETAIN_HOURLY_HOURS", 48)),
  dailyDays: Number(env("RETAIN_DAILY_DAYS", 30)),
  weeklyWeeks: Number(env("RETAIN_WEEKLY_WEEKS", 26)),
  monthlyMonths: Number(env("RETAIN_MONTHLY_MONTHS", 24)),
};
const ts = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");
const log = (m) => console.log(`${ts()} ${m}`);
const warn = (m) => console.error(`${ts()} WARN ${m}`);

const sha256 = (path) =>
  new Promise((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(path).on("data", (d) => h.update(d)).on("end", () => resolve(h.digest("hex"))).on("error", reject);
  });

function writeStatus(name, obj) {
  const dir = join(BACKUPS, "status");
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `${name}.json.tmp`);
  writeFileSync(tmp, `${JSON.stringify(obj)}\n`);
  renameSync(tmp, join(dir, `${name}.json`));
}

// Port of scripts/lib/ladder.sh ladder_victims: snapshot names (notes-YYYYMMDDTHHMMSSZ.db) that fall outside the ladder.
function ladderVictims(dir, nowSec) {
  const names = readdirSync(dir).filter((n) => /^notes-\d{8}T\d{6}Z\.db$/.test(n)).sort().reverse();
  const now = new Date(nowSec * 1000);
  const curMonth = now.getUTCFullYear() * 12 + (now.getUTCMonth() + 1);
  const seen = { h: new Set(), d: new Set(), w: new Set(), m: new Set() };
  const victims = [];
  names.forEach((name, i) => {
    const y = +name.slice(6, 10), mo = +name.slice(10, 12), d = +name.slice(12, 14);
    const H = +name.slice(15, 17), M = +name.slice(17, 19), S = +name.slice(19, 21);
    const e = Date.UTC(y, mo - 1, d, H, M, S) / 1000;
    const days = Math.floor(e / 86400);
    const age = nowSec - e;
    let keep = i < 3 || age < LADDER.allHours * 3600;
    const hb = Math.floor(e / 3600), wb = Math.floor((days + 3) / 7), mb = y * 12 + mo;
    if (age < LADDER.hourlyHours * 3600 && !seen.h.has(hb)) { seen.h.add(hb); keep = true; }
    if (age < LADDER.dailyDays * 86400 && !seen.d.has(days)) { seen.d.add(days); keep = true; }
    if (age < LADDER.weeklyWeeks * 7 * 86400 && !seen.w.has(wb)) { seen.w.add(wb); keep = true; }
    if (curMonth - mb < LADDER.monthlyMonths && !seen.m.has(mb)) { seen.m.add(mb); keep = true; }
    if (!keep) victims.push(name);
  });
  return victims;
}
function pruneLadder(dir) {
  if (!existsSync(dir)) return 0;
  const victims = ladderVictims(dir, Math.floor(Date.now() / 1000));
  for (const v of victims) { rmSync(join(dir, v), { force: true }); rmSync(join(dir, `${v}.json`), { force: true }); }
  for (const n of readdirSync(dir)) if (n.startsWith(".tmp-")) { // a crashed run's leftovers
    try { if (Date.now() - statSync(join(dir, n)).mtimeMs > 3600e3) rmSync(join(dir, n), { force: true }); } catch {}
  }
  return victims.length;
}

const copyReady = () => existsSync(COPY) && existsSync(join(COPY, ".notes-backup-target"));

async function once() {
  const started = Date.now();
  const dbDir = join(BACKUPS, "db");
  mkdirSync(dbDir, { recursive: true });
  const { stdout } = await run("node", ["/app/tools/db-snapshot.mjs", "--out", dbDir, "--kind", "light", "--label", "sidecar"], {
    env: process.env, maxBuffer: 1 << 20,
  });
  const manifest = JSON.parse(stdout.trim().split("\n").pop());
  const file = join(dbDir, manifest.file);
  const onDrive = await sha256(file);
  if (onDrive !== manifest.sha256) {
    rmSync(file, { force: true }); rmSync(`${file}.json`, { force: true });
    throw new Error(`${manifest.file} on the drive does not match its recorded checksum; removed`);
  }
  let secondCopy = "not configured";
  if (copyReady()) {
    const cdir = join(COPY, "db");
    mkdirSync(cdir, { recursive: true });
    const tmp = join(cdir, `.tmp-${manifest.file}`);
    try {
      copyFileSync(file, tmp);
      if ((await sha256(tmp)) !== manifest.sha256) throw new Error("checksum mismatch on the second drive");
      renameSync(tmp, join(cdir, manifest.file));
      copyFileSync(`${file}.json`, join(cdir, `${manifest.file}.json`));
      secondCopy = "ok";
    } catch (e) {
      rmSync(tmp, { force: true });
      secondCopy = `FAILED: ${e.message}`;
    }
  } else if (existsSync(COPY)) {
    secondCopy = "FAILED (target missing its .notes-backup-target marker or not mounted)";
  }
  const pruned = pruneLadder(dbDir) + (secondCopy === "ok" ? pruneLadder(join(COPY, "db")) : 0);
  const status = {
    at: ts(), kind: "light", by: "sidecar", file: manifest.file, bytes: manifest.bytes, sha256: manifest.sha256,
    secondCopy, pruned, tookMs: Date.now() - started,
  };
  writeStatus("last-snapshot", status);
  return status;
}

let failures = 0;
async function tick() {
  try {
    const s = await once();
    failures = 0;
    log(`snapshot ${s.file} (${s.bytes} bytes, integrity ok) second copy: ${s.secondCopy}${s.pruned ? `, pruned ${s.pruned}` : ""}`);
    if (s.secondCopy.startsWith("FAILED")) warn(`second copy ${s.secondCopy}`);
    writeStatus("sidecar", { at: ts(), ok: !s.secondCopy.startsWith("FAILED"), failures, nextDueAt: new Date(Date.now() + INTERVAL * 1000).toISOString(), last: s.file });
  } catch (e) {
    failures += 1;
    warn(`snapshot failed (${failures} in a row): ${e.message}`);
    writeStatus("sidecar", { at: ts(), ok: false, failures, error: e.message, nextDueAt: new Date(Date.now() + INTERVAL * 1000).toISOString() });
  }
}

log(`backup sidecar: every ${INTERVAL} s into ${BACKUPS}/db, second copy ${copyReady() ? "to " + COPY + "/db" : "not available at start (" + COPY + ")"}; ladder all ${LADDER.allHours}h / hourly ${LADDER.hourlyHours}h / daily ${LADDER.dailyDays}d / weekly ${LADDER.weeklyWeeks}w / monthly ${LADDER.monthlyMonths}m`);
let stopping = false;
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => { stopping = true; log(`${sig}: stopping after the current run`); });
while (!stopping) {
  await tick();
  const until = Date.now() + INTERVAL * 1000;
  while (!stopping && Date.now() < until) await new Promise((r) => setTimeout(r, 1000));
}
process.exit(0);
