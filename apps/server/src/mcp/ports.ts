import type {
  Block,
  Document,
  FileStatus,
  Page,
  RequestUploadsInput,
  SaveTranscriptInput,
  SearchKind,
  SearchPage,
  SourceFile,
  Transcript,
  UploadTicket,
  WriterOperation,
} from "@notes/schema";
import type { CanvasPort } from "../domains/canvas/index.js";
import type { ConceptsService } from "../domains/concepts/index.js";
import type { ExamsService } from "../domains/exams/index.js";
import type { LibraryService } from "../domains/library/index.js";
import type { MarginNotesService } from "../domains/margin-notes/index.js";
import type { PracticeService } from "../domains/practice/index.js";
import type { ReferencesService } from "../domains/references/index.js";
import type { RequestsService } from "../domains/requests/index.js";
import type { AuthContext } from "../http/auth-context.js";

/**
 * What the MCP layer needs from the domains. Each port is shaped like its
 * domain service (they take the caller's `AuthContext`, so every write is made
 * as the agent, checked for scope, and logged to the change feed and activity
 * log by the domain itself, exactly as through the HTTP API). `adapters.ts`
 * builds them from the shared `Services`; `fakes.ts` holds in-memory versions
 * for unit tests. A tool whose port is missing is not advertised.
 *
 * Conventions: another user's object behaves exactly like a missing one
 * (`AppError("not_found")`); failures are `AppError`s, passed to the agent
 * with web-API routes in their hints rewritten into tool calls.
 */

export interface PageResult<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ConverterState {
  /** "online" with a fresh heartbeat, "stale" when late, "offline" when missing. */
  state: "online" | "stale" | "offline";
  lastSeenAt: string | null;
  queued: number;
  processing: number;
}

export interface PageImage {
  data: Uint8Array;
  mimeType: string;
}

/** Files, pages, transcripts, the inbox and upload links (src/domains/files). */
export interface FilesPort {
  converterStatus(): ConverterState;
  listFiles(
    auth: AuthContext,
    options: {
      inbox?: boolean;
      status?: FileStatus | undefined;
      nodeId?: string | undefined;
      cursor?: string | undefined;
      limit: number;
    },
  ): PageResult<SourceFile>;
  getFile(auth: AuthContext, fileId: string): SourceFile;
  /** Every page of the file, in order. */
  listPages(auth: AuthContext, fileId: string): Page[];
  getPage(auth: AuthContext, pageId: string): Page;
  claim(auth: AuthContext, fileId: string): SourceFile;
  release(auth: AuthContext, fileId: string): SourceFile;
  /** Queue a failed conversion again. */
  retry(auth: AuthContext, fileId: string): SourceFile;
  /** File it under a lecture, folder or Sources section; null takes it back to the inbox. */
  fileUnder(
    auth: AuthContext,
    fileId: string,
    nodeId: string | null,
    options?: { force?: boolean | undefined; reason?: string | undefined },
  ): SourceFile;
  pageImage(auth: AuthContext, pageId: string, size: "page" | "thumb"): PageImage;
  /** A signed URL that needs no credential, valid for minutes. */
  pageImageLink(
    auth: AuthContext,
    pageId: string,
    size: "page" | "thumb",
  ): { url: string; expiresAt: string };
  /** The page's current transcript, or null. */
  getTranscript(auth: AuthContext, pageId: string): Transcript | null;
  saveTranscript(auth: AuthContext, input: SaveTranscriptInput): Transcript;
  requestUploads(auth: AuthContext, input: RequestUploadsInput): UploadTicket[];
}

/** The outcome of any document write, normalised over the domain's per-operation results. */
export interface WriteSummary {
  documentId: string;
  revision: number;
  /** New or changed blocks, in document order. */
  written: string[];
  removed: string[];
  /** Her blocks left alone (replace_generated). */
  skipped: Array<{ blockId: string; type: string; reason: string }>;
  /** Set by create_document: the node the document belongs to. */
  nodeId?: string;
}

export interface Reference {
  number: number;
  fileId: string;
  pageId: string;
  quote: string;
  status: string;
  fileName: string | null;
  pageIndex: number | null;
  /** Whether the quote is still in the page's current transcript (null: unknown). */
  quoteStillPresent: boolean | null;
}

/** Documents, blocks and citations (src/domains/documents). */
export interface DocumentsPort {
  getDocument(
    auth: AuthContext,
    documentId: string,
    range: { offset: number; limit: number },
  ): { document: Document; blocks: Block[]; total: number };
  /** The document of a lecture or document node, or null. */
  documentForNode(auth: AuthContext, nodeId: string): Document | null;
  getBlock(auth: AuthContext, documentId: string, blockId: string): Block;
  /** Apply one writer operation; the domain validates it again and enforces every rule. */
  write(auth: AuthContext, operation: WriterOperation, input: unknown): WriteSummary;
  /** The document's references list (K7), resolved against the sources. */
  references(auth: AuthContext, documentId: string): Reference[];
  /** How many blocks cite a page (K5). */
  citedByCount(auth: AuthContext, pageId: string): number;
}

export interface ChangeItem {
  seq: number;
  at: string;
  action: string;
  objectType: string;
  objectIds: string[];
  summary: string;
  actor: { type: string };
}

/** The change feed (src/domains/activity). */
export interface ChangesPort {
  changesSince(
    userId: string,
    cursor: string | undefined,
    limit: number,
  ): { items: ChangeItem[]; nextCursor: string; hasMore: boolean };
  latestCursor(userId: string): string;
}

/** Unified search over names, transcript pages and document blocks (src/domains/search). */
export interface SearchPort {
  search(
    userId: string,
    request: { q: string; kinds?: SearchKind[]; cursor?: string | undefined; limit: number },
  ): SearchPage;
}

/**
 * Practice, exams, requests and concepts are used through the domain services
 * themselves, narrowed to the methods the tools call (they already take the
 * caller's AuthContext, so no adapter is needed). Session-taking and answering
 * are deliberately absent: an agent can never sit a practice session for her.
 */
export type PracticeToolPort = Pick<
  PracticeService,
  | "createQuestions"
  | "validateQuestions"
  | "getQuestion"
  | "listQuestions"
  | "updateQuestion"
  | "trashQuestion"
  | "restoreQuestion"
  | "listSessions"
  | "results"
  | "weakAreas"
  | "notebook"
  | "dueList"
>;
export type ExamsToolPort = Pick<
  ExamsService,
  "createExam" | "updateExam" | "getExam" | "listExams" | "upcoming"
>;
export type RequestsToolPort = Pick<
  RequestsService,
  "list" | "get" | "counts" | "claim" | "release" | "complete" | "decline"
>;
export type ConceptsToolPort = Pick<
  ConceptsService,
  | "bulkUpsert"
  | "getConcept"
  | "page"
  | "search"
  | "neighbourhood"
  | "path"
  | "filter"
  | "compare"
  | "merge"
  | "suggestionsFor"
>;

/** Her saved outside references: read and add only; changing and deleting stay hers. */
export type ReferencesToolPort = Pick<ReferencesService, "list" | "create">;

/** Her side notes (docs/side-notes.md): read only. Only her browser session writes them. */
export type MarginNotesToolPort = Pick<MarginNotesService, "forAgent" | "recent">;

/** The study map (docs/canvas.md): read, set the structure, change; validation problems come back, not thrown. */
export type CanvasToolPort = CanvasPort;

/** Everything the MCP layer runs on. Only `library` is required. */
export interface McpBackend {
  library: LibraryService;
  search?: SearchPort | undefined;
  files?: FilesPort | undefined;
  documents?: DocumentsPort | undefined;
  changes?: ChangesPort | undefined;
  practice?: PracticeToolPort | undefined;
  exams?: ExamsToolPort | undefined;
  requests?: RequestsToolPort | undefined;
  concepts?: ConceptsToolPort | undefined;
  canvas?: CanvasToolPort | undefined;
  references?: ReferencesToolPort | undefined;
  marginNotes?: MarginNotesToolPort | undefined;
}
