import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { type ErrorCode, JobId, newId, UPLOAD_LIMITS } from "@notes/schema";
import type { Db } from "../../db/client.js";
import { AppError } from "../../http/errors.js";
import {
  originalPath,
  pageImagePath,
  pagesDir,
  type QueueState,
  queueDir,
  resolveInside,
  type Storage,
} from "../../storage/storage.js";
import { type FileRow, iso, type JobRow, recomputeStatus } from "./model.js";
import {
  type ConverterFailureCode,
  DoneResult,
  FailedResult,
  MAX_IMAGE_BYTES,
  MAX_RESULT_BYTES,
  writeJobFile,
} from "./protocol.js";

export interface QueueOptions {
  /** A job the converter has not picked up after this long fails. */
  pickupTimeoutMs: number;
  /** A job picked up but not finished after this long fails. */
  processingTimeoutMs: number;
  /** A result file modified less than this long ago may still be mid-write; it is left for the next pass. */
  partialGraceMs: number;
  /** Heartbeat older than this reads "stale"; several times older, "offline". */
  heartbeatStaleMs: number;
}

export const DEFAULT_QUEUE_OPTIONS: QueueOptions = {
  pickupTimeoutMs: 15 * 60_000,
  processingTimeoutMs: 45 * 60_000,
  partialGraceMs: 2_000,
  heartbeatStaleMs: 30_000,
};

export interface QueueContext {
  db: Db;
  now: () => number;
  storage: () => Storage;
  options: QueueOptions;
  log: (message: string) => void;
}

export interface ProcessSummary {
  ingested: number;
  failed: number;
  ignored: number;
  timedOut: number;
}

export interface ConverterStatus {
  /** "online" with a fresh heartbeat, "stale" when it is late, "offline" when missing or long overdue. */
  state: "online" | "stale" | "offline";
  lastSeenAt: string | null;
  ageSeconds: number | null;
  /** Jobs waiting in queue/pending and being worked in queue/processing. */
  queued: number;
  processing: number;
  /** The heartbeat's own fields (flat values only), if it parsed. */
  heartbeat: Record<string, string | number | boolean | null> | null;
}

const RESULT_NAME = /^(job_[0-9A-HJKMNP-TV-Z]{26})\.json$/;

function listNames(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function removeQuietly(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // already gone
  }
}

function describe(code: ErrorCode): string {
  switch (code) {
    case "unsupported_type":
      return "The converter could not read this type of file.";
    case "encrypted_file":
      return "The file is password protected. Remove the password and upload it again.";
    case "corrupt_file":
      return "The file appears to be damaged.";
    case "too_many_pages":
      return `The file has more than ${UPLOAD_LIMITS.maxPages} pages or slides.`;
    case "too_large":
      return "The file is too large to convert.";
    default:
      return "The file could not be converted.";
  }
}

export function createQueue(ctx: QueueContext) {
  const { db, now } = ctx;
  const o = ctx.options;

  const fileById = db.prepare("SELECT * FROM source_files WHERE id = ?");
  const jobById = db.prepare("SELECT * FROM conversion_jobs WHERE id = ?");

  /** Record a new job for a file and write its queue file. Throws if the file cannot be queued. */
  function enqueue(file: FileRow): string {
    const storage = ctx.storage();
    if (!existsSync(originalPath(storage, file.user_id, file.sha256))) {
      throw new AppError("storage_unavailable", "The stored original is missing.", {
        hint: "Upload the file again.",
      });
    }
    const t = now();
    const jobId = newId("job", t);
    const attempt = (
      db.prepare("SELECT COUNT(*) AS n FROM conversion_jobs WHERE file_id = ?").get(file.id) as {
        n: number;
      }
    ).n;
    db.transaction(() => {
      db.prepare(
        `INSERT INTO conversion_jobs (id, file_id, user_id, sha256, state, attempt, created_at)
         VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
      ).run(jobId, file.id, file.user_id, file.sha256, attempt, t);
      db.prepare(
        `UPDATE source_files SET status = 'converting', error_code = NULL, error_message = NULL,
           page_count = NULL, updated_at = ? WHERE id = ?`,
      ).run(t, file.id);
    })();
    try {
      writeJobFile(storage, {
        jobId,
        userId: file.user_id,
        fileId: file.id,
        sha256: file.sha256,
        createdAt: iso(t),
        attempt,
      });
    } catch (error) {
      db.transaction(() => {
        db.prepare(
          "UPDATE conversion_jobs SET state = 'failed', finished_at = ?, error = ? WHERE id = ?",
        ).run(t, "could not write the queue file", jobId);
        db.prepare("UPDATE source_files SET status = ?, updated_at = ? WHERE id = ?").run(
          file.status === "failed" ? "failed" : "uploaded",
          t,
          file.id,
        );
      })();
      throw error;
    }
    return jobId;
  }

  function removeImages(file: { user_id: string; id: string }): void {
    try {
      rmSync(pagesDir(ctx.storage(), file.user_id, file.id), { recursive: true, force: true });
    } catch (error) {
      ctx.log(`could not remove page images of ${file.id}: ${String(error)}`);
    }
  }

  function removeQueueFiles(jobId: string): void {
    const storage = ctx.storage();
    for (const state of ["pending", "processing"] as const) {
      removeQuietly(resolveInside(queueDir(storage, state), `${jobId}.json`));
    }
  }

  /** Fail one job and, if the file is still waiting on it, the file too. */
  function failJob(
    job: JobRow,
    code: ErrorCode,
    message: string,
    state: "failed" | "timed_out" = "failed",
  ): void {
    const t = now();
    const clean = message.replace(/\s+/g, " ").trim().slice(0, 500);
    db.transaction(() => {
      db.prepare(
        "UPDATE conversion_jobs SET state = ?, finished_at = ?, error = ? WHERE id = ?",
      ).run(state, t, `${code}: ${clean}`, job.id);
      db.prepare(
        `UPDATE source_files SET status = 'failed', error_code = ?, error_message = ?, updated_at = ?
         WHERE id = ? AND status = 'converting'`,
      ).run(code, clean || describe(code), t, job.file_id);
    })();
    removeImages({ user_id: job.user_id, id: job.file_id });
  }

  /** Check the page images the converter says it wrote, and return their sizes by index. */
  function checkImages(job: JobRow, pageCount: number): Map<number, number> {
    const storage = ctx.storage();
    const sizes = new Map<number, number>();
    for (const size of ["page", "thumb"] as const) {
      const first = pageImagePath(storage, job.user_id, job.file_id, 1, size);
      const dir = first.slice(0, first.lastIndexOf("/"));
      const names = listNames(dir).filter((name) => /^\d{4}\.webp$/.test(name));
      if (names.length !== pageCount) {
        throw new Error(
          `${size} images on disk (${names.length}) do not match pageCount (${pageCount})`,
        );
      }
      for (let index = 1; index <= pageCount; index++) {
        const path = pageImagePath(storage, job.user_id, job.file_id, index, size);
        let stat: ReturnType<typeof lstatSync>;
        try {
          stat = lstatSync(path);
        } catch {
          throw new Error(`missing ${size} image ${index}`);
        }
        if (!stat.isFile() || stat.size < 1 || stat.size > MAX_IMAGE_BYTES) {
          throw new Error(`${size} image ${index} is not a sane file`);
        }
        if (size === "page") sizes.set(index, stat.size);
      }
    }
    return sizes;
  }

  function acceptDone(job: JobRow, raw: unknown): void {
    const parsed = DoneResult.safeParse(raw);
    if (!parsed.success)
      throw new Error(`result does not match the protocol: ${parsed.error.message}`);
    const result = parsed.data;
    if (result.jobId !== job.id) throw new Error("result jobId does not match its file name");
    if (result.fileId !== job.file_id) throw new Error("result fileId does not match the job");
    const file = fileById.get(job.file_id) as FileRow | undefined;
    if (!file) throw new Error("file no longer exists");
    if (result.type !== file.type) {
      throw new Error(`converter reports type ${result.type}, upload was ${file.type}`);
    }
    if (result.pageCount > UPLOAD_LIMITS.maxPages) {
      failJob(job, "too_many_pages", describe("too_many_pages"));
      return;
    }
    if (result.pages.length !== result.pageCount)
      throw new Error("pages list does not match pageCount");
    result.pages.forEach((page, i) => {
      if (page.index !== i + 1) throw new Error("page indexes must run 1, 2, 3 …");
    });
    const sizes = checkImages(job, result.pageCount);
    const t = now();
    db.transaction(() => {
      db.prepare("DELETE FROM pages WHERE file_id = ?").run(file.id);
      const insert = db.prepare(
        `INSERT INTO pages (id, file_id, user_id, idx, width, height, image_bytes, has_text_layer,
           native_text, speaker_notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const page of result.pages) {
        insert.run(
          newId("page", t),
          file.id,
          file.user_id,
          page.index,
          page.width,
          page.height,
          sizes.get(page.index) ?? page.bytes,
          page.hasTextLayer ? 1 : 0,
          page.nativeText,
          page.speakerNotes,
        );
      }
      db.prepare(
        `UPDATE source_files SET status = 'converted', page_count = ?, error_code = NULL,
           error_message = NULL, updated_at = ? WHERE id = ?`,
      ).run(result.pageCount, t, file.id);
      db.prepare("UPDATE conversion_jobs SET state = 'done', finished_at = ? WHERE id = ?").run(
        t,
        job.id,
      );
      recomputeStatus(db, file.id, t);
    })();
  }

  function acceptFailed(job: JobRow, raw: unknown): void {
    const parsed = FailedResult.safeParse(raw);
    if (!parsed.success)
      throw new Error(`result does not match the protocol: ${parsed.error.message}`);
    const result = parsed.data;
    if (result.jobId !== job.id || result.fileId !== job.file_id) {
      throw new Error("result ids do not match the job");
    }
    const code: ConverterFailureCode = result.errorCode;
    failJob(job, code, result.message || describe(code));
  }

  /** One pass over the queue directories. Safe to call as often as wanted. */
  function process(): ProcessSummary {
    const storage = ctx.storage();
    const summary: ProcessSummary = { ingested: 0, failed: 0, ignored: 0, timedOut: 0 };

    // Which jobs has the converter picked up?
    for (const name of listNames(queueDir(storage, "processing"))) {
      const m = RESULT_NAME.exec(name);
      if (!m?.[1]) continue;
      db.prepare(
        "UPDATE conversion_jobs SET state = 'processing', started_at = ? WHERE id = ? AND state = 'pending'",
      ).run(now(), m[1]);
    }

    for (const state of ["done", "failed"] as const satisfies QueueState[]) {
      const dir = queueDir(storage, state);
      for (const name of listNames(dir)) {
        const m = RESULT_NAME.exec(name);
        const jobId = m?.[1];
        if (!jobId || !JobId.safeParse(jobId).success) {
          summary.ignored++;
          continue;
        }
        const path = resolveInside(dir, name);
        let stat: ReturnType<typeof lstatSync>;
        try {
          stat = lstatSync(path);
        } catch {
          continue;
        }
        if (!stat.isFile()) {
          removeQuietly(path);
          summary.ignored++;
          continue;
        }
        if (o.partialGraceMs > 0 && now() - stat.mtimeMs < o.partialGraceMs) continue;

        const job = jobById.get(jobId) as JobRow | undefined;
        if (!job || (job.state !== "pending" && job.state !== "processing")) {
          ctx.log(`ignoring result for unknown or finished job ${jobId}`);
          removeQuietly(path);
          summary.ignored++;
          continue;
        }

        try {
          if (stat.size > MAX_RESULT_BYTES) throw new Error("result file is too large");
          let raw: unknown;
          try {
            raw = JSON.parse(readFileSync(path, "utf8"));
          } catch {
            throw new Error("result file is not valid JSON");
          }
          const wantOk = state === "done";
          if ((raw as { ok?: unknown } | null)?.ok !== wantOk) {
            throw new Error(`a ${state} result must have ok: ${wantOk}`);
          }
          if (wantOk) acceptDone(job, raw);
          else acceptFailed(job, raw);
          const after = jobById.get(jobId) as JobRow;
          if (after.state === "done") summary.ingested++;
          else summary.failed++;
        } catch (error) {
          ctx.log(`rejected result for ${jobId}: ${String(error)}`);
          failJob(
            job,
            "conversion_failed",
            "The converter returned a result that could not be used. Try again.",
          );
          summary.failed++;
        }
        removeQuietly(path);
      }
    }

    // Jobs nobody is working on, or that never finished.
    const t = now();
    const active = db
      .prepare("SELECT * FROM conversion_jobs WHERE state IN ('pending', 'processing')")
      .all() as JobRow[];
    for (const job of active) {
      const waiting = job.state === "pending";
      const since = waiting ? job.created_at : (job.started_at ?? job.created_at);
      const limit = waiting ? o.pickupTimeoutMs : o.processingTimeoutMs;
      if (t - since < limit) continue;
      removeQueueFiles(job.id);
      failJob(
        job,
        "conversion_failed",
        waiting
          ? "The converter did not pick this file up in time. It may be offline; try again later."
          : "The converter took too long on this file.",
        "timed_out",
      );
      summary.timedOut++;
    }
    return summary;
  }

  function count(state: QueueState): number {
    return listNames(queueDir(ctx.storage(), state)).filter((n) => RESULT_NAME.test(n)).length;
  }

  function status(): ConverterStatus {
    const storage = ctx.storage();
    const path = resolveInside(storage.root, "queue", "heartbeat");
    let mtime: number | null = null;
    let heartbeat: ConverterStatus["heartbeat"] = null;
    try {
      const stat = statSync(path);
      if (stat.isFile()) {
        mtime = stat.mtimeMs;
        if (stat.size <= 65_536) {
          const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
          if (raw && typeof raw === "object" && !Array.isArray(raw)) {
            heartbeat = {};
            for (const [key, value] of Object.entries(raw).slice(0, 20)) {
              if (
                value === null ||
                typeof value === "number" ||
                typeof value === "boolean" ||
                typeof value === "string"
              ) {
                heartbeat[key.slice(0, 40)] =
                  typeof value === "string" ? value.slice(0, 200) : value;
              }
            }
          }
        }
      }
    } catch {
      // missing or unreadable heartbeat: offline unless mtime was read
    }
    const age = mtime === null ? null : Math.max(0, now() - mtime);
    const state: ConverterStatus["state"] =
      age === null || age > o.heartbeatStaleMs * 10
        ? "offline"
        : age > o.heartbeatStaleMs
          ? "stale"
          : "online";
    return {
      state,
      lastSeenAt: mtime === null ? null : iso(mtime),
      ageSeconds: age === null ? null : Math.round(age / 1000),
      queued: count("pending"),
      processing: count("processing"),
      heartbeat,
    };
  }

  return { enqueue, process, status, removeImages, removeQueueFiles };
}

export type Queue = ReturnType<typeof createQueue>;
