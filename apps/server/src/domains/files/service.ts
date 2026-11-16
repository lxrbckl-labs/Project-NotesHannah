import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, renameSync, rmSync, statSync, unlinkSync } from "node:fs";
import {
  type Actor,
  FileStatus,
  type FileType,
  NodeId,
  newId,
  type Page,
  type RequestUploadsInput,
  SaveTranscriptInput,
  type SourceFile,
  type Transcript,
  UPLOAD_LIMITS,
  type UploadTicket,
} from "@notes/schema";
import type { z } from "zod";
import type { Config } from "../../config.js";
import type { Db } from "../../db/client.js";
import type { AuthContext } from "../../http/auth-context.js";
import { AppError } from "../../http/errors.js";
import {
  assertStorageAvailable,
  ensureDir,
  openStorage,
  originalPath,
  originalsDir,
  pageImagePath,
  type Storage,
} from "../../storage/storage.js";
import { sha256 as digest, digestsEqual, randomToken, TOKEN_PATTERN } from "../accounts/secrets.js";
import type { ActivityLink, ActivityPort } from "../activity/index.js";
import { plural } from "../activity/trace.js";
import {
  type ChangeRecorder,
  createLibraryService,
  type LibraryService,
} from "../library/index.js";
import { decodeCursor, encodeCursor } from "./cursor.js";
import {
  actorKey,
  type FileRow,
  iso,
  notFoundFile,
  notFoundPage,
  type PageRow,
  recomputeStatus,
  type TranscriptRow,
  toFile,
  toPage,
  toTranscript,
} from "./model.js";
import { sanitizeFileName } from "./names.js";
import {
  createQueue,
  DEFAULT_QUEUE_OPTIONS,
  type ProcessSummary,
  type QueueEvent,
  type QueueOptions,
} from "./queue.js";
import {
  type ImageSize,
  SIGNED_URL_TTL_SECONDS,
  signPageImage,
  verifyPageImage,
} from "./signing.js";
import { type Received, tooLarge, UploadSink } from "./sink.js";

/** Who is asking: a full request context, or just a user id for read-only calls from other domains. */
export type Caller = AuthContext | string;

export interface FilesDeps {
  config: Pick<Config, "DATA_DIR" | "APP_ORIGIN">;
  db: Db;
  now: () => number;
}

/** Told, inside the same transaction, when source files go to the trash, come back, or are deleted for good. */
export interface FilesListener {
  trashed?(event: { userId: string; actor: Actor; fileIds: readonly string[] }): void;
  restored?(event: { userId: string; actor: Actor; fileIds: readonly string[] }): void;
  /** Runs before the rows go; the pages and the original are still there. */
  deleted?(event: { userId: string; actor: Actor; fileIds: readonly string[] }): void;
}

export interface FilesServiceOptions extends Partial<QueueOptions> {
  listener?: FilesListener;
  /** Use this storage instead of opening `config.DATA_DIR` on first use. */
  storage?: Storage;
  /** Key for signed page-image links. By default one is made once and kept in the database. */
  signingSecret?: Buffer | string;
  /** Largest accepted upload in bytes (default: UPLOAD_LIMITS.maxBytes). */
  maxUploadBytes?: number;
  /** How long a claim lasts without being renewed. */
  claimTtlMs?: number;
  /** How long an agent upload link lasts. */
  linkTtlSeconds?: number;
  library?: LibraryService;
  log?: (message: string) => void;
  /** Every file and transcript change is appended here, as the actor who made it. */
  changes?: ChangeRecorder;
  /** What agents do is logged here in plain words (entries for the user are ignored by the log). */
  activity?: ActivityPort;
}

/** What an agent may add when it files a file whose pages are not all transcribed. */
export interface FileUnderOptions {
  /** File it anyway. Needs a `reason`. */
  force?: boolean | undefined;
  /** Why, in a few words; recorded in the activity log. */
  reason?: string | undefined;
}

export interface ListFilesOptions {
  status?: FileStatus | undefined;
  nodeId?: string | undefined;
  /** Files not yet filed (status other than "filed"), live ones only. */
  inbox?: boolean | undefined;
  /** List the trash instead of live files. */
  trashed?: boolean | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

export interface Paged<T> {
  items: T[];
  nextCursor: string | null;
}

export interface TranscriptHit {
  kind: "transcript";
  pageId: string;
  pageIndex: number;
  fileId: string;
  fileName: string;
  nodeId: string | null;
  transcriptId: string;
  snippet: string;
}

export interface StoredFile {
  path: string;
  size: number;
  mtimeMs: number;
  contentType: string;
  /** Name to offer when saving; display text only. */
  filename: string;
  etag: string;
}

export const CONTENT_TYPES: Record<FileType, string> = {
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ppt: "application/vnd.ms-powerpoint",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  odp: "application/vnd.oasis.opendocument.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  jpeg: "image/jpeg",
  png: "image/png",
  heic: "image/heic",
  webp: "image/webp",
  gif: "image/gif",
  tiff: "image/tiff",
  avif: "image/avif",
  bmp: "image/bmp",
};

/**
 * Types a browser may show straight from `/original` (plain page images and PDFs). Everything else, and
 * every `?download=true`, is sent as an attachment, so an uploaded file never runs in the app's origin.
 */
export const INLINE_CONTENT_TYPES: ReadonlySet<string> = new Set([
  CONTENT_TYPES.pdf,
  CONTENT_TYPES.jpeg,
  CONTENT_TYPES.png,
]);

const DEFAULT_LIMIT = 50;
const EXAMPLE_NODE_ID = "nod_01HZX3K9Q2V7M4N8P6R5T0W1YB";

const uid = (who: Caller): string => (typeof who === "string" ? who : who.userId);

function assertWrite(auth: AuthContext): void {
  if (auth.scope !== "write") {
    throw new AppError("read_only_key", "This API key is read-only.", {
      hint: "Create a read-write key in Settings to make changes.",
    });
  }
}

function assertSession(auth: AuthContext, what: string): void {
  if (auth.via !== "session") {
    throw new AppError("forbidden", `${what} needs a signed-in browser session.`, {
      hint: "Only the account holder can do this, from the web app.",
    });
  }
}

function parseInput<T extends z.ZodType>(schema: T, value: unknown, example: unknown): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const hint = parsed.error.issues
    .map((issue) => `${issue.path.join(".") || "(body)"}: ${issue.message}`)
    .join("; ");
  throw new AppError("invalid_input", "The input is not valid.", { hint, example });
}

/** A safe FTS5 MATCH expression from free text: quoted words, the last as a prefix. */
function ftsQuery(text: string): string | null {
  const words = text.match(/[\p{L}\p{N}]+/gu)?.slice(0, 12);
  if (!words || words.length === 0) return null;
  return words.map((w, i) => `"${w}"${i === words.length - 1 ? "*" : ""}`).join(" ");
}

export function createFilesService(deps: FilesDeps, options: FilesServiceOptions = {}) {
  const { db, now } = deps;
  const log = options.log ?? ((message: string) => console.warn(`[files] ${message}`));
  const library = options.library ?? createLibraryService(db);
  const maxUploadBytes = options.maxUploadBytes ?? UPLOAD_LIMITS.maxBytes;
  const claimTtlMs = options.claimTtlMs ?? 30 * 60_000;
  const linkTtlSeconds = options.linkTtlSeconds ?? UPLOAD_LIMITS.linkTtlSeconds;

  let storageCache: Storage | undefined = options.storage;
  /** The storage, opened on first use so the app can start (and be tested) without a data volume. */
  function storage(): Storage {
    if (!storageCache) storageCache = openStorage(deps.config.DATA_DIR);
    assertStorageAvailable(storageCache);
    return storageCache;
  }

  // ---- change feed and activity -------------------------------------------

  /** "lecture 07 · Beta blockers", "the Sources section": where a file is filed, in words. */
  function placeWords(node: {
    kind: string;
    name: string;
    lecture: { number: number | null } | null;
  }): string {
    if (node.kind === "section") return `the ${node.name} section`;
    const number =
      node.kind === "lecture" && node.lecture?.number != null
        ? `${String(node.lecture.number).padStart(2, "0")} · `
        : "";
    return `${node.kind} ${number}${node.name}`;
  }

  interface Note {
    /** e.g. "file.filed": the change feed's action; the activity log gets the same code. */
    action: string;
    summary: string;
    file: FileRow;
    page?: PageRow;
    /** Left out of the activity log (the library or the conversion already says it). */
    quiet?: boolean;
  }

  function note(actor: Actor, n: Note): void {
    const ids = n.page ? [n.file.id, n.page.id] : [n.file.id];
    options.changes?.record(n.file.user_id, {
      action: n.action,
      objectType: n.page ? "page" : "file",
      objectIds: ids,
      nodeId: n.file.node_id,
      actor,
      summary: n.summary,
    });
    if (n.quiet) return;
    const links: ActivityLink[] = [{ type: "file", id: n.file.id, label: n.file.original_name }];
    if (n.page) links.push({ type: "page", id: n.page.id, label: `Page ${n.page.idx}` });
    options.activity?.record(n.file.user_id, {
      actor,
      action: n.action,
      summary: n.summary,
      links,
    });
  }

  /** Conversion results arrive from the queue, not from a person: the uploader is the actor. */
  function onQueueEvent(event: QueueEvent): void {
    const actor = JSON.parse(event.file.uploaded_by) as Actor;
    if (event.type === "converted") {
      const pages = event.file.page_count ?? 0;
      note(actor, {
        action: "file.converted",
        summary: `Converted ${event.file.original_name}: ${pages} ${pages === 1 ? "page" : "pages"} ready`,
        file: event.file,
        quiet: true,
      });
    } else {
      note(actor, {
        action: "file.failed",
        summary: `Could not convert ${event.file.original_name} (${event.code})`,
        file: event.file,
        quiet: true,
      });
    }
  }

  const queue = createQueue({
    db,
    now,
    storage,
    log,
    onEvent: onQueueEvent,
    options: {
      pickupTimeoutMs: options.pickupTimeoutMs ?? DEFAULT_QUEUE_OPTIONS.pickupTimeoutMs,
      processingTimeoutMs: options.processingTimeoutMs ?? DEFAULT_QUEUE_OPTIONS.processingTimeoutMs,
      partialGraceMs: options.partialGraceMs ?? DEFAULT_QUEUE_OPTIONS.partialGraceMs,
      heartbeatStaleMs: options.heartbeatStaleMs ?? DEFAULT_QUEUE_OPTIONS.heartbeatStaleMs,
    },
  });

  // ---- signing secret ------------------------------------------------------

  let secretCache: Buffer | string | undefined = options.signingSecret;
  function signingSecret(): Buffer | string {
    if (secretCache) return secretCache;
    const row = db.prepare("SELECT value FROM app_meta WHERE key = 'files_signing_secret'").get() as
      | { value: string }
      | undefined;
    if (row) secretCache = row.value;
    else {
      const fresh = randomBytes(32).toString("base64url");
      db.prepare(
        "INSERT OR IGNORE INTO app_meta (key, value) VALUES ('files_signing_secret', ?)",
      ).run(fresh);
      secretCache = (
        db.prepare("SELECT value FROM app_meta WHERE key = 'files_signing_secret'").get() as {
          value: string;
        }
      ).value;
    }
    return secretCache;
  }

  // ---- lookups -------------------------------------------------------------

  const fileStmt = db.prepare("SELECT * FROM source_files WHERE id = ? AND user_id = ?");
  const pageStmt = db.prepare("SELECT * FROM pages WHERE id = ? AND user_id = ?");

  function needFile(userId: string, id: string): FileRow {
    const row = fileStmt.get(id, userId) as FileRow | undefined;
    if (!row) throw notFoundFile();
    return row;
  }

  function needLive(userId: string, id: string, action: string): FileRow {
    const row = needFile(userId, id);
    if (row.trashed_at !== null) {
      throw new AppError("conflict", `This file is in the trash, so it cannot be ${action}.`, {
        hint: "Restore it first.",
        example: { method: "POST", path: `/api/files/${id}/restore` },
      });
    }
    return row;
  }

  function needPage(userId: string, id: string): PageRow {
    const row = pageStmt.get(id, userId) as PageRow | undefined;
    if (!row) throw notFoundPage();
    return row;
  }

  const view = (row: FileRow): SourceFile => toFile(row, now());

  /** A node a source can be filed under: a lecture, a folder, or a course's Sources section. */
  function checkPlace(userId: string, nodeId: string): string {
    const parsed = NodeId.safeParse(nodeId);
    if (!parsed.success) {
      throw new AppError("invalid_input", "nodeId is not a valid node ID.", {
        example: { nodeId: EXAMPLE_NODE_ID },
      });
    }
    const node = library.get(userId, nodeId);
    const fine =
      node.trashedAt === null &&
      (node.kind === "lecture" ||
        node.kind === "folder" ||
        (node.kind === "section" && node.section === "sources"));
    if (!fine) {
      throw new AppError(
        "invalid_input",
        node.trashedAt !== null
          ? "That library item is in the trash."
          : `A source file cannot be filed under a ${node.kind}.`,
        {
          hint: "File it under a lecture, a folder, or the Sources section of a course.",
          example: { nodeId: EXAMPLE_NODE_ID },
        },
      );
    }
    return node.id;
  }

  // ---- uploads -------------------------------------------------------------

  /** Move the staged file into place (or reuse the identical original) and record the SourceFile. */
  function commitUpload(
    userId: string,
    actor: Actor,
    received: Received,
    name: string,
    nodeId: string | null,
  ): SourceFile {
    const s = storage();
    try {
      ensureDir(s, originalsDir(s, userId));
      const target = originalPath(s, userId, received.sha256);
      if (existsSync(target)) unlinkSync(received.path);
      else {
        renameSync(received.path, target);
        chmodSync(target, 0o644);
      }
    } catch (error) {
      rmSync(received.path, { force: true });
      throw error;
    }
    // A target that vanished while the bytes were arriving is not worth losing the upload over.
    let place: string | null = null;
    if (nodeId !== null) {
      try {
        place = checkPlace(userId, nodeId);
      } catch {
        place = null;
      }
    }
    const t = now();
    const id = newId("file", t);
    const row = db.transaction((): FileRow => {
      db.prepare(
        `INSERT INTO source_files (id, user_id, node_id, original_name, sha256, bytes, type, status,
           uploaded_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'uploaded', ?, ?, ?)`,
      ).run(
        id,
        userId,
        place,
        sanitizeFileName(name),
        received.sha256,
        received.bytes,
        received.type,
        JSON.stringify(actor),
        t,
        t,
      );
      const created = fileStmt.get(id, userId) as FileRow;
      note(actor, {
        action: "file.uploaded",
        summary: `Uploaded ${created.original_name}`,
        file: created,
      });
      return created;
    })();
    try {
      queue.enqueue(row);
    } catch (error) {
      log(`could not queue ${id}: ${String(error)}`);
    }
    return view(fileStmt.get(id, userId) as FileRow);
  }

  /** Stream a body (already past any multipart framing) into staging, then commit it. */
  async function receiveBody(body: AsyncIterable<Uint8Array>, maxBytes: number): Promise<Received> {
    const sink = new UploadSink(storage(), maxBytes);
    await sink.start();
    try {
      for await (const chunk of body) await sink.write(chunk);
    } catch (error) {
      await sink.abort();
      throw error;
    }
    return sink.finish();
  }

  /** Create a sink the caller feeds itself (multipart). */
  function openSink(): UploadSink {
    return new UploadSink(storage(), maxUploadBytes);
  }

  /** The browser upload: the staged result of `openSink`, plus the name and optional node. */
  function finishBrowserUpload(
    auth: AuthContext,
    received: Received,
    name: string,
    nodeId: string | null,
  ): SourceFile {
    try {
      if (nodeId !== null) checkPlace(auth.userId, nodeId);
    } catch (error) {
      rmSync(received.path, { force: true });
      throw error;
    }
    return commitUpload(auth.userId, auth.actor, received, name, nodeId);
  }

  /** Upload one file's bytes from a stream, as the caller. */
  async function upload(
    auth: AuthContext,
    input: { body: AsyncIterable<Uint8Array>; name: string; nodeId?: string | null },
  ): Promise<SourceFile> {
    assertWrite(auth);
    if (input.nodeId) checkPlace(auth.userId, input.nodeId);
    const received = await receiveBody(input.body, maxUploadBytes);
    return finishBrowserUpload(auth, received, input.name, input.nodeId ?? null);
  }

  function requestUploads(auth: AuthContext, input: RequestUploadsInput): UploadTicket[] {
    assertWrite(auth);
    storage();
    const nodeId = input.nodeId ? checkPlace(auth.userId, input.nodeId) : null;
    const t = now();
    const expires = t + linkTtlSeconds * 1000;
    const insert = db.prepare(
      `INSERT INTO upload_tickets (id, user_id, token_hash, name, max_bytes, node_id, created_by,
         created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    return db.transaction(() =>
      input.files.map((f) => {
        const token = randomToken();
        const id = newId("upload", t);
        const name = sanitizeFileName(f.name);
        insert.run(
          id,
          auth.userId,
          digest(token),
          name,
          Math.min(f.bytes, maxUploadBytes),
          nodeId,
          JSON.stringify(auth.actor),
          t,
          expires,
        );
        return {
          id,
          name,
          url: `${deps.config.APP_ORIGIN}/api/uploads/${token}`,
          method: "PUT" as const,
          maxBytes: Math.min(f.bytes, maxUploadBytes),
          expiresAt: iso(expires),
        };
      }),
    )();
  }

  interface TicketRow {
    id: string;
    user_id: string;
    token_hash: Buffer;
    name: string;
    max_bytes: number;
    node_id: string | null;
    created_by: string;
    expires_at: number;
    consumed_at: number | null;
  }

  /** Spend an upload ticket. The token is the only credential. */
  async function uploadWithTicket(
    token: string,
    body: AsyncIterable<Uint8Array>,
    declaredLength?: number | null,
  ): Promise<SourceFile> {
    if (!TOKEN_PATTERN.test(token)) throw ticketUnknown();
    storage(); // do not spend the ticket if the volume is not there
    const hash = digest(token);
    const row = db.prepare("SELECT * FROM upload_tickets WHERE token_hash = ?").get(hash) as
      | TicketRow
      | undefined;
    if (!row || !digestsEqual(row.token_hash, hash)) throw ticketUnknown();
    const t = now();
    // Atomic: only one request can move consumed_at from NULL.
    const spent = db
      .prepare(
        "UPDATE upload_tickets SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL AND expires_at > ?",
      )
      .run(t, row.id, t);
    if (spent.changes !== 1) {
      throw new AppError(
        "conflict",
        row.consumed_at !== null
          ? "This upload link has already been used."
          : "This upload link has expired.",
        { hint: "Ask for new upload links; each works once and only for a few minutes." },
      );
    }
    if (declaredLength != null && declaredLength > row.max_bytes) throw tooLarge(row.max_bytes);
    const received = await receiveBody(body, row.max_bytes);
    const actor = JSON.parse(row.created_by) as Actor;
    const file = commitUpload(row.user_id, actor, received, row.name, row.node_id);
    db.prepare("UPDATE upload_tickets SET file_id = ? WHERE id = ?").run(file.id, row.id);
    return file;
  }

  function ticketUnknown(): AppError {
    return new AppError("not_found", "No such upload link.", {
      hint: "Ask for new upload links with POST /api/uploads/tickets.",
    });
  }

  // ---- inbox ---------------------------------------------------------------

  function listFiles(who: Caller, opts: ListFilesOptions = {}): Paged<SourceFile> {
    const userId = uid(who);
    const limit = opts.limit ?? DEFAULT_LIMIT;
    const where = [
      "user_id = @user",
      opts.trashed ? "trashed_at IS NOT NULL" : "trashed_at IS NULL",
    ];
    const params: Record<string, string | number> = { user: userId, limit: limit + 1 };
    if (opts.status) {
      where.push("status = @status");
      params.status = FileStatus.parse(opts.status);
    }
    if (opts.nodeId) {
      where.push("node_id = @node");
      params.node = opts.nodeId;
    }
    if (opts.inbox) where.push("status != 'filed'");
    if (opts.cursor) {
      params.after = decodeCursor(
        opts.cursor,
        (v): v is { i: string } =>
          typeof v === "object" && v !== null && typeof (v as { i?: unknown }).i === "string",
      ).i;
      where.push("id < @after");
    }
    const rows = db
      .prepare(
        `SELECT * FROM source_files WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT @limit`,
      )
      .all(params) as FileRow[];
    const more = rows.length > limit;
    const slice = more ? rows.slice(0, limit) : rows;
    const last = slice[slice.length - 1];
    return {
      items: slice.map(view),
      nextCursor: more && last ? encodeCursor({ i: last.id }) : null,
    };
  }

  function getFile(who: Caller, id: string): SourceFile {
    return view(needFile(uid(who), id));
  }

  /** 1-based numbers of the converted pages that still have no transcript. */
  function untranscribedPages(fileId: string): number[] {
    return (
      db
        .prepare("SELECT idx FROM pages WHERE file_id = ? AND transcript_id IS NULL ORDER BY idx")
        .all(fileId) as Array<{ idx: number }>
    ).map((r) => r.idx);
  }

  /**
   * File (or move) a file. An AGENT may not put a file into a place while some of its pages have no
   * transcript: it is refused with the page numbers, unless it passes `force` with a short reason
   * (kept in the activity log). She (a browser session) can always file, and anyone may send a file
   * back to the inbox.
   */
  function fileUnder(
    auth: AuthContext,
    id: string,
    nodeId: string | null,
    options: FileUnderOptions = {},
  ): SourceFile {
    assertWrite(auth);
    const file = needLive(auth.userId, id, "filed");
    const place = nodeId === null ? null : checkPlace(auth.userId, nodeId);
    let forced: string | null = null;
    if (place !== null && auth.actor.type === "agent") {
      const missing = untranscribedPages(file.id);
      if (missing.length > 0) {
        const reason = options.force ? options.reason?.trim() : undefined;
        if (!reason) {
          const shown = missing.slice(0, 20).join(", ");
          throw new AppError(
            "invalid_input",
            options.force
              ? `"force" needs a short "reason" (why this file is filed before page ${shown} is transcribed).`
              : `${file.original_name} has ${plural(missing.length, "page")} without a transcript (page ${shown}${missing.length > 20 ? ", …" : ""}), so it cannot be filed yet.`,
            {
              hint: `Read each of those pages and save its transcript (save_transcript over MCP, PUT /api/pages/<pageId>/transcript over HTTP), then file again. Only if a page truly cannot be transcribed, file again with "force": true and a short "reason"; the reason is recorded in the activity log.`,
              example: { nodeId: place, force: true, reason: "page 3 is a blank scan" },
            },
          );
        }
        forced = `${plural(missing.length, "page")} not transcribed: ${reason.slice(0, 200)}`;
      }
    }
    db.transaction(() => {
      db.prepare(
        "UPDATE source_files SET node_id = ?, parked_node_id = NULL, updated_at = ? WHERE id = ?",
      ).run(place, now(), file.id);
      recomputeStatus(db, file.id, now());
      const after = needFile(auth.userId, id);
      if (place !== null) {
        note(auth.actor, {
          action: "file.filed",
          summary: `Filed ${file.original_name} under ${placeWords(library.get(auth.userId, place))}${forced ? ` (forced; ${forced})` : ""}`,
          file: after,
        });
      } else if (file.node_id !== null) {
        note(auth.actor, {
          action: "file.unfiled",
          summary: `Took ${file.original_name} back to the inbox`,
          file: after,
        });
      }
    })();
    return view(needFile(auth.userId, id));
  }

  /** Change the display name. The original is stored by hash, so nothing on disk changes. */
  function rename(auth: AuthContext, id: string, name: string): SourceFile {
    assertWrite(auth);
    const file = needLive(auth.userId, id, "renamed");
    const clean = sanitizeFileName(name);
    if (clean !== file.original_name) {
      db.transaction(() => {
        db.prepare("UPDATE source_files SET original_name = ?, updated_at = ? WHERE id = ?").run(
          clean,
          now(),
          file.id,
        );
        note(auth.actor, {
          action: "file.renamed",
          summary: `Renamed ${file.original_name} to ${clean}`,
          file: needFile(auth.userId, id),
        });
      })();
    }
    return view(needFile(auth.userId, id));
  }

  function retry(auth: AuthContext, id: string): SourceFile {
    assertWrite(auth);
    const file = needLive(auth.userId, id, "retried");
    if (file.status !== "failed" && file.status !== "uploaded") {
      throw new AppError(
        "conflict",
        `Only a failed file can be retried; this one is ${file.status}.`,
        {
          hint:
            file.status === "converting"
              ? "It is still being converted. Check GET /api/converter/status."
              : "It was converted already; its pages are ready.",
          example: { method: "GET", path: `/api/files/${id}` },
        },
      );
    }
    queue.removeImages(file);
    queue.enqueue(file);
    note(auth.actor, {
      action: "file.retried",
      summary: `Asked for ${file.original_name} to be converted again`,
      file: needFile(auth.userId, id),
    });
    return view(needFile(auth.userId, id));
  }

  const sameActor = (a: Actor, b: Actor): boolean => actorKey(a) === actorKey(b);

  function activeClaim(row: FileRow): Actor | null {
    return row.claimed_by && row.claim_expires_at !== null && row.claim_expires_at > now()
      ? (JSON.parse(row.claimed_by) as Actor)
      : null;
  }

  function claim(auth: AuthContext, id: string): SourceFile {
    assertWrite(auth);
    const file = needLive(auth.userId, id, "claimed");
    if (file.status !== "converted" && file.status !== "transcribed" && file.status !== "filed") {
      throw new AppError(
        "conflict",
        `Only a converted file can be claimed; this one is ${file.status}.`,
        {
          hint: "Wait for conversion to finish, or retry it if it failed.",
          example: { method: "GET", path: `/api/files/${id}` },
        },
      );
    }
    const holder = activeClaim(file);
    if (holder && !sameActor(holder, auth.actor)) {
      throw new AppError("conflict", "Another agent has claimed this file.", {
        hint: `The claim ends at ${iso(file.claim_expires_at as number)}. Pick another file, or ask the claimant to release it.`,
        example: { method: "GET", path: "/api/files?inbox=true&status=converted" },
      });
    }
    const t = now();
    db.prepare(
      "UPDATE source_files SET claimed_by = ?, claimed_at = ?, claim_expires_at = ?, updated_at = ? WHERE id = ?",
    ).run(JSON.stringify(auth.actor), t, t + claimTtlMs, t, file.id);
    note(auth.actor, {
      action: "file.claimed",
      summary: `Claimed ${file.original_name} to work on it`,
      file: needFile(auth.userId, id),
    });
    return view(needFile(auth.userId, id));
  }

  function release(auth: AuthContext, id: string): SourceFile {
    assertWrite(auth);
    const file = needFile(auth.userId, id);
    const holder = activeClaim(file);
    if (holder && !sameActor(holder, auth.actor) && auth.via !== "session") {
      throw new AppError(
        "conflict",
        "Another agent holds this claim; only it (or the account holder) can release it.",
      );
    }
    if (file.claimed_by !== null) {
      db.prepare(
        "UPDATE source_files SET claimed_by = NULL, claimed_at = NULL, claim_expires_at = NULL, updated_at = ? WHERE id = ?",
      ).run(now(), file.id);
      note(auth.actor, {
        action: "file.released",
        summary: `Released ${file.original_name}`,
        file: needFile(auth.userId, id),
      });
    }
    return view(needFile(auth.userId, id));
  }

  function trash(auth: AuthContext, id: string): SourceFile {
    assertWrite(auth);
    const file = needFile(auth.userId, id);
    if (file.trashed_at === null) {
      db.transaction(() => {
        db.prepare("UPDATE source_files SET trashed_at = ?, updated_at = ? WHERE id = ?").run(
          now(),
          now(),
          file.id,
        );
        note(auth.actor, {
          action: "file.trashed",
          summary: `Moved ${file.original_name} to the trash`,
          file: needFile(auth.userId, id),
        });
        options.listener?.trashed?.({ userId: auth.userId, actor: auth.actor, fileIds: [id] });
      })();
    }
    return view(needFile(auth.userId, id));
  }

  function restore(auth: AuthContext, id: string): SourceFile {
    assertWrite(auth);
    const file = needFile(auth.userId, id);
    if (file.trashed_at !== null) {
      db.transaction(() => {
        db.prepare("UPDATE source_files SET trashed_at = NULL, updated_at = ? WHERE id = ?").run(
          now(),
          file.id,
        );
        note(auth.actor, {
          action: "file.restored",
          summary: `Restored ${file.original_name} from the trash`,
          file: needFile(auth.userId, id),
        });
        options.listener?.restored?.({ userId: auth.userId, actor: auth.actor, fileIds: [id] });
      })();
    }
    return view(needFile(auth.userId, id));
  }

  /**
   * Delete a trashed file for good: its record, pages and transcripts, its page
   * images, and its original unless another of the user's files uses the same bytes.
   */
  function permanentDelete(auth: AuthContext, id: string): void {
    assertWrite(auth);
    assertSession(auth, "Deleting a file for good");
    const file = needFile(auth.userId, id);
    if (file.trashed_at === null) {
      throw new AppError("conflict", "Only a file in the trash can be deleted for good.", {
        hint: "Move it to the trash first.",
        example: { method: "POST", path: `/api/files/${id}/trash` },
      });
    }
    const jobs = db
      .prepare("SELECT id FROM conversion_jobs WHERE file_id = ?")
      .all(file.id) as Array<{
      id: string;
    }>;
    let shared = false;
    db.transaction(() => {
      note(auth.actor, {
        action: "file.deleted",
        summary: `Deleted ${file.original_name} for good`,
        file,
      });
      options.listener?.deleted?.({ userId: auth.userId, actor: auth.actor, fileIds: [id] });
      db.prepare("DELETE FROM source_files WHERE id = ?").run(file.id);
      shared =
        (
          db
            .prepare("SELECT COUNT(*) AS n FROM source_files WHERE user_id = ? AND sha256 = ?")
            .get(file.user_id, file.sha256) as { n: number }
        ).n > 0;
    })();
    // Files are removed after the record, in one synchronous run, so an upload
    // of the same bytes cannot slip in between the count and the removal.
    try {
      queue.removeImages(file);
      for (const job of jobs) queue.removeQueueFiles(job.id);
      if (!shared) rmSync(originalPath(storage(), file.user_id, file.sha256), { force: true });
    } catch (error) {
      log(`cleanup after deleting ${id} was incomplete: ${String(error)}`);
    }
  }

  // ---- pages and images ----------------------------------------------------

  function listPages(who: Caller, fileId: string): Page[] {
    const userId = uid(who);
    needFile(userId, fileId);
    return (
      db
        .prepare("SELECT * FROM pages WHERE file_id = ? AND user_id = ? ORDER BY idx")
        .all(fileId, userId) as PageRow[]
    ).map(toPage);
  }

  function getPage(who: Caller, pageId: string): Page {
    return toPage(needPage(uid(who), pageId));
  }

  function originalFile(who: Caller, fileId: string): StoredFile {
    const file = needFile(uid(who), fileId);
    const path = originalPath(storage(), file.user_id, file.sha256);
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(path);
    } catch {
      throw new AppError("storage_unavailable", "The stored original is missing.", {
        hint: "The storage drive may not be mounted, or the file was removed by hand.",
      });
    }
    return {
      path,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      contentType: CONTENT_TYPES[file.type],
      filename: file.original_name,
      etag: `"${file.sha256}"`,
    };
  }

  function imageOf(row: PageRow, size: ImageSize): StoredFile {
    const file = db
      .prepare("SELECT original_name FROM source_files WHERE id = ?")
      .get(row.file_id) as {
      original_name: string;
    };
    const path = pageImagePath(storage(), row.user_id, row.file_id, row.idx, size);
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(path);
    } catch {
      throw new AppError("not_found", "The image for this page is missing.", {
        hint: "Retry the file's conversion with POST /api/files/:id/retry if it was lost.",
      });
    }
    const base = file.original_name.replace(/\.[^.]{1,10}$/, "");
    return {
      path,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      contentType: "image/webp",
      filename: `${base} - ${size === "thumb" ? "thumb " : "page "}${row.idx}.webp`,
      etag: `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`,
    };
  }

  function pageImage(who: Caller, pageId: string, size: ImageSize): StoredFile {
    return imageOf(needPage(uid(who), pageId), size);
  }

  /** A link that downloads one page image for five minutes with no other credential. */
  function signedImageUrl(
    who: Caller,
    pageId: string,
    size: ImageSize,
  ): { url: string; expiresAt: string } {
    const page = needPage(uid(who), pageId);
    const expires = Math.floor(now() / 1000) + SIGNED_URL_TTL_SECONDS;
    const sig = signPageImage(signingSecret(), page.id, size, expires);
    return {
      url: `${deps.config.APP_ORIGIN}/api/pages/${page.id}/image?size=${size}&exp=${expires}&sig=${sig}`,
      expiresAt: iso(expires * 1000),
    };
  }

  /** The image behind a signed link, or `forbidden` when the link is wrong or has expired. */
  function pageImageSigned(pageId: string, size: ImageSize, exp: number, sig: string): StoredFile {
    if (!verifyPageImage(signingSecret(), pageId, size, exp, sig, Math.floor(now() / 1000))) {
      throw new AppError("forbidden", "This download link is invalid or has expired.", {
        hint: "Ask for a fresh link with GET /api/pages/:id/image-url (they last five minutes).",
      });
    }
    const row = db.prepare("SELECT * FROM pages WHERE id = ?").get(pageId) as PageRow | undefined;
    if (!row) throw notFoundPage();
    return imageOf(row, size);
  }

  // ---- transcripts ---------------------------------------------------------

  const transcriptStmt = db.prepare("SELECT * FROM transcripts WHERE id = ?");

  function currentTranscript(page: PageRow): TranscriptRow | undefined {
    return page.transcript_id
      ? (transcriptStmt.get(page.transcript_id) as TranscriptRow | undefined)
      : undefined;
  }

  function getTranscript(who: Caller, pageId: string): Transcript | null {
    const row = currentTranscript(needPage(uid(who), pageId));
    return row ? toTranscript(row) : null;
  }

  /** Another agent's live claim blocks an agent's writes; the account holder is never blocked. */
  function checkClaim(auth: AuthContext, file: FileRow): void {
    const holder = activeClaim(file);
    if (holder && auth.via === "key" && !sameActor(holder, auth.actor)) {
      throw new AppError("conflict", "Another agent has claimed this file.", {
        hint: `Its claim ends at ${iso(file.claim_expires_at as number)}.`,
      });
    }
  }

  function insertRevision(
    auth: AuthContext,
    page: PageRow,
    text: string,
    flags: Transcript["flags"],
    how: "saved" | "restored" = "saved",
    restoredRevision?: number,
  ): Transcript {
    const t = now();
    const id = newId("transcript", t);
    db.transaction(() => {
      const revision =
        (
          db
            .prepare("SELECT COALESCE(MAX(revision), 0) AS r FROM transcripts WHERE page_id = ?")
            .get(page.id) as { r: number }
        ).r + 1;
      db.prepare(
        `INSERT INTO transcripts (id, page_id, user_id, revision, text, flags, author, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        page.id,
        page.user_id,
        revision,
        text,
        JSON.stringify(flags),
        JSON.stringify(auth.actor),
        t,
      );
      db.prepare("UPDATE pages SET transcript_id = ? WHERE id = ?").run(id, page.id);
      db.prepare("DELETE FROM transcripts_fts WHERE rowid = ?").run(page.seq);
      db.prepare("INSERT INTO transcripts_fts (rowid, text) VALUES (?, ?)").run(page.seq, text);
      db.prepare("UPDATE source_files SET updated_at = ? WHERE id = ?").run(t, page.file_id);
      recomputeStatus(db, page.file_id, t);
      const file = needFile(page.user_id, page.file_id);
      const where = `page ${page.idx} of ${file.original_name}`;
      note(auth.actor, {
        action: how === "saved" ? "transcript.saved" : "transcript.restored",
        summary:
          how === "restored"
            ? `Restored revision ${restoredRevision} of ${where} as the new revision ${revision}`
            : revision === 1
              ? `Transcribed ${where}`
              : `Rewrote the transcript of ${where} (revision ${revision})`,
        file,
        page,
      });
    })();
    return toTranscript(transcriptStmt.get(id) as TranscriptRow);
  }

  function saveTranscript(auth: AuthContext, rawInput: SaveTranscriptInput): Transcript {
    assertWrite(auth);
    const input = parseInput(SaveTranscriptInput, rawInput, {
      pageId: "pag_01HZX3K9Q2V7M4N8P6R5T0W1YB",
      text: "Metoprolol 50 mg PO BID",
      flags: [{ kind: "dose", quote: "50 mg" }],
    });
    const page = needPage(auth.userId, input.pageId);
    const file = needLive(auth.userId, page.file_id, "transcribed");
    checkClaim(auth, file);
    const missing = input.flags.filter((flag) => !input.text.includes(flag.quote));
    if (missing.length > 0) {
      throw new AppError(
        "invalid_input",
        `${missing.length === 1 ? "A flag's quote does" : `${missing.length} flags' quotes do`} not appear in the transcript text.`,
        {
          hint: `Each flag.quote must be copied exactly from text. Not found: ${missing
            .slice(0, 5)
            .map((flag) => JSON.stringify(flag.quote))
            .join(", ")}.`,
          example: {
            text: "Metoprolol 50 mg PO BID",
            flags: [{ kind: "dose", quote: "50 mg", note: "dose read from handwriting" }],
          },
        },
      );
    }
    return insertRevision(auth, page, input.text, input.flags);
  }

  /** Only the account holder, in the browser, can mark a transcript as checked. */
  function setReview(auth: AuthContext, pageId: string, reviewed: boolean): Transcript {
    assertWrite(auth);
    assertSession(auth, "Reviewing a transcript");
    const page = needPage(auth.userId, pageId);
    needLive(auth.userId, page.file_id, "reviewed");
    const row = currentTranscript(page);
    if (!row) {
      throw new AppError("conflict", "This page has no transcript to review yet.", {
        hint: "An agent saves one with PUT /api/pages/:id/transcript.",
      });
    }
    db.prepare("UPDATE transcripts SET review_status = ?, reviewed_at = ? WHERE id = ?").run(
      reviewed ? "reviewed" : "unverified",
      reviewed ? now() : null,
      row.id,
    );
    const file = needFile(auth.userId, page.file_id);
    note(auth.actor, {
      action: "transcript.reviewed",
      summary: `${reviewed ? "Marked" : "Unmarked"} page ${page.idx} of ${file.original_name} as reviewed`,
      file,
      page,
    });
    return toTranscript(transcriptStmt.get(row.id) as TranscriptRow);
  }

  function listRevisions(
    who: Caller,
    pageId: string,
    opts: { cursor?: string | undefined; limit?: number | undefined } = {},
  ): Paged<Transcript> {
    const userId = uid(who);
    needPage(userId, pageId);
    const limit = opts.limit ?? DEFAULT_LIMIT;
    const before = opts.cursor
      ? decodeCursor(
          opts.cursor,
          (v): v is { r: number } =>
            typeof v === "object" && v !== null && Number.isInteger((v as { r?: unknown }).r),
        ).r
      : Number.MAX_SAFE_INTEGER;
    const rows = db
      .prepare(
        "SELECT * FROM transcripts WHERE page_id = ? AND user_id = ? AND revision < ? ORDER BY revision DESC LIMIT ?",
      )
      .all(pageId, userId, before, limit + 1) as TranscriptRow[];
    const more = rows.length > limit;
    const slice = more ? rows.slice(0, limit) : rows;
    const last = slice[slice.length - 1];
    return {
      items: slice.map(toTranscript),
      nextCursor: more && last ? encodeCursor({ r: last.revision }) : null,
    };
  }

  /** Make an earlier revision current again, as a new revision (history is never rewritten). */
  function restoreRevision(auth: AuthContext, pageId: string, revision: number): Transcript {
    assertWrite(auth);
    const page = needPage(auth.userId, pageId);
    const file = needLive(auth.userId, page.file_id, "changed");
    checkClaim(auth, file);
    const old = db
      .prepare("SELECT * FROM transcripts WHERE page_id = ? AND user_id = ? AND revision = ?")
      .get(pageId, auth.userId, revision) as TranscriptRow | undefined;
    if (!old) {
      throw new AppError("not_found", `This page has no revision ${revision}.`, {
        hint: "List revisions with GET /api/pages/:id/transcript/revisions.",
      });
    }
    if (page.transcript_id === old.id) {
      throw new AppError("conflict", "That revision is already the current transcript.");
    }
    return insertRevision(
      auth,
      page,
      old.text,
      JSON.parse(old.flags) as Transcript["flags"],
      "restored",
      old.revision,
    );
  }

  // ---- search --------------------------------------------------------------

  /**
   * Full-text search over the current transcript of each page, for the library
   * domain's search route. Scoped to the user; files in the trash are excluded.
   */
  function searchTranscripts(
    who: Caller,
    query: string,
    opts: {
      cursor?: string | undefined;
      limit?: number | undefined;
      /** Skip this many hits; takes the place of `cursor` (the unified search pages with it). */
      offset?: number | undefined;
    } = {},
  ): Paged<TranscriptHit> {
    const userId = uid(who);
    const match = ftsQuery(query);
    if (match === null) return { items: [], nextCursor: null };
    const limit = opts.limit ?? DEFAULT_LIMIT;
    const offset =
      opts.offset ??
      (opts.cursor
        ? decodeCursor(
            opts.cursor,
            (v): v is { o: number } =>
              typeof v === "object" && v !== null && Number.isInteger((v as { o?: unknown }).o),
          ).o
        : 0);
    const rows = db
      .prepare(
        `SELECT p.id AS page_id, p.idx, p.transcript_id, f.id AS file_id, f.original_name, f.node_id,
                snippet(transcripts_fts, 0, '', '', '…', 12) AS snippet
         FROM transcripts_fts
         JOIN pages p ON p.seq = transcripts_fts.rowid
         JOIN source_files f ON f.id = p.file_id
         WHERE transcripts_fts MATCH ? AND p.user_id = ? AND f.trashed_at IS NULL
         ORDER BY transcripts_fts.rank, p.id LIMIT ? OFFSET ?`,
      )
      .all(match, userId, limit + 1, offset) as Array<{
      page_id: string;
      idx: number;
      transcript_id: string;
      file_id: string;
      original_name: string;
      node_id: string | null;
      snippet: string;
    }>;
    const more = rows.length > limit;
    return {
      items: (more ? rows.slice(0, limit) : rows).map((r) => ({
        kind: "transcript" as const,
        pageId: r.page_id,
        pageIndex: r.idx,
        fileId: r.file_id,
        fileName: r.original_name,
        nodeId: r.node_id,
        transcriptId: r.transcript_id,
        snippet: r.snippet,
      })),
      nextCursor: more ? encodeCursor({ o: offset + limit }) : null,
    };
  }

  // ---- library node hooks ----------------------------------------------------

  const underNodes = db.prepare(
    `SELECT * FROM source_files
     WHERE user_id = ? AND node_id IN (SELECT value FROM json_each(?))`,
  );

  /**
   * These library nodes went to the trash (or are about to be deleted for good):
   * every source file filed under one returns to the inbox, unfiled. Nothing is
   * deleted. For the trash the old place is remembered, so restoring the node
   * files them there again.
   */
  function onNodesRemoved(
    userId: string,
    nodeIds: readonly string[],
    actor: Actor,
    why: "trashed" | "deleted",
  ): void {
    if (nodeIds.length === 0) return;
    const ids = JSON.stringify(nodeIds);
    db.transaction(() => {
      const t = now();
      for (const file of underNodes.all(userId, ids) as FileRow[]) {
        db.prepare(
          "UPDATE source_files SET node_id = NULL, parked_node_id = ?, updated_at = ? WHERE id = ?",
        ).run(why === "trashed" ? file.node_id : null, t, file.id);
        recomputeStatus(db, file.id, t);
        note(actor, {
          action: "file.unfiled",
          summary: `${file.original_name} went back to the inbox because its place was ${
            why === "trashed" ? "moved to the trash" : "deleted"
          }`,
          file: needFile(userId, file.id),
          quiet: true,
        });
      }
      if (why === "deleted") {
        db.prepare(
          `UPDATE source_files SET parked_node_id = NULL
           WHERE user_id = ? AND parked_node_id IN (SELECT value FROM json_each(?))`,
        ).run(userId, ids);
      }
    })();
  }

  /** These nodes came back from the trash: files parked from them are filed there again. */
  function onNodesRestored(userId: string, nodeIds: readonly string[], actor: Actor): void {
    if (nodeIds.length === 0) return;
    const ids = JSON.stringify(nodeIds);
    db.transaction(() => {
      const t = now();
      const parked = db
        .prepare(
          `SELECT * FROM source_files
           WHERE user_id = ? AND node_id IS NULL
             AND parked_node_id IN (SELECT value FROM json_each(?))`,
        )
        .all(userId, ids) as FileRow[];
      for (const file of parked) {
        db.prepare(
          "UPDATE source_files SET node_id = parked_node_id, parked_node_id = NULL, updated_at = ? WHERE id = ?",
        ).run(t, file.id);
        recomputeStatus(db, file.id, t);
        note(actor, {
          action: "file.filed",
          summary: `${file.original_name} is filed again, because its place came back from the trash`,
          file: needFile(userId, file.id),
          quiet: true,
        });
      }
    })();
  }

  return {
    // library node hooks
    onNodesTrashed: (userId: string, nodeIds: readonly string[], actor: Actor) =>
      onNodesRemoved(userId, nodeIds, actor, "trashed"),
    onNodesDeleted: (userId: string, nodeIds: readonly string[], actor: Actor) =>
      onNodesRemoved(userId, nodeIds, actor, "deleted"),
    onNodesRestored,
    // uploads
    requestUploads,
    upload,
    uploadWithTicket,
    openSink,
    finishBrowserUpload,
    checkPlace,
    // inbox
    listFiles,
    getFile,
    fileUnder,
    retry,
    rename,
    claim,
    release,
    trash,
    restore,
    permanentDelete,
    // pages
    listPages,
    getPage,
    originalFile,
    pageImage,
    signedImageUrl,
    pageImageSigned,
    // transcripts
    getTranscript,
    saveTranscript,
    setReview,
    listRevisions,
    restoreRevision,
    searchTranscripts,
    // queue
    processQueue: (): ProcessSummary => queue.process(),
    converterStatus: () => queue.status(),
  };
}

export type FilesService = ReturnType<typeof createFilesService>;
