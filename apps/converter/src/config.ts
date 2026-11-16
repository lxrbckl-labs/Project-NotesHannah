const MiB = 1024 * 1024;

function num(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`bad environment value ${name}=${raw}`);
  return n;
}

/**
 * Limits enforced during one conversion. maxInputBytes and maxPages mirror the schema's
 * UPLOAD_LIMITS (a test keeps them in step). Every value can be lowered or raised by environment.
 */
export function loadLimits(env: NodeJS.ProcessEnv = process.env) {
  return {
    maxInputBytes: num(env, "MAX_INPUT_BYTES", 200 * MiB),
    maxPages: num(env, "MAX_PAGES", 500),
    maxZipUncompressedBytes: num(env, "MAX_ZIP_UNCOMPRESSED_BYTES", 600 * MiB),
    maxZipEntries: num(env, "MAX_ZIP_ENTRIES", 10_000),
    maxXmlEntryBytes: num(env, "MAX_XML_ENTRY_BYTES", 32 * MiB),
    maxPixelsPerImage: num(env, "MAX_PIXELS", 120_000_000),
    /** Wall clock for one whole conversion, in milliseconds. */
    wallClockMs: num(env, "WALL_CLOCK_MS", 600_000),
    pageLongEdge: num(env, "PAGE_LONG_EDGE", 1568),
    thumbLongEdge: num(env, "THUMB_LONG_EDGE", 320),
    webpQuality: num(env, "WEBP_QUALITY", 80),
    renderConcurrency: num(env, "RENDER_CONCURRENCY", 2),
  };
}
export type Limits = ReturnType<typeof loadLimits>;

/** Names of the environment variables the conversion child needs (everything else is withheld from it). */
export const LIMIT_ENV_NAMES = [
  "MAX_INPUT_BYTES",
  "MAX_PAGES",
  "MAX_ZIP_UNCOMPRESSED_BYTES",
  "MAX_ZIP_ENTRIES",
  "MAX_XML_ENTRY_BYTES",
  "MAX_PIXELS",
  "WALL_CLOCK_MS",
  "PAGE_LONG_EDGE",
  "THUMB_LONG_EDGE",
  "WEBP_QUALITY",
  "RENDER_CONCURRENCY",
] as const;

export interface WorkerConfig {
  dataDir: string;
  pollMs: number;
  heartbeatMs: number;
  /** A job file that fails to parse is only called malformed once it is at least this old (ms). */
  settleMs: number;
  /** A job may be started this many times in total (first run plus one retry after a crash). */
  maxAttempts: number;
  /** Peak resident memory of one conversion (child plus its tools) before it is killed, in bytes. */
  childRssBytes: number;
  /** Extra time the parent allows beyond the child's own wall clock before it kills the child. */
  killGraceMs: number;
  limits: Limits;
}

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const limits = loadLimits(env);
  return {
    dataDir: env.DATA_DIR && env.DATA_DIR !== "" ? env.DATA_DIR : "/data",
    pollMs: num(env, "POLL_MS", 1000),
    heartbeatMs: num(env, "HEARTBEAT_MS", 5000),
    settleMs: num(env, "SETTLE_MS", 2000),
    maxAttempts: num(env, "MAX_ATTEMPTS", 2),
    childRssBytes: num(env, "CHILD_RSS_MB", 2048) * MiB,
    killGraceMs: num(env, "KILL_GRACE_MS", 15_000),
    limits,
  };
}
