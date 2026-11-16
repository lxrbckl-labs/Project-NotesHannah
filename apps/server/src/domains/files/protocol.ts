import { randomUUID } from "node:crypto";
import { renameSync, writeFileSync } from "node:fs";
import { FileId, FileType, JobId } from "@notes/schema";
import { z } from "zod";
import { ensureDir, queueDir, resolveInside, type Storage } from "../../storage/storage.js";

/**
 * The hand-off to the converter container: JSON files on the shared volume.
 * The converter is untrusted input, so everything it writes is validated here.
 */

export interface JobFile {
  jobId: string;
  userId: string;
  fileId: string;
  sha256: string;
  createdAt: string;
  attempt: number;
}

/** Write `queue/pending/<jobId>.json` through a temporary name in the same directory, then rename. */
export function writeJobFile(storage: Storage, job: JobFile): void {
  const dir = ensureDir(storage, queueDir(storage, "pending"));
  const finalPath = resolveInside(dir, `${job.jobId}.json`);
  const tempPath = resolveInside(dir, `tmp-${randomUUID()}.part`);
  writeFileSync(tempPath, `${JSON.stringify(job)}\n`, { mode: 0o644 });
  renameSync(tempPath, finalPath);
}

/** Largest image the converter may produce for one page. */
export const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
/** Largest result file that is read at all. */
export const MAX_RESULT_BYTES = 64 * 1024 * 1024;
export const MAX_PIXELS = 20_000;
const MAX_TEXT = 200_000;

export const ConverterFailureCode = z.enum([
  "unsupported_type",
  "encrypted_file",
  "corrupt_file",
  "too_many_pages",
  "too_large",
  "conversion_failed",
]);
export type ConverterFailureCode = z.infer<typeof ConverterFailureCode>;

const PageResult = z.object({
  index: z.number().int().min(1).max(9999),
  width: z.number().int().min(1).max(MAX_PIXELS),
  height: z.number().int().min(1).max(MAX_PIXELS),
  bytes: z.number().int().min(1).max(MAX_IMAGE_BYTES),
  hasTextLayer: z.boolean(),
  nativeText: z.string().max(MAX_TEXT).nullable(),
  speakerNotes: z.string().max(MAX_TEXT).nullable(),
});

export const DoneResult = z.object({
  jobId: JobId,
  fileId: FileId,
  ok: z.literal(true),
  type: FileType,
  pageCount: z.number().int().min(1).max(9999),
  pages: z.array(PageResult).max(9999),
  toolVersions: z.record(z.string(), z.unknown()).optional(),
  timings: z.record(z.string(), z.unknown()).optional(),
  warnings: z.array(z.unknown()).optional(),
});
export type DoneResult = z.infer<typeof DoneResult>;

export const FailedResult = z.object({
  jobId: JobId,
  fileId: FileId,
  ok: z.literal(false),
  errorCode: ConverterFailureCode,
  message: z.string().max(5000),
});
export type FailedResult = z.infer<typeof FailedResult>;
