import type {
  Actor,
  Block,
  CreateDocumentInput,
  Document,
  FileStatus,
  IdKind,
  Page,
  PageBacklinks,
  RequestUploadsInput,
  SaveTranscriptInput,
  SourceFile,
  Transcript,
  UploadTicket,
  WRITER_OPERATIONS,
  WriterOperation,
} from "@notes/schema";
import type { z } from "zod";

/**
 * The narrow interfaces the MCP layer needs from domains that are built in
 * other lanes. A tool is registered (advertised to agents) only when its port
 * is provided, so nothing unbacked is ever shown. The integrator writes a thin
 * adapter from the real domain service to each port and passes it to
 * `mcpRoutes(deps, ports)`.
 *
 * Conventions for every method:
 * - `userId` scopes the call; an object of another user must behave exactly
 *   like a missing one (`AppError("not_found")`), never `forbidden`.
 * - Failures are thrown as `AppError` (code, message, hint, example). The MCP
 *   layer passes them to the agent unchanged, so write hints for an agent:
 *   name the MCP tool to call next, not an HTTP route.
 * - Inputs have already been validated with the shared schemas from
 *   `@notes/schema` before a port is called.
 */

export interface PageResult<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ListOptions {
  cursor?: string | undefined;
  limit: number;
}

/** Inbox and converter state, shown by `start_here`. */
export interface InboxSummary {
  /** Files not yet filed under a lecture or folder (any status except "filed"). */
  pending: number;
  byStatus: Partial<Record<FileStatus, number>>;
  /** Whether the page-image converter is running. */
  converter: "ok" | "degraded" | "down";
  converterNote?: string | undefined;
}

export interface PageImage {
  /** Raw image bytes (JPEG or PNG), at most about 1568 px on the long edge for "page". */
  data: Uint8Array;
  mimeType: "image/jpeg" | "image/png";
  width: number;
  height: number;
}

/** A page with what an agent needs to move around its file. */
export interface PageView {
  page: Page;
  file: Pick<SourceFile, "id" | "originalName" | "pageCount" | "status" | "nodeId">;
  previousPageId: string | null;
  nextPageId: string | null;
  /** The current transcript's summary, when there is one. */
  transcript: Pick<Transcript, "id" | "revision" | "reviewStatus"> | null;
}

export interface TranscriptHit {
  transcriptId: string;
  pageId: string;
  fileId: string;
  pageIndex: number;
  fileName: string;
  snippet: string;
}

/** Files, pages, transcripts, inbox and upload links (lane: src/domains/files). */
export interface FilesPort {
  inboxSummary(userId: string): InboxSummary;
  /** Files not yet filed, oldest first; optionally only one status. */
  listInbox(
    userId: string,
    options: ListOptions & { status?: FileStatus | undefined },
  ): PageResult<SourceFile>;
  /** Files filed under a library node, for `get_item` on a lecture or folder. */
  listFilesUnder(userId: string, nodeId: string, options: ListOptions): PageResult<SourceFile>;
  getFile(userId: string, fileId: string): SourceFile;
  listPages(userId: string, fileId: string, options: ListOptions): PageResult<Page>;
  /** Claim a file for this agent. `conflict` when another key holds a claim. Idempotent for the holder. */
  claim(actor: Actor, userId: string, fileId: string): SourceFile;
  /** Give a claim back. `conflict` when the caller does not hold it. */
  release(actor: Actor, userId: string, fileId: string): SourceFile;
  /**
   * File it under a library node, move it to another one, or (nodeId null)
   * return it to the inbox. Filing ends any claim. The domain owns the rule
   * for valid destinations (the web API's `POST /api/files/:id/file` calls
   * the same service) and refuses a bad one with `invalid_input`, a hint
   * naming the valid kinds and an example; a missing, trashed or other
   * user's node is `not_found` / `conflict` as for any other ID.
   */
  fileUnder(actor: Actor, userId: string, fileId: string, nodeId: string | null): SourceFile;
  getPage(userId: string, pageId: string): PageView;
  pageImage(userId: string, pageId: string, size: "page" | "thumb"): PageImage;
  /** A signed, short-lived URL that needs no credential (for curl). */
  pageImageLink(
    userId: string,
    pageId: string,
    size: "page" | "thumb",
  ): { url: string; expiresAt: string };
  getTranscript(userId: string, transcriptId: string): Transcript;
  /** Save a new revision of the page's transcript. Earlier revisions are kept. */
  saveTranscript(actor: Actor, userId: string, input: SaveTranscriptInput): Transcript;
  requestUploads(actor: Actor, userId: string, input: RequestUploadsInput): UploadTicket[];
  /** Optional: full-text search over transcripts. `search_notes` offers it when present. */
  searchTranscripts?(
    userId: string,
    query: string,
    options: ListOptions,
  ): PageResult<TranscriptHit>;
}

export interface DocumentHit {
  documentId: string;
  nodeId: string;
  title: string;
  blockId: string | null;
  snippet: string;
}

/** The result of any document write. */
export interface WriteResult {
  documentId: string;
  /** The library node the document is the body of. */
  nodeId: string;
  revision: number;
  /** IDs of new or changed blocks, in document order. */
  written: string[];
  removed: string[];
  /** Her blocks left alone (replace_generated). */
  skipped: Array<{ blockId: string; type: string; reason: "user_edited" | "reviewed" }>;
}

export type DocumentEditOperation = Exclude<WriterOperation, "create_document">;

/** Documents, blocks, revisions and citations (lane: src/domains/documents). */
export interface DocumentsPort {
  /** A document and a range of its blocks (0-based offset into blockIds). */
  getDocument(
    userId: string,
    documentId: string,
    range: { offset: number; limit: number },
  ): { document: Document; blocks: Block[] };
  /** The document that is the body of a lecture or document node, or null. */
  documentForNode(userId: string, nodeId: string): Document | null;
  getBlock(userId: string, blockId: string): { documentId: string; block: Block };
  /**
   * Create a document. The domain must enforce what the schema cannot: the
   * node or parent exists and is the right kind, and every citation quote is
   * found verbatim in its page's transcript (`findQuote`).
   */
  createDocument(actor: Actor, userId: string, input: CreateDocumentInput): WriteResult;
  /**
   * Apply one writer operation. The body is already validated with
   * `validateOperation(operation, body, { writer: "agent" })`. The domain
   * enforces edit protection (`canAgentOverwrite`), `expectedRevision`
   * (`conflict`) and the quote check.
   */
  applyOperation<K extends DocumentEditOperation>(
    actor: Actor,
    userId: string,
    operation: K,
    input: z.output<(typeof WRITER_OPERATIONS)[K]>,
  ): WriteResult;
  /** Optional: what cites a page (K5). Shown by `get_page` and `get_item` on a page. */
  pageBacklinks?(userId: string, pageId: string): PageBacklinks;
  /** Optional: full-text search over documents. */
  searchDocuments?(userId: string, query: string, options: ListOptions): PageResult<DocumentHit>;
}

export interface Change {
  id: string;
  kind: IdKind;
  change: "created" | "updated" | "moved" | "trashed" | "restored" | "deleted";
  at: string;
  /** A readable name: node name, file name, document title. */
  name: string | null;
  by: Actor | null;
}

/** The change feed (H9). Usually built over the domains' updated_at columns or an event table. */
export interface ChangesPort {
  /**
   * Changes after `cursor` (opaque, from a previous call) or, on the first
   * call, after `since` (ISO time; omitted means the last 24 hours). Oldest
   * first. Always returns a cursor to continue from, even when empty.
   */
  changesSince(
    userId: string,
    options: { cursor?: string | undefined; since?: string | undefined; limit: number },
  ): { items: Change[]; cursor: string; more: boolean };
}

/** One mutating MCP call, for the "what agents did" view (H10). */
export interface AuditEntry {
  userId: string;
  keyId: string;
  /** The agent's self-label from X-Agent-Label, if any. */
  agentLabel: string | null;
  tool: string;
  action: string | null;
  targetIds: string[];
  /** "ok", or the error code of a refused call. */
  outcome: string;
  at: string;
}

export interface AuditPort {
  record(entry: AuditEntry): void;
}

/** Optional domain ports; a tool that needs a missing port is not registered. */
export interface McpPorts {
  files?: FilesPort | undefined;
  documents?: DocumentsPort | undefined;
  changes?: ChangesPort | undefined;
  /** Defaults to the SQLite audit table (migration 0600). */
  audit?: AuditPort | undefined;
}
