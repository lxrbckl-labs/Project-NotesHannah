import { type FSWatcher, watch } from "node:fs";
import { lstat, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { WorkerConfig } from "./config.js";
import type { Converter } from "./converter.js";
import { ConvertError, type ConvertErrorCode, cleanMessage } from "./errors.js";
import { exists, isEnoent, mkdirp, sha256File, writeJsonAtomic } from "./fsutil.js";
import { FILE_ID, JOB_FILE, USER_ID } from "./ids.js";
import type { Logger } from "./log.js";
import {
  type DoneResult,
  type FailedResult,
  InvalidJobError,
  type JobFile,
  validateJob,
} from "./protocol.js";

const VERSION = "1.0.0";
const MAX_JOB_FILE_BYTES = 64 * 1024;

export type StepOutcome = "idle" | "done" | "failed" | "requeued";

export interface QueueDirs {
  originals: string;
  pages: string;
  pending: string;
  processing: string;
  done: string;
  failed: string;
  heartbeat: string;
}

export function queueDirs(dataDir: string): QueueDirs {
  const q = path.join(dataDir, "queue");
  return {
    originals: path.join(dataDir, "originals"),
    pages: path.join(dataDir, "pages"),
    pending: path.join(q, "pending"),
    processing: path.join(q, "processing"),
    done: path.join(q, "done"),
    failed: path.join(q, "failed"),
    heartbeat: path.join(q, "heartbeat"),
  };
}

/** Resolve a child of `root` and prove it stays inside. Defence in depth: the ids were already matched strictly. */
function within(root: string, ...parts: string[]): string {
  const p = path.resolve(root, ...parts);
  if (!p.startsWith(root + path.sep)) throw new InvalidJobError("path escapes its root", null);
  return p;
}

export class Worker {
  readonly dirs: QueueDirs;
  private stopping = false;
  private abort: AbortController | null = null;
  private wake: (() => void) | null = null;
  private readonly startedAt: string;
  private hb = {
    state: "starting" as "starting" | "idle" | "processing" | "stopping",
    currentJobId: null as string | null,
    currentSince: null as string | null,
    processed: 0,
    failed: 0,
    requeued: 0,
    lastJobId: null as string | null,
    lastFinishedAt: null as string | null,
  };

  constructor(
    private readonly cfg: WorkerConfig,
    private readonly converter: Converter,
    private readonly logger: Logger,
    private readonly now: () => number = Date.now,
  ) {
    this.dirs = queueDirs(cfg.dataDir);
    this.startedAt = new Date(now()).toISOString();
  }

  // ---------------------------------------------------------------- lifecycle

  /** Create the queue layout if missing and recover anything a previous run left behind. */
  async init(): Promise<void> {
    // originals is a read-only mount we cannot create; if it is absent the data volume is not mounted.
    const orig = await stat(this.dirs.originals).catch(() => null);
    if (!orig?.isDirectory())
      throw new Error(
        `originals directory not found at ${this.dirs.originals}; is the data volume mounted?`,
      );
    for (const d of [
      this.dirs.pending,
      this.dirs.processing,
      this.dirs.done,
      this.dirs.failed,
      this.dirs.pages,
    ])
      await mkdirp(d);
    await this.recover();
    this.hb.state = "idle";
    await this.writeHeartbeat();
  }

  /** Long-running loop: take jobs one at a time until stop() is called. */
  async run(): Promise<void> {
    const timer = setInterval(() => void this.writeHeartbeat(), this.cfg.heartbeatMs);
    timer.unref();
    let watcher: FSWatcher | null = null;
    try {
      // Event hint only: on some bind mounts events never arrive, so polling is the guarantee.
      watcher = watch(this.dirs.pending, () => this.wake?.());
      watcher.on("error", () => undefined);
    } catch {
      watcher = null;
    }
    try {
      while (!this.stopping) {
        let outcome: StepOutcome;
        try {
          outcome = await this.processNext();
        } catch (e) {
          // Infrastructure trouble (disk full, mount gone). A job left in processing/ is recovered at restart.
          this.logger.log("error", "queue step failed", { error: errText(e) });
          outcome = "idle";
        }
        if (outcome === "idle" || outcome === "requeued") await this.sleep(this.cfg.pollMs);
      }
    } finally {
      clearInterval(timer);
      watcher?.close();
      this.hb.state = "stopping";
      await this.writeHeartbeat();
    }
  }

  /** Ask the loop to finish. A running conversion is abandoned and its job goes back to pending. */
  stop(): void {
    this.stopping = true;
    this.hb.state = "stopping";
    this.abort?.abort();
    this.wake?.();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const t = setTimeout(done, ms);
      const self = this;
      function done() {
        clearTimeout(t);
        self.wake = null;
        resolve();
      }
      this.wake = done;
    });
  }

  async writeHeartbeat(): Promise<void> {
    try {
      await writeJsonAtomic(path.dirname(this.dirs.heartbeat), path.basename(this.dirs.heartbeat), {
        pid: process.pid,
        version: VERSION,
        startedAt: this.startedAt,
        updatedAt: new Date(this.now()).toISOString(),
        heartbeatMs: this.cfg.heartbeatMs,
        ...this.hb,
      });
    } catch (e) {
      this.logger.log("warn", "heartbeat write failed", { error: errText(e) });
    }
  }

  // ---------------------------------------------------------------- recovery

  private async recover(): Promise<void> {
    // Temp files from interrupted atomic writes in the directories only this worker writes.
    for (const d of [this.dirs.processing, this.dirs.done, this.dirs.failed]) {
      for (const n of await readdir(d))
        if (n.startsWith(".tmp-")) await rm(path.join(d, n), { force: true });
    }
    // Leftover staging and swap directories under pages/<userId>/.
    for (const u of await readdir(this.dirs.pages)) {
      if (!USER_ID.test(u)) continue;
      const ud = path.join(this.dirs.pages, u);
      for (const n of await readdir(ud).catch(() => [] as string[])) {
        if (/^fil_[0-9A-HJKMNP-TV-Z]{26}\.(tmp|old)-job_[0-9A-HJKMNP-TV-Z]{26}$/.test(n))
          await rm(path.join(ud, n), { recursive: true, force: true });
      }
    }
    for (const name of (await readdir(this.dirs.processing)).sort()) {
      const m = JOB_FILE.exec(name);
      if (!m) continue;
      const jobId = m[1] as string;
      const file = path.join(this.dirs.processing, name);
      if (
        (await exists(path.join(this.dirs.done, name))) ||
        (await exists(path.join(this.dirs.failed, name)))
      ) {
        await rm(file, { force: true }); // finished, only the cleanup was missing
        this.logger.log("info", "recovery: result already published", { jobId });
        continue;
      }
      let job: JobFile;
      try {
        job = validateJob(JSON.parse(await readFile(file, "utf8")), jobId);
      } catch (e) {
        await this.finishFailed(
          jobId,
          e instanceof InvalidJobError ? e.fileId : null,
          "conversion_failed",
          `unreadable job file: ${errText(e)}`,
          "invalid_job",
          0,
        );
        continue;
      }
      const attempts = job.attempts ?? 0;
      if (attempts >= this.cfg.maxAttempts) {
        this.logger.log("warn", "recovery: giving up", { jobId, attempts });
        await this.finishFailed(
          jobId,
          job.fileId,
          "conversion_failed",
          "the converter stopped unexpectedly while processing this file, twice",
          "crashed",
          attempts,
        );
      } else {
        await rename(file, path.join(this.dirs.pending, name));
        this.hb.requeued += 1;
        this.logger.log("info", "recovery: job returned to pending", { jobId, attempts });
      }
    }
  }

  // ---------------------------------------------------------------- one job

  async processNext(): Promise<StepOutcome> {
    if (this.stopping) return "idle";
    const claimed = await this.claim();
    if (!claimed) return "idle";
    const { name, jobId, claimedAt } = claimed;
    const procFile = path.join(this.dirs.processing, name);

    let job: JobFile;
    try {
      const st = await stat(procFile);
      if (st.size > MAX_JOB_FILE_BYTES) throw new InvalidJobError("job file too large", null);
      let raw: unknown;
      try {
        raw = JSON.parse(await readFile(procFile, "utf8"));
      } catch (e) {
        // A writer that did not use temp-then-rename may still be writing: give it time before calling it malformed.
        if (claimedAt - st.mtimeMs < this.cfg.settleMs) {
          await rename(procFile, path.join(this.dirs.pending, name));
          this.logger.log("debug", "job file not settled, left in pending", { jobId });
          return "requeued";
        }
        throw new InvalidJobError(`not valid JSON (${errText(e)})`, null);
      }
      job = validateJob(raw, jobId);
    } catch (e) {
      const fileId = e instanceof InvalidJobError ? e.fileId : null;
      this.logger.log("warn", "malformed job refused", { jobId, error: errText(e) });
      await this.finishFailed(jobId, fileId, "conversion_failed", errText(e), "invalid_job", 0);
      this.hb.failed += 1;
      return "failed";
    }

    const attempt = (job.attempts ?? 0) + 1;
    if (attempt > this.cfg.maxAttempts) {
      await this.finishFailed(
        jobId,
        job.fileId,
        "conversion_failed",
        "too many attempts",
        "crashed",
        attempt - 1,
      );
      this.hb.failed += 1;
      return "failed";
    }
    // Count this start before doing any work, so a crash is visible to recovery.
    await writeJsonAtomic(this.dirs.processing, name, { ...job, attempts: attempt });

    this.hb.state = "processing";
    this.hb.currentJobId = jobId;
    this.hb.currentSince = new Date(this.now()).toISOString();
    await this.writeHeartbeat();
    this.logger.log("info", "job started", {
      jobId,
      fileId: job.fileId,
      userId: job.userId,
      attempt,
    });
    try {
      return await this.execute(job, name, attempt, claimedAt);
    } finally {
      this.hb.state = this.stopping ? "stopping" : "idle";
      this.hb.currentJobId = null;
      this.hb.currentSince = null;
      this.hb.lastJobId = jobId;
      this.hb.lastFinishedAt = new Date(this.now()).toISOString();
      await this.writeHeartbeat();
    }
  }

  private async claim(): Promise<{ name: string; jobId: string; claimedAt: number } | null> {
    const names = (await readdir(this.dirs.pending)).filter((n) => JOB_FILE.test(n)).sort();
    for (const name of names) {
      try {
        // Atomic: exactly one claimant wins the rename; a half-written file never has this name.
        await rename(path.join(this.dirs.pending, name), path.join(this.dirs.processing, name));
      } catch (e) {
        if (isEnoent(e)) continue;
        throw e;
      }
      const jobId = (JOB_FILE.exec(name) as RegExpExecArray)[1] as string;
      return { name, jobId, claimedAt: this.now() };
    }
    return null;
  }

  private async execute(
    job: JobFile,
    name: string,
    attempt: number,
    claimedAt: number,
  ): Promise<StepOutcome> {
    const { jobId, userId, fileId, sha256 } = job;
    const userPages = within(this.dirs.pages, userId);
    const final = within(userPages, fileId);
    const staging = within(userPages, `${fileId}.tmp-${jobId}`);
    const fail = async (
      code: ConvertErrorCode,
      message: string,
      reason?: string,
    ): Promise<StepOutcome> => {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined);
      await this.finishFailed(
        jobId,
        fileId,
        code,
        message,
        reason,
        attempt,
        this.now() - claimedAt,
      );
      this.hb.failed += 1;
      this.logger.log("info", "job failed", { jobId, fileId, errorCode: code, reason });
      return "failed";
    };

    // The original: a regular file at the exact content-addressed path, of the right size and hash.
    const original = within(this.dirs.originals, userId, sha256);
    const st = await lstat(original).catch((e) => (isEnoent(e) ? null : Promise.reject(e)));
    if (!st?.isFile())
      return fail(
        "conversion_failed",
        "the original file is missing or is not a regular file",
        "original_missing",
      );
    if (st.size > this.cfg.limits.maxInputBytes)
      return fail(
        "too_large",
        `${st.size} bytes (limit ${this.cfg.limits.maxInputBytes})`,
        "file_too_large",
      );
    if (st.size === 0) return fail("corrupt_file", "file is empty");
    if ((await sha256File(original)) !== sha256)
      return fail(
        "conversion_failed",
        "the stored original does not match its fingerprint",
        "original_mismatch",
      );

    await rm(staging, { recursive: true, force: true });
    await mkdirp(staging);
    this.abort = new AbortController();
    try {
      if (this.stopping) throw Object.assign(new Error("aborted"), { name: "AbortError" });
      const out = await this.converter.convert(
        { jobId, inputPath: original, outDir: staging },
        this.abort.signal,
      );
      if (this.stopping) throw Object.assign(new Error("aborted"), { name: "AbortError" });
      await installPages(staging, final, jobId);
      const result: DoneResult = {
        jobId,
        fileId,
        ok: true,
        type: out.type,
        pageCount: out.pages.length,
        pages: out.pages,
        toolVersions: out.toolVersions,
        timings: {
          ...out.timings,
          queueWait: Math.max(0, claimedAt - Date.parse(job.createdAt)),
          elapsed: this.now() - claimedAt,
        },
        warnings: out.warnings,
        peakRssBytes: out.peakRssBytes,
        attempt,
      };
      await writeJsonAtomic(this.dirs.done, name, result);
      await rm(path.join(this.dirs.processing, name), { force: true });
      this.hb.processed += 1;
      this.logger.log("info", "job done", {
        jobId,
        fileId,
        type: out.type,
        pageCount: out.pages.length,
        ms: result.timings.elapsed,
      });
      return "done";
    } catch (e) {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined);
      if (this.stopping || (e instanceof Error && e.name === "AbortError")) {
        // Shutdown, not the file's fault: the attempt does not count, the job goes back to pending.
        await writeJsonAtomic(this.dirs.processing, name, { ...job, attempts: attempt - 1 });
        await rename(path.join(this.dirs.processing, name), path.join(this.dirs.pending, name));
        this.hb.requeued += 1;
        this.logger.log("info", "job returned to pending (shutdown)", { jobId });
        return "requeued";
      }
      if (e instanceof ConvertError) return fail(e.code, cleanMessage(e.message), e.reason);
      this.logger.log("error", "unexpected conversion error", { jobId, error: errText(e) });
      return fail("conversion_failed", "unexpected internal error", "internal");
    } finally {
      this.abort = null;
    }
  }

  private async finishFailed(
    jobId: string,
    fileId: string | null,
    errorCode: ConvertErrorCode,
    message: string,
    reason: string | undefined,
    attempt: number,
    elapsedMs?: number,
  ): Promise<void> {
    const name = `${jobId}.json`;
    const result: FailedResult = {
      jobId,
      fileId: fileId !== null && FILE_ID.test(fileId) ? fileId : null,
      ok: false,
      errorCode,
      message: cleanMessage(message),
      ...(reason ? { reason } : {}),
      attempt,
      ...(elapsedMs === undefined ? {} : { elapsedMs }),
    };
    await writeJsonAtomic(this.dirs.failed, name, result);
    await rm(path.join(this.dirs.processing, name), { force: true });
  }
}

/** Swap the finished staging directory into place, replacing output from an earlier attempt. */
async function installPages(staging: string, final: string, jobId: string): Promise<void> {
  const old = `${final}.old-${jobId}`;
  let hadOld = false;
  try {
    await rename(final, old);
    hadOld = true;
  } catch (e) {
    if (!isEnoent(e)) throw e;
  }
  try {
    await rename(staging, final);
  } catch (e) {
    if (hadOld) await rename(old, final).catch(() => undefined);
    throw e;
  }
  if (hadOld) await rm(old, { recursive: true, force: true });
}

function errText(e: unknown): string {
  return cleanMessage(e instanceof Error ? e.message : String(e));
}
