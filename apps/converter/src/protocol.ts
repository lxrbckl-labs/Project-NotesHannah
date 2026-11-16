import type { ConvertErrorCode } from "./errors.js";
import { FILE_ID, JOB_ID, SHA256, USER_ID } from "./ids.js";

/** FileType values the converter produces (mirrors the schema's FileType). */
export type ConvertedType = "pdf" | "pptx" | "jpeg" | "png" | "heic";

/** queue/pending/<jobId>.json, written by the server. `attempts` is added by the converter. */
export interface JobFile {
  jobId: string;
  userId: string;
  fileId: string;
  sha256: string;
  createdAt: string;
  attempts?: number;
}

export interface DonePage {
  index: number;
  width: number;
  height: number;
  bytes: number;
  hasTextLayer: boolean;
  nativeText: string | null;
  speakerNotes: string | null;
}

/** queue/done/<jobId>.json */
export interface DoneResult {
  jobId: string;
  fileId: string;
  ok: true;
  type: ConvertedType;
  pageCount: number;
  pages: DonePage[];
  toolVersions: Record<string, string>;
  /** Milliseconds: the pipeline's stages plus `total` (child wall time), `queueWait` and `elapsed` (claim to done). */
  timings: Record<string, number>;
  warnings: { code: string; message: string; page?: number }[];
  /** Sampled peak resident memory of the conversion (child plus tools), in bytes; null where not measurable. */
  peakRssBytes: number | null;
  /** Attempt number this result came from (1 for a first run). */
  attempt: number;
}

/** queue/failed/<jobId>.json */
export interface FailedResult {
  jobId: string;
  /** Null only when the job file was too broken to read a valid file id from. */
  fileId: string | null;
  ok: false;
  errorCode: ConvertErrorCode;
  message: string;
  /** Finer machine-readable tag such as timeout, pixel_bomb, decompression_bomb, legacy_office. */
  reason?: string;
  attempt: number;
  /** Milliseconds from claim to failure, present for failures during a conversion. */
  elapsedMs?: number;
}

export type JobResult = DoneResult | FailedResult;

export class InvalidJobError extends Error {
  constructor(
    message: string,
    /** The file id, when it was present and well formed. */
    public readonly fileId: string | null,
  ) {
    super(message);
    this.name = "InvalidJobError";
  }
}

/**
 * Validate a parsed job file. Every field that reaches a path must match its strict pattern, and the
 * id inside must equal the file name's id. Anything else is refused outright.
 */
export function validateJob(raw: unknown, expectedJobId: string): JobFile {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    throw new InvalidJobError("job is not an object", null);
  const o = raw as Record<string, unknown>;
  const fileId = typeof o.fileId === "string" && FILE_ID.test(o.fileId) ? o.fileId : null;
  const bad = (what: string) => new InvalidJobError(`invalid job: ${what}`, fileId);
  if (typeof o.jobId !== "string" || !JOB_ID.test(o.jobId)) throw bad("jobId");
  if (o.jobId !== expectedJobId) throw bad("jobId does not match the file name");
  if (typeof o.userId !== "string" || !USER_ID.test(o.userId)) throw bad("userId");
  if (fileId === null) throw bad("fileId");
  if (typeof o.sha256 !== "string" || !SHA256.test(o.sha256)) throw bad("sha256");
  if (typeof o.createdAt !== "string" || Number.isNaN(Date.parse(o.createdAt)))
    throw bad("createdAt");
  let attempts = 0;
  if (o.attempts !== undefined) {
    if (
      typeof o.attempts !== "number" ||
      !Number.isInteger(o.attempts) ||
      o.attempts < 0 ||
      o.attempts > 100
    )
      throw bad("attempts");
    attempts = o.attempts;
  }
  return {
    jobId: o.jobId,
    userId: o.userId,
    fileId,
    sha256: o.sha256,
    createdAt: o.createdAt,
    attempts,
  };
}
