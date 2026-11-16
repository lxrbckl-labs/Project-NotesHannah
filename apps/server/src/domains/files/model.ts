import type { Actor, FileStatus, FileType, Page, SourceFile, Transcript } from "@notes/schema";
import type { Db } from "../../db/client.js";
import { AppError } from "../../http/errors.js";

export interface FileRow {
  id: string;
  user_id: string;
  node_id: string | null;
  original_name: string;
  sha256: string;
  bytes: number;
  type: FileType;
  status: FileStatus;
  error_code: SourceFile["errorCode"];
  error_message: string | null;
  page_count: number | null;
  uploaded_by: string;
  claimed_by: string | null;
  claimed_at: number | null;
  claim_expires_at: number | null;
  created_at: number;
  updated_at: number;
  trashed_at: number | null;
}

export interface PageRow {
  seq: number;
  id: string;
  file_id: string;
  user_id: string;
  idx: number;
  width: number;
  height: number;
  image_bytes: number;
  has_text_layer: number;
  native_text: string | null;
  speaker_notes: string | null;
  transcript_id: string | null;
}

export interface TranscriptRow {
  id: string;
  page_id: string;
  user_id: string;
  revision: number;
  text: string;
  flags: string;
  author: string;
  review_status: Transcript["reviewStatus"];
  reviewed_at: number | null;
  created_at: number;
}

export interface JobRow {
  id: string;
  file_id: string;
  user_id: string;
  sha256: string;
  state: "pending" | "processing" | "done" | "failed" | "timed_out";
  attempt: number;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  error: string | null;
}

export const iso = (ms: number): string => new Date(ms).toISOString();
const isoOrNull = (ms: number | null): string | null => (ms === null ? null : iso(ms));

export function toFile(row: FileRow, now: number): SourceFile {
  const claimActive =
    row.claimed_by !== null && row.claim_expires_at !== null && row.claim_expires_at > now;
  return {
    id: row.id,
    userId: row.user_id,
    nodeId: row.node_id,
    originalName: row.original_name,
    sha256: row.sha256,
    bytes: row.bytes,
    type: row.type,
    status: row.status,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    pageCount: row.page_count,
    uploadedBy: JSON.parse(row.uploaded_by) as Actor,
    claimedBy: claimActive && row.claimed_by ? (JSON.parse(row.claimed_by) as Actor) : null,
    claimedAt: claimActive ? isoOrNull(row.claimed_at) : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    trashedAt: isoOrNull(row.trashed_at),
  };
}

export function toPage(row: PageRow): Page {
  return {
    id: row.id,
    fileId: row.file_id,
    index: row.idx,
    width: row.width,
    height: row.height,
    hasTextLayer: row.has_text_layer === 1,
    nativeText: row.native_text,
    speakerNotes: row.speaker_notes,
    transcriptId: row.transcript_id,
  };
}

export function toTranscript(row: TranscriptRow): Transcript {
  return {
    id: row.id,
    pageId: row.page_id,
    text: row.text,
    flags: JSON.parse(row.flags) as Transcript["flags"],
    author: JSON.parse(row.author) as Actor,
    reviewStatus: row.review_status,
    reviewedAt: isoOrNull(row.reviewed_at),
    revision: row.revision,
    createdAt: iso(row.created_at),
  };
}

export function actorKey(actor: Actor): string {
  return actor.type === "user" ? `user:${actor.userId}` : `key:${actor.keyId}`;
}

export function notFoundFile(): AppError {
  return new AppError("not_found", "No such file in your inbox or library.", {
    hint: "List your files with GET /api/files.",
  });
}

export function notFoundPage(): AppError {
  return new AppError("not_found", "No such page.", {
    hint: "List a file's pages with GET /api/files/:id/pages.",
  });
}

/**
 * The file state machine, enforced in one place.
 *
 *   uploaded   --enqueue-->   converting
 *   converting --result ok--> converted     (pages recorded)
 *   converting --failure or timeout--> failed
 *   failed | uploaded --retry--> converting
 *   converted  --every page has a transcript--> transcribed
 *   transcribed --filed under a node--> filed
 *   filed --node removed or taken off--> transcribed
 *
 * The last three are derived: whenever a transcript is saved or a file is
 * filed or unfiled, the status of a file that has pages is recomputed from the
 * facts (all pages transcribed? has a node?), so it can never disagree with
 * them. Statuses before `converted` change only through the conversion queue.
 */
export function bandStatus(allTranscribed: boolean, hasNode: boolean): FileStatus {
  if (!allTranscribed) return "converted";
  return hasNode ? "filed" : "transcribed";
}

const BAND: ReadonlySet<FileStatus> = new Set(["converted", "transcribed", "filed"]);

/** Recompute converted / transcribed / filed from the facts. Returns the status after. */
export function recomputeStatus(db: Db, fileId: string, now: number): FileStatus {
  const row = db
    .prepare(
      `SELECT f.status, f.node_id,
              (SELECT COUNT(*) FROM pages p WHERE p.file_id = f.id) AS pages,
              (SELECT COUNT(*) FROM pages p WHERE p.file_id = f.id AND p.transcript_id IS NOT NULL) AS done
       FROM source_files f WHERE f.id = ?`,
    )
    .get(fileId) as
    | { status: FileStatus; node_id: string | null; pages: number; done: number }
    | undefined;
  if (!row) throw notFoundFile();
  if (!BAND.has(row.status)) return row.status;
  const next = bandStatus(row.pages > 0 && row.done === row.pages, row.node_id !== null);
  if (next !== row.status) {
    db.prepare("UPDATE source_files SET status = ?, updated_at = ? WHERE id = ?").run(
      next,
      now,
      fileId,
    );
  }
  return next;
}
