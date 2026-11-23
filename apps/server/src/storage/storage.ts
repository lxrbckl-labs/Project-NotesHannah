import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { idKind } from "@notes/schema";
import { AppError } from "../http/errors.js";

/**
 * Storage for originals and page images lives on an external drive in
 * production. If the drive is not mounted, its mount point is an empty
 * directory (or missing), and writing there would silently fill the internal
 * disk and "lose" the files when the drive comes back. So the data directory
 * must carry a marker file, written once by `admin init-storage`, and the
 * server refuses to start without it. Nothing here ever creates DATA_DIR
 * implicitly.
 *
 * Layout (split at the top level so the converter container can mount
 * originals read-only and pages read-write):
 *   <DATA_DIR>/.notes-storage                          marker (JSON)
 *   <DATA_DIR>/originals/<userId>/<sha256>             uploads, stored once by content hash, never modified
 *   <DATA_DIR>/pages/<userId>/<fileId>/0001.webp       page images
 *   <DATA_DIR>/pages/<userId>/<fileId>/thumbs/0001.webp
 *   <DATA_DIR>/queue/{pending,processing,done,failed}/ conversion job files
 *   <DATA_DIR>/tmp/                                    upload staging (same filesystem: atomic rename)
 * `init-storage` creates the top-level directories; per-user and per-file
 * directories are created on demand with `ensureDir`.
 */
export const STORAGE_MARKER = ".notes-storage";

export const QUEUE_STATES = ["pending", "processing", "done", "failed"] as const;
export type QueueState = (typeof QUEUE_STATES)[number];

/** Directories `init-storage` creates, relative to DATA_DIR. */
export const TOP_LEVEL_DIRS = [
  "originals",
  "pages",
  ...QUEUE_STATES.map((state) => `queue/${state}`),
  "tmp",
] as const;

export interface StorageMarker {
  app: "project-noteshannah";
  storageId: string;
  createdAt: string;
  version: 1;
}

export interface Storage {
  /** Absolute, symlink-resolved root. */
  root: string;
  marker: StorageMarker;
}

const MOUNT_HINT =
  "If the data directory is on an external drive, check that the drive is mounted " +
  "(and, in Docker, bind-mounted into the container). For a brand-new install run " +
  "`admin init-storage` once.";

function unavailable(message: string): AppError {
  return new AppError("storage_unavailable", message, { hint: MOUNT_HINT });
}

function parseMarker(raw: string): StorageMarker | null {
  try {
    const value = JSON.parse(raw) as Partial<StorageMarker>;
    if (
      value &&
      value.app === "project-noteshannah" &&
      typeof value.storageId === "string" &&
      value.storageId.length > 0 &&
      typeof value.createdAt === "string"
    ) {
      return {
        app: value.app,
        storageId: value.storageId,
        createdAt: value.createdAt,
        version: 1,
      };
    }
  } catch {
    // fall through
  }
  return null;
}

/**
 * Check that DATA_DIR exists and holds a valid marker. Throws
 * `storage_unavailable` otherwise. Never creates anything.
 */
export function openStorage(dataDir: string): Storage {
  const dir = resolve(dataDir);
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(dir);
  } catch {
    throw unavailable(`Storage directory ${dir} does not exist.`);
  }
  if (!stat.isDirectory()) throw unavailable(`Storage path ${dir} is not a directory.`);
  const markerPath = join(dir, STORAGE_MARKER);
  let raw: string;
  try {
    raw = readFileSync(markerPath, "utf8");
  } catch {
    throw unavailable(`Storage marker ${markerPath} is missing; the drive may not be mounted.`);
  }
  const marker = parseMarker(raw);
  if (!marker) throw unavailable(`Storage marker ${markerPath} is not valid.`);
  return { root: realpathSync(dir), marker };
}

/** Cheap re-check for long-running work: is the marker still there? */
export function assertStorageAvailable(storage: Storage): void {
  if (!existsSync(join(storage.root, STORAGE_MARKER))) {
    throw unavailable("The storage drive is no longer available.");
  }
}

export interface InitStorageOptions {
  /** Create DATA_DIR itself if it is missing (never do this for a drive mount point). */
  createDir?: boolean;
  /** Initialise even if the directory already holds files. */
  force?: boolean;
  now?: () => number;
}

export type InitStorageResult =
  | { status: "created"; storage: Storage }
  | { status: "exists"; storage: Storage; restored: string[] };

/**
 * Write the marker and the top-level layout. When the marker already exists the marker is left alone
 * and any missing top-level directory is made again (`restored` names them): after the folders are
 * moved away for a reset, the converter's mounts need them back before it can start.
 */
export function initStorage(dataDir: string, options: InitStorageOptions = {}): InitStorageResult {
  const dir = resolve(dataDir);
  if (!existsSync(dir)) {
    if (!options.createDir) {
      throw unavailable(
        `Storage directory ${dir} does not exist. Mount the drive, or pass --create-dir to create a local directory.`,
      );
    }
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  if (!statSync(dir).isDirectory()) throw unavailable(`Storage path ${dir} is not a directory.`);
  if (existsSync(join(dir, STORAGE_MARKER))) {
    const restored: string[] = [];
    for (const top of TOP_LEVEL_DIRS) {
      if (existsSync(join(dir, top))) continue;
      mkdirSync(join(dir, top), { recursive: true, mode: 0o700 });
      restored.push(top);
    }
    return { status: "exists", storage: openStorage(dir), restored };
  }
  const entries = readdirSync(dir).filter((name) => name !== ".DS_Store");
  if (entries.length > 0 && !options.force) {
    throw new AppError(
      "conflict",
      `Storage directory ${dir} is not empty and has no marker (found: ${entries.slice(0, 5).join(", ")}).`,
      { hint: "Check the path. Pass --force to initialize it anyway." },
    );
  }
  for (const top of TOP_LEVEL_DIRS) mkdirSync(join(dir, top), { recursive: true, mode: 0o700 });
  const marker: StorageMarker = {
    app: "project-noteshannah",
    storageId: randomUUID(),
    createdAt: new Date((options.now ?? Date.now)()).toISOString(),
    version: 1,
  };
  // "wx": fail rather than overwrite if a marker appeared concurrently.
  writeFileSync(join(dir, STORAGE_MARKER), `${JSON.stringify(marker, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  return { status: "created", storage: openStorage(dir) };
}

// ---------------------------------------------------------------------------
// Path helpers. Every path under the storage root is built here, from
// validated segments, and checked to resolve inside the root.
// ---------------------------------------------------------------------------

/** One file or directory name: no separators, no "." or "..", no control characters. */
const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const SHA256 = /^[0-9a-f]{64}$/;

export function isSafeSegment(segment: string): boolean {
  return SEGMENT.test(segment) && !segment.includes("..");
}

function assertSegment(segment: string): void {
  if (!isSafeSegment(segment)) {
    throw new AppError("invalid_input", `Unsafe path segment: ${JSON.stringify(segment)}`);
  }
}

/** Join validated segments under the root; throws if the result would leave it. */
export function resolveInside(root: string, ...segments: string[]): string {
  for (const segment of segments) assertSegment(segment);
  const target = resolve(root, ...segments);
  const rel = relative(root, target);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel) || rel.split(sep).includes("..")) {
    throw new AppError("invalid_input", "Path escapes the storage directory.");
  }
  return target;
}

function assertId(value: string, kind: "user" | "file"): void {
  if (typeof value !== "string" || idKind(value) !== kind) {
    throw new AppError("invalid_input", `Not a ${kind} ID: ${JSON.stringify(value)}`);
  }
}

function assertSha256(value: string): void {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new AppError(
      "invalid_input",
      "Expected a lower-case hex SHA-256 digest (64 characters).",
    );
  }
}

/** Directory holding one user's originals. */
export function originalsDir(storage: Storage, userId: string): string {
  assertId(userId, "user");
  return resolveInside(storage.root, "originals", userId);
}

/** One stored original, named by the SHA-256 of its content. */
export function originalPath(storage: Storage, userId: string, sha256: string): string {
  assertId(userId, "user");
  assertSha256(sha256);
  return resolveInside(storage.root, "originals", userId, sha256);
}

/** Directory holding the page images of one file. */
export function pagesDir(storage: Storage, userId: string, fileId: string): string {
  assertId(userId, "user");
  assertId(fileId, "file");
  return resolveInside(storage.root, "pages", userId, fileId);
}

export const MAX_PAGE_INDEX = 9999;

/** `pages/<userId>/<fileId>/0001.webp`, or `.../thumbs/0001.webp` for size "thumb". Index is 1-based. */
export function pageImagePath(
  storage: Storage,
  userId: string,
  fileId: string,
  index: number,
  size: "page" | "thumb",
): string {
  if (!Number.isInteger(index) || index < 1 || index > MAX_PAGE_INDEX) {
    throw new AppError("invalid_input", `Page index must be 1 to ${MAX_PAGE_INDEX}.`);
  }
  if (size !== "page" && size !== "thumb") {
    throw new AppError("invalid_input", 'Size must be "page" or "thumb".');
  }
  assertId(userId, "user");
  assertId(fileId, "file");
  const name = `${String(index).padStart(4, "0")}.webp`;
  return size === "thumb"
    ? resolveInside(storage.root, "pages", userId, fileId, "thumbs", name)
    : resolveInside(storage.root, "pages", userId, fileId, name);
}

/** A conversion queue directory. */
export function queueDir(storage: Storage, state: QueueState): string {
  if (!(QUEUE_STATES as readonly string[]).includes(state)) {
    throw new AppError("invalid_input", `Unknown queue state: ${JSON.stringify(state)}`);
  }
  return resolveInside(storage.root, "queue", state);
}

/** Upload staging directory (same filesystem as originals, so a rename is atomic). */
export function tmpDir(storage: Storage): string {
  return resolveInside(storage.root, "tmp");
}

/**
 * Create a directory under the root on demand (e.g. `originalsDir(...)` or
 * `pagesDir(...)` before the first write). Every component from the root down
 * must be a plain directory: a planted symbolic link is refused, so writes
 * can never be redirected outside the root.
 */
export function ensureDir(storage: Storage, dir: string): string {
  assertStorageAvailable(storage);
  const rel = relative(storage.root, dir);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new AppError("invalid_input", "Path escapes the storage directory.");
  }
  let current = storage.root;
  for (const segment of rel.split(sep)) {
    assertSegment(segment);
    current = join(current, segment);
    if (existsSync(current) || isDanglingLink(current)) {
      const stat = lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw unavailable(`Storage path ${current} is not a plain directory.`);
      }
    } else {
      mkdirSync(current, { mode: 0o700 });
    }
  }
  return dir;
}

function isDanglingLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}
