import {
  type Actor,
  applyBlockPatch,
  type Block,
  type BlockInput,
  type BlockType,
  blockCitations,
  blockPlainText,
  type Citation,
  type CitationBacklink,
  type CitationStatus,
  canAgentOverwrite,
  citationIndexRows,
  citationKey,
  DOCUMENT_LIMITS,
  type Document,
  type DocumentWithBlocks,
  documentReviewStatus,
  EXAMPLE_CITATION,
  formatPath,
  insertIds,
  listReferences,
  markReviewed,
  moveIds,
  newId,
  planRegeneration,
  protectionReason,
  type Reference,
  type ReplaceGeneratedResult,
  type Revision,
  type RevisionSummary,
  restoreRevision,
  type SkippedBlock,
  snapshotDocument,
  stampEditedBlock,
  stampNewBlock,
  validateOperation,
  WRITER_OPERATIONS,
  type WriterOperation,
} from "@notes/schema";
import type { z } from "zod";
import type { Db } from "../../db/client.js";
import type { AuthContext } from "../../http/auth-context.js";
import type { ServerDeps } from "../../http/deps.js";
import { AppError } from "../../http/errors.js";
import { type ActivityLink, type ActivityPort, createActivityLog } from "../activity/activity.js";
import { type ChangeFeed, createChangeFeed } from "../activity/changes.js";
import { createLibraryService, type LibraryService } from "../library/index.js";
import {
  conflictRevision,
  forbiddenWrite,
  notFoundBlock,
  notFoundDocument,
  problemsToError,
} from "./errors.js";
import { type SourceLookup, type SourceRef, unknownSources } from "./ports.js";
import { createRepo, type DocRow, toDocument } from "./repo.js";

/** Newest revisions kept per document, plus revision 1. See `pruneRevisions` in the repo. */
export const DEFAULT_REVISION_CAP = 200;
const PREVIEW_CHARS = 120;
const MAX_FEED_BLOCK_IDS = 100;
const DEFAULT_PAGE = 50;

/** What the service needs besides the database and the clock. */
export interface DocumentsPorts {
  /** Where cited sources are looked up. Default: every source unknown but allowed. */
  sources?: SourceLookup;
  /** Share the library service of the rest of the app. Default: a new one over the same database. */
  library?: LibraryService;
  /** Share the change feed and activity log. Default: new ones over the same database. */
  changes?: ChangeFeed;
  activity?: ActivityPort;
  /** Newest revisions to keep per document (plus revision 1). Default 200. */
  revisionCap?: number;
}

export type OperationInput<K extends WriterOperation> = z.input<(typeof WRITER_OPERATIONS)[K]>;
type Parsed<K extends WriterOperation> = z.output<(typeof WRITER_OPERATIONS)[K]>;

export interface WriteResult {
  documentId: string;
  /** The document's revision after this write. */
  revision: number;
}
export interface CreateResult extends WriteResult {
  nodeId: string;
  blockIds: string[];
}
export interface InsertResult extends WriteResult {
  blockIds: string[];
}
export interface UpdateResult extends WriteResult {
  block: Block;
}
export interface MoveResult extends WriteResult {
  blockIds: string[];
  /** Set when the blocks went to another document: its revision after the move. */
  toDocumentId?: string;
  toRevision?: number;
}
export interface DeleteResult extends WriteResult {
  removed: string[];
}
export interface RestoreResult extends WriteResult {
  restoredFrom: number;
  blockCount: number;
}

export type OperationResult =
  | ({ operation: "create_document" } & CreateResult)
  | ({ operation: "insert_blocks" } & InsertResult)
  | ({ operation: "update_block" } & UpdateResult)
  | ({ operation: "move_blocks" } & MoveResult)
  | ({ operation: "delete_blocks" } & DeleteResult)
  | ({ operation: "replace_generated" } & ReplaceGeneratedResult)
  | ({ operation: "restore_revision" } & RestoreResult);

export interface BatchOperation {
  operation: WriterOperation;
  input: unknown;
}

export interface BlockPreview {
  id: string;
  type: BlockType;
  /** The first words of the block's text. */
  preview: string;
  origin: Block["origin"];
  review: Block["review"]["status"];
  generalKnowledge: boolean;
  citationCount: number;
  flagCount: number;
  lastEditedBy: Actor;
  lastEditedAt: string;
}

export interface LightDocument {
  document: Document;
  blocks: BlockPreview[];
  unverifiedCount: number;
}

export interface ContentRange {
  document: Document;
  blocks: Block[];
  /** Index of the first block returned, and how many the document has. */
  from: number;
  total: number;
}

export interface ReferenceEntry extends Reference {
  status: CitationStatus;
  /** The source cannot be opened right now (trashed or deleted). */
  unavailable: boolean;
  fileName: string | null;
  pageIndex: number | null;
  /** Null when the files domain cannot say. */
  quoteStillPresent: boolean | null;
  currentTranscriptRevision: number | null;
}

export interface Paged<T> {
  items: T[];
  nextCursor: string | null;
}

export interface SearchBlockHit {
  kind: "block";
  documentId: string;
  nodeId: string;
  documentTitle: string;
  blockId: string;
  blockType: BlockType;
  snippet: string;
}

export interface CitedBy {
  /** Set for page lookups; null when nothing cites the page yet. */
  fileId: string | null;
  pageId: string | null;
  items: Array<CitationBacklink & { documentId: string; blockId: string | null }>;
  nextCursor: string | null;
}

export interface ReviewInput {
  documentId: string;
  status: "reviewed" | "unverified";
  /** Omit to mark the whole document. */
  blockIds?: string[] | undefined;
  expectedRevision?: number | undefined;
}

export interface ListOptions {
  cursor?: string | undefined;
  limit?: number | undefined;
  /** Skip this many hits (search only). Takes the place of `cursor`; the unified search pages with it. */
  offset?: number | undefined;
}

// ---------------------------------------------------------------------------

interface Work {
  row: DocRow;
  isNew: boolean;
  baseRevision: number;
  title: string;
  kind: Document["kind"];
  before: Block[];
  blocks: Block[];
  changed: boolean;
  restoredFrom: number | null;
  notes: string[];
  operations: string[];
  touched: Set<string>;
}

interface Ctx {
  auth: AuthContext;
  userId: string;
  actor: Actor;
  isAgent: boolean;
  now: string;
  works: Map<string, Work>;
  requestIds: Set<string>;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function encodeOffset(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset })).toString("base64url");
}

function decodeOffset(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString()) as { o?: unknown };
    if (typeof value.o === "number" && Number.isInteger(value.o) && value.o >= 0) return value.o;
  } catch {
    // fall through
  }
  throw new AppError("invalid_input", "That cursor is not one this list gave out.", {
    hint: 'Use the "nextCursor" of a previous response, or leave the cursor out.',
  });
}

function limitOf(options: ListOptions): number {
  return Math.min(Math.max(options.limit ?? DEFAULT_PAGE, 1), 200);
}

function previewOf(block: Block): string {
  const text = blockPlainText(block).replace(/\s+/g, " ").trim();
  return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS - 1)}…` : text;
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Turn free text into a safe FTS5 query: every word a quoted prefix term. */
function ftsQuery(text: string): string | null {
  const words = text.match(/[\p{L}\p{N}]+/gu)?.slice(0, 12) ?? [];
  return words.length === 0 ? null : words.map((w) => `"${w}"*`).join(" ");
}

export function createDocumentsService(
  deps: Pick<ServerDeps, "db" | "now">,
  ports: DocumentsPorts = {},
) {
  const db: Db = deps.db;
  const sources = ports.sources ?? unknownSources;
  const library = ports.library ?? createLibraryService(db, { now: () => new Date(deps.now()) });
  const feed = ports.changes ?? createChangeFeed(db, deps.now);
  const activity = ports.activity ?? createActivityLog(db, deps.now).port;
  const cap = Math.max(1, ports.revisionCap ?? DEFAULT_REVISION_CAP);
  const repo = createRepo(db);

  const nowIso = () => new Date(deps.now()).toISOString();

  // ---- guards ---------------------------------------------------------

  function assertWrite(auth: AuthContext): void {
    if (auth.scope !== "write") {
      throw new AppError("read_only_key", "This API key is read-only.", {
        hint: "Create a read-write key in Settings to make changes.",
      });
    }
  }

  function assertSession(auth: AuthContext, what: string): void {
    if (auth.via !== "session" || auth.actor.type !== "user") {
      throw new AppError("forbidden", `${what} needs a signed-in browser session.`, {
        hint: "Only she can verify content. Ask her to do it in the app.",
      });
    }
  }

  function visibleDoc(userId: string, id: string): DocRow {
    const row = repo.doc(userId, id);
    if (!row || row.trashed_at !== null) throw notFoundDocument();
    return row;
  }

  // ---- reads ----------------------------------------------------------

  function lightOf(row: DocRow): LightDocument {
    const blocks = repo.blocks(row.id);
    return {
      document: toDocument(
        row,
        blocks.map((b) => b.id),
      ),
      blocks: blocks.map(
        (b): BlockPreview => ({
          id: b.id,
          type: b.type,
          preview: previewOf(b),
          origin: b.origin,
          review: b.review.status,
          generalKnowledge: b.generalKnowledge,
          citationCount: blockCitations(b).length,
          flagCount: b.flags.length,
          lastEditedBy: b.provenance.lastEditedBy,
          lastEditedAt: b.provenance.lastEditedAt,
        }),
      ),
      unverifiedCount: blocks.filter(
        (b) => b.type !== "divider" && b.review.status === "unverified",
      ).length,
    };
  }

  /** Metadata and a light block list: IDs, types and short previews. */
  function getDocument(auth: AuthContext, id: string): LightDocument {
    return lightOf(visibleDoc(auth.userId, id));
  }

  /** The document of a library node. */
  function getDocumentByNode(auth: AuthContext, nodeId: string): LightDocument {
    const row = repo.docByNode(auth.userId, nodeId);
    if (!row || row.trashed_at !== null) throw notFoundDocument();
    return lightOf(row);
  }

  /** Full blocks, optionally a range of them (`from` is a 0-based index). */
  function getFull(
    auth: AuthContext,
    id: string,
    range: { from?: number | undefined; limit?: number | undefined } = {},
  ): ContentRange {
    const row = visibleDoc(auth.userId, id);
    const all = repo.blocks(row.id);
    const from = Math.min(Math.max(range.from ?? 0, 0), all.length);
    const blocks =
      range.limit === undefined ? all.slice(from) : all.slice(from, from + range.limit);
    return {
      document: toDocument(
        row,
        all.map((b) => b.id),
      ),
      blocks,
      from,
      total: all.length,
    };
  }

  function getBlock(auth: AuthContext, documentId: string, blockId: string): Block {
    const row = visibleDoc(auth.userId, documentId);
    const block = repo.blocks(row.id).find((b) => b.id === blockId);
    if (!block) throw notFoundBlock(documentId, [blockId]);
    return block;
  }

  function listRevisions(
    auth: AuthContext,
    documentId: string,
    options: ListOptions = {},
  ): Paged<RevisionSummary> {
    visibleDoc(auth.userId, documentId);
    const limit = limitOf(options);
    const offset = decodeOffset(options.cursor);
    const rows = db
      .prepare(
        `SELECT id, document_id, number, author, created_at, summary, restored_from, block_count
         FROM document_revisions WHERE document_id = ? ORDER BY number DESC LIMIT ? OFFSET ?`,
      )
      .all(documentId, limit + 1, offset) as Array<{
      id: string;
      document_id: string;
      number: number;
      author: string;
      created_at: string;
      summary: string | null;
      restored_from: number | null;
      block_count: number;
    }>;
    const more = rows.length > limit;
    return {
      items: (more ? rows.slice(0, limit) : rows).map((r) => ({
        id: r.id,
        documentId: r.document_id,
        number: r.number,
        author: JSON.parse(r.author) as Actor,
        createdAt: r.created_at,
        summary: r.summary,
        restoredFrom: r.restored_from,
        blockCount: r.block_count,
      })),
      nextCursor: more ? encodeOffset(offset + limit) : null,
    };
  }

  function revisionOrThrow(userId: string, documentId: string, number: number) {
    const row = repo.revision(userId, documentId, number);
    if (!row) {
      const oldest = repo.oldestKeptRevision(documentId);
      throw new AppError("not_found", `Revision ${number} is not in this document's history.`, {
        hint: `It may be newer than the document or pruned: revision 1 and the newest ${cap} are kept${
          oldest ? ` (the oldest of those is ${oldest})` : ""
        }. List them with GET /api/documents/${documentId}/revisions.`,
      });
    }
    return row;
  }

  function getRevision(auth: AuthContext, documentId: string, number: number): Revision {
    visibleDoc(auth.userId, documentId);
    const r = revisionOrThrow(auth.userId, documentId, number);
    return {
      id: r.id,
      documentId: r.document_id,
      number: r.number,
      author: JSON.parse(r.author) as Actor,
      createdAt: r.created_at,
      summary: r.summary,
      restoredFrom: r.restored_from,
      snapshot: JSON.parse(r.snapshot) as Revision["snapshot"],
    };
  }

  /** The references list (K7), each passage resolved through the source lookup (K6). */
  function references(
    auth: AuthContext,
    documentId: string,
  ): {
    documentId: string;
    revision: number;
    items: ReferenceEntry[];
  } {
    const row = visibleDoc(auth.userId, documentId);
    const refs = listReferences(repo.blocks(row.id));
    const infos = sources.resolve(
      auth.userId,
      refs.map((r): SourceRef => toRef(r.citation)),
    );
    const items = refs.map((ref, i): ReferenceEntry => {
      const info = infos[i];
      const exists = info ? info.exists : true;
      const trashed = info ? info.trashed : false;
      const status: CitationStatus = !exists
        ? "source_deleted"
        : trashed
          ? "source_trashed"
          : "available";
      return {
        ...ref,
        status,
        unavailable: status !== "available",
        fileName: exists ? (info?.fileName ?? null) : null,
        pageIndex: exists ? (info?.pageIndex ?? null) : null,
        quoteStillPresent: info?.quoteFound ?? null,
        currentTranscriptRevision: info?.currentTranscriptRevision ?? null,
      };
    });
    return { documentId, revision: row.revision, items };
  }

  /** Reverse lookup (K5): everything that cites a page, or any page of a file. */
  function citedBy(
    auth: AuthContext,
    target: { pageId: string } | { fileId: string },
    options: ListOptions = {},
  ): CitedBy {
    if (sources.exists && !sources.exists(auth.userId, target)) {
      const what = "pageId" in target ? "page" : "file";
      throw new AppError("not_found", `No such ${what}.`, {
        hint: `Check the ${what} ID; it must be one of her ${what}s that has not been deleted.`,
      });
    }
    const limit = limitOf(options);
    const offset = decodeOffset(options.cursor);
    const column = "pageId" in target ? "page_id" : "file_id";
    const value = "pageId" in target ? target.pageId : target.fileId;
    const rows = db
      .prepare(
        `SELECT c.*, d.title, d.node_id, d.trashed_at FROM document_citations c
         JOIN documents d ON d.id = c.document_id
         WHERE c.user_id = ? AND c.${column} = ?
         ORDER BY c.seq LIMIT ? OFFSET ?`,
      )
      .all(auth.userId, value, limit + 1, offset) as Array<{
      document_id: string;
      block_id: string;
      field: string | null;
      file_id: string;
      page_id: string;
      item_type: string;
      quote: string;
      region: string | null;
      title: string;
      node_id: string;
      trashed_at: string | null;
    }>;
    const more = rows.length > limit;
    const slice = more ? rows.slice(0, limit) : rows;
    const first = slice[0];
    return {
      fileId: "fileId" in target ? target.fileId : (first?.file_id ?? null),
      pageId: "pageId" in target ? target.pageId : null,
      items: slice.map((r) => ({
        location: {
          kind: "block" as const,
          documentId: r.document_id,
          blockId: r.block_id,
          field: r.field,
        },
        documentId: r.document_id,
        blockId: r.block_id,
        title: r.title,
        nodeId: r.node_id,
        itemType: r.item_type,
        quote: r.quote,
        ...(r.region ? { region: JSON.parse(r.region) } : {}),
        trashed: r.trashed_at !== null,
      })),
      nextCursor: more ? encodeOffset(offset + limit) : null,
    };
  }

  /** Block hits across her documents, best first. Trashed documents are excluded. */
  function searchDocuments(
    userId: string,
    query: string,
    options: ListOptions = {},
  ): Paged<SearchBlockHit> {
    const match = ftsQuery(query);
    if (match === null) return { items: [], nextCursor: null };
    const limit = limitOf(options);
    const offset = options.offset ?? decodeOffset(options.cursor);
    const rows = db
      .prepare(
        `SELECT b.id AS block_id, b.type, b.document_id, d.node_id, d.title,
                snippet(blocks_fts, 0, '', '', '…', 12) AS snippet
         FROM blocks_fts JOIN blocks b ON b.seq = blocks_fts.rowid
         JOIN documents d ON d.id = b.document_id
         WHERE blocks_fts MATCH ? AND d.user_id = ? AND d.trashed_at IS NULL
         ORDER BY blocks_fts.rank, b.seq LIMIT ? OFFSET ?`,
      )
      .all(match, userId, limit + 1, offset) as Array<{
      block_id: string;
      type: BlockType;
      document_id: string;
      node_id: string;
      title: string;
      snippet: string;
    }>;
    const more = rows.length > limit;
    return {
      items: (more ? rows.slice(0, limit) : rows).map((r) => ({
        kind: "block" as const,
        documentId: r.document_id,
        nodeId: r.node_id,
        documentTitle: r.title,
        blockId: r.block_id,
        blockType: r.type,
        snippet: r.snippet,
      })),
      nextCursor: more ? encodeOffset(offset + limit) : null,
    };
  }

  // ---- writes: working state -------------------------------------------

  function loadWork(ctx: Ctx, documentId: string): Work {
    const known = ctx.works.get(documentId);
    if (known) return known;
    const row = visibleDoc(ctx.userId, documentId);
    const blocks = repo.blocks(documentId);
    const work: Work = {
      row,
      isNew: false,
      baseRevision: row.revision,
      title: row.title,
      kind: row.kind,
      before: blocks,
      blocks: [...blocks],
      changed: false,
      restoredFrom: null,
      notes: [],
      operations: [],
      touched: new Set(),
    };
    ctx.works.set(documentId, work);
    return work;
  }

  function checkRevision(work: Work, expected: number | undefined): void {
    if (expected !== undefined && expected !== work.baseRevision) {
      throw conflictRevision(work.row.id, expected, work.baseRevision);
    }
  }

  function checkSize(count: number): void {
    if (count > DOCUMENT_LIMITS.blocks) {
      throw new AppError(
        "invalid_input",
        `A document holds at most ${DOCUMENT_LIMITS.blocks} blocks; this would make ${count}.`,
        { hint: "Split the material into another document, or delete blocks first." },
      );
    }
  }

  function note(work: Work, operation: string, text: string, touched: readonly string[]): void {
    work.changed = true;
    work.notes.push(text);
    work.operations.push(operation);
    for (const id of touched) work.touched.add(id);
  }

  /** An agent may not overwrite or delete blocks she wrote, edited or reviewed, without her request. */
  function guardOverwrite(
    ctx: Ctx,
    operation: WriterOperation,
    blocks: readonly Block[],
    requestId: string | undefined,
  ): void {
    if (requestId) ctx.requestIds.add(requestId);
    if (!ctx.isAgent) return;
    const refused = blocks
      .map((block) => ({ block, decision: canAgentOverwrite(block, { requestId }) }))
      .filter((r) => !r.decision.allowed);
    if (refused.length === 0) return;
    const first = refused[0];
    if (refused.length === 1 && first && !first.decision.allowed) {
      throw forbiddenWrite(
        operation,
        `Block ${first.block.id} (${first.block.type}) is protected. ${first.decision.message}`,
      );
    }
    const list = refused
      .map((r) => `${r.block.id} (${!r.decision.allowed ? r.decision.reason : ""})`)
      .join(", ");
    throw forbiddenWrite(
      operation,
      `${refused.length} of these blocks are protected: ${list}. She wrote, edited or reviewed them, so agents leave them alone. To change them anyway, act on a request from her that asks for this change and pass its requestId.`,
    );
  }

  /** Citations an agent introduces must point at sources that exist and quote them exactly. */
  function checkSources(
    ctx: Ctx,
    items: ReadonlyArray<{ block: BlockInput; prefix: string; existing?: BlockInput | undefined }>,
  ): void {
    if (!ctx.isAgent) return;
    const wants: Array<{ ref: SourceRef; path: string }> = [];
    for (const { block, prefix, existing } of items) {
      const have = new Set(
        existing ? blockCitations(existing).map((u) => citationKey(u.citation)) : [],
      );
      const seen = new Map<string, number>();
      for (const use of blockCitations(block)) {
        const field = use.field ? formatPath(use.field).slice(1) : "";
        const index = seen.get(field) ?? 0;
        seen.set(field, index + 1);
        if (have.has(citationKey(use.citation))) continue;
        wants.push({ ref: toRef(use.citation), path: `${prefix}${field}.citations[${index}]` });
      }
    }
    if (wants.length === 0) return;
    const infos = sources.resolve(
      ctx.userId,
      wants.map((w) => w.ref),
    );
    const problems: Array<{ path: string; message: string; example: unknown }> = [];
    wants.forEach((want, i) => {
      const info = infos[i];
      if (!info) return;
      let message: string | null = null;
      if (!info.exists) {
        message =
          "This file and page are not in her library (check both IDs; the page must belong to the file). Cite a page you read from her sources.";
      } else if (info.trashed) {
        message =
          "This source is in the trash. Cite sources that are not trashed, or ask her to restore the file.";
      } else if (info.quoteFound === false) {
        message = `The quote does not occur, character for character, in the page's current transcript${
          info.currentTranscriptRevision ? ` (revision ${info.currentTranscriptRevision})` : ""
        }. Copy the supporting passage exactly from GET /api/pages/${want.ref.pageId}/transcript.`;
      }
      if (message) problems.push({ path: want.path, message, example: EXAMPLE_CITATION });
    });
    if (problems.length > 0) throw problemsToError(problems);
  }

  // ---- writes: operations ---------------------------------------------

  function opCreate(ctx: Ctx, input: Parsed<"create_document">): CreateResult {
    let nodeId = input.nodeId;
    if (nodeId !== undefined) {
      const node = library.get(ctx.userId, nodeId);
      if (node.kind !== "document" && node.kind !== "lecture") {
        throw new AppError("invalid_input", `A ${node.kind} cannot hold a document.`, {
          hint: 'Use a node of kind "document" or "lecture", or pass parentId to create a new document node under a section or folder.',
          example: {
            parentId: "nod_01J9Z8Y7X6W5V4T3S2R1Q0P9N8",
            kind: input.kind,
            title: input.title,
          },
        });
      }
      if (node.trashedAt !== null) {
        throw new AppError("conflict", "That node is in the trash.", {
          hint: `Restore it first: POST /api/nodes/${node.id}/restore.`,
        });
      }
      const existing = repo.docByNode(ctx.userId, node.id);
      if (existing) {
        throw new AppError("conflict", "That node already has a document.", {
          hint: `Write to it instead: document ${existing.id}.`,
          example: { documentId: existing.id },
        });
      }
    } else {
      nodeId = library.create(ctx.userId, {
        parentId: input.parentId as string,
        kind: "document",
        name: input.title,
      }).id;
    }
    const blocks = input.blocks.map((b) => stampNewBlock(b, { actor: ctx.actor, now: ctx.now }));
    checkSources(
      ctx,
      input.blocks.map((block, i) => ({ block, prefix: `$.blocks[${i}]` })),
    );
    const id = newId("document");
    const row: DocRow = {
      seq: 0,
      id,
      user_id: ctx.userId,
      node_id: nodeId as string,
      kind: input.kind,
      title: input.title,
      review_status: documentReviewStatus(blocks),
      revision: 0,
      created_by: JSON.stringify(ctx.actor),
      created_at: ctx.now,
      last_edited_by: JSON.stringify(ctx.actor),
      updated_at: ctx.now,
      trashed_at: null,
    };
    const work: Work = {
      row,
      isNew: true,
      baseRevision: 0,
      title: input.title,
      kind: input.kind,
      before: [],
      blocks,
      changed: true,
      restoredFrom: null,
      notes: [
        blocks.length > 0
          ? `Created the document with ${plural(blocks.length, "block")}`
          : "Created the document",
      ],
      operations: ["create_document"],
      touched: new Set(blocks.map((b) => b.id)),
    };
    ctx.works.set(id, work);
    return {
      documentId: id,
      nodeId: nodeId as string,
      revision: 1,
      blockIds: blocks.map((b) => b.id),
    };
  }

  function opInsert(ctx: Ctx, input: Parsed<"insert_blocks">): InsertResult {
    const work = loadWork(ctx, input.documentId);
    checkRevision(work, input.expectedRevision);
    checkSources(
      ctx,
      input.blocks.map((block, i) => ({ block, prefix: `$.blocks[${i}]` })),
    );
    const fresh = input.blocks.map((b) => stampNewBlock(b, { actor: ctx.actor, now: ctx.now }));
    const order = insertIds(
      work.blocks.map((b) => b.id),
      fresh.map((b) => b.id),
      input.position,
    );
    if (order === null) throw badAnchor(work, input.position);
    checkSize(order.length);
    const byId = new Map([...work.blocks, ...fresh].map((b) => [b.id, b]));
    work.blocks = order.map((id) => byId.get(id) as Block);
    const ids = fresh.map((b) => b.id);
    note(work, "insert_blocks", `Inserted ${plural(fresh.length, "block")}`, ids);
    return { documentId: work.row.id, revision: work.baseRevision + 1, blockIds: ids };
  }

  function badAnchor(work: Work, position: unknown): AppError {
    const anchor =
      typeof position === "object" && position !== null
        ? ((position as { after?: string; before?: string }).after ??
          (position as { before?: string }).before)
        : undefined;
    return new AppError(
      "not_found",
      `Block ${anchor ?? "(anchor)"} is not in this document, so nothing can be placed next to it.`,
      {
        hint: `Read the document for its block IDs: GET /api/documents/${work.row.id}. Or use "start", "end" or {"index": n}.`,
        example: { position: "end" },
      },
    );
  }

  function opUpdate(ctx: Ctx, input: Parsed<"update_block">): UpdateResult {
    const work = loadWork(ctx, input.documentId);
    checkRevision(work, input.expectedRevision);
    const at = work.blocks.findIndex((b) => b.id === input.blockId);
    const existing = work.blocks[at];
    if (at < 0 || !existing) throw notFoundBlock(work.row.id, [input.blockId]);
    guardOverwrite(ctx, "update_block", [existing], input.requestId);

    let next: BlockInput;
    if (input.mode === "replace") {
      next = input.block;
    } else {
      const patched = applyBlockPatch(existing, input.patch, {
        writer: ctx.actor,
        pathPrefix: "$.patch",
      });
      if (!patched.ok) throw problemsToError(patched.problems);
      next = patched.block;
    }
    checkSources(ctx, [
      { block: next, prefix: input.mode === "replace" ? "$.block" : "$.patch", existing },
    ]);
    const edited = stampEditedBlock(existing, next, { actor: ctx.actor, now: ctx.now });
    work.blocks[at] = edited;
    note(
      work,
      "update_block",
      `${input.mode === "replace" ? "Replaced" : "Edited"} a ${edited.type} block`,
      [edited.id],
    );
    return { documentId: work.row.id, revision: work.baseRevision + 1, block: edited };
  }

  function dupes(ids: readonly string[]): string[] {
    return ids.filter((id, i) => ids.indexOf(id) !== i);
  }

  function opMove(ctx: Ctx, input: Parsed<"move_blocks">): MoveResult {
    const work = loadWork(ctx, input.documentId);
    checkRevision(work, input.expectedRevision);
    const repeated = dupes(input.blockIds);
    if (repeated.length > 0) {
      throw new AppError("invalid_input", `Block ${repeated[0]} is listed twice.`, {
        hint: "List each block once, in the order they should end up.",
      });
    }
    const order = work.blocks.map((b) => b.id);
    const missing = input.blockIds.filter((id) => !order.includes(id));
    if (missing.length > 0) throw notFoundBlock(work.row.id, missing);
    const result: MoveResult = {
      documentId: work.row.id,
      revision: work.baseRevision + 1,
      blockIds: [...input.blockIds],
    };

    if (input.toDocumentId === undefined || input.toDocumentId === work.row.id) {
      const next = moveIds(order, input.blockIds, input.position);
      if (next === null) throw anchorInMoved(work, input.position);
      const byId = new Map(work.blocks.map((b) => [b.id, b]));
      const reordered = next.map((id) => byId.get(id) as Block);
      if (reordered.every((b, i) => b === work.blocks[i])) return result;
      work.blocks = reordered;
      note(work, "move_blocks", `Moved ${plural(input.blockIds.length, "block")}`, input.blockIds);
      return result;
    }

    const target = loadWork(ctx, input.toDocumentId);
    const moving = input.blockIds.map((id) => work.blocks.find((b) => b.id === id) as Block);
    const targetOrder = insertIds(
      target.blocks.map((b) => b.id),
      input.blockIds,
      input.position,
    );
    if (targetOrder === null) throw badAnchor(target, input.position);
    checkSize(targetOrder.length);
    const byId = new Map([...target.blocks, ...moving].map((b) => [b.id, b]));
    work.blocks = work.blocks.filter((b) => !input.blockIds.includes(b.id));
    target.blocks = targetOrder.map((id) => byId.get(id) as Block);
    note(
      work,
      "move_blocks",
      `Moved ${plural(moving.length, "block")} to "${target.title}"`,
      input.blockIds,
    );
    note(
      target,
      "move_blocks",
      `Received ${plural(moving.length, "block")} from "${work.title}"`,
      input.blockIds,
    );
    result.toDocumentId = target.row.id;
    result.toRevision = target.baseRevision + 1;
    return result;
  }

  function anchorInMoved(work: Work, position: unknown): AppError {
    const anchor =
      (position as { after?: string; before?: string } | null)?.after ??
      (position as { before?: string } | null)?.before;
    const inDoc = anchor !== undefined && work.blocks.some((b) => b.id === anchor);
    return inDoc
      ? new AppError("invalid_input", `Block ${anchor} is one of the blocks being moved.`, {
          hint: "Place the blocks next to a block that stays where it is.",
        })
      : badAnchor(work, position);
  }

  function opDelete(ctx: Ctx, input: Parsed<"delete_blocks">): DeleteResult {
    const work = loadWork(ctx, input.documentId);
    checkRevision(work, input.expectedRevision);
    const repeated = dupes(input.blockIds);
    if (repeated.length > 0) {
      throw new AppError("invalid_input", `Block ${repeated[0]} is listed twice.`, {
        hint: "List each block once.",
      });
    }
    const missing = input.blockIds.filter((id) => !work.blocks.some((b) => b.id === id));
    if (missing.length > 0) throw notFoundBlock(work.row.id, missing);
    const doomed = work.blocks.filter((b) => input.blockIds.includes(b.id));
    guardOverwrite(ctx, "delete_blocks", doomed, input.requestId);
    work.blocks = work.blocks.filter((b) => !input.blockIds.includes(b.id));
    note(work, "delete_blocks", `Deleted ${plural(doomed.length, "block")}`, input.blockIds);
    return {
      documentId: work.row.id,
      revision: work.baseRevision + 1,
      removed: doomed.map((b) => b.id),
    };
  }

  function opRegenerate(ctx: Ctx, input: Parsed<"replace_generated">): ReplaceGeneratedResult {
    const work = loadWork(ctx, input.documentId);
    checkRevision(work, input.expectedRevision);
    if (input.requestId) ctx.requestIds.add(input.requestId);
    if (input.scope) {
      const missing = input.scope.filter((id) => !work.blocks.some((b) => b.id === id));
      if (missing.length > 0) throw notFoundBlock(work.row.id, missing);
    }
    checkSources(
      ctx,
      input.blocks.map((block, i) => ({ block, prefix: `$.blocks[${i}]` })),
    );
    // When she regenerates herself nothing is protected from her: her own request stands in.
    const requestId = input.requestId ?? (ctx.isAgent ? undefined : "user");
    const plan = planRegeneration(work.blocks, input.blocks, {
      actor: ctx.actor,
      now: ctx.now,
      requestId,
      ...(input.scope ? { scope: input.scope } : {}),
    });
    checkSize(plan.blocks.length);
    const skipped: SkippedBlock[] = plan.skipped.map((s) => ({
      blockId: s.blockId,
      type: s.type,
      reason: s.reason,
    }));
    if (plan.written.length > 0 || plan.removed.length > 0) {
      work.blocks = plan.blocks;
      note(
        work,
        "replace_generated",
        `Regenerated: wrote ${plural(plan.written.length, "block")}, removed ${plan.removed.length}${
          skipped.length > 0 ? `, left ${skipped.length} of hers alone` : ""
        }`,
        [...plan.written, ...plan.removed, ...skipped.map((s) => s.blockId)],
      );
    }
    return {
      documentId: work.row.id,
      revision: work.baseRevision + 1,
      written: plan.written,
      removed: plan.removed,
      skipped,
    };
  }

  function opRestore(ctx: Ctx, input: Parsed<"restore_revision">): RestoreResult {
    const work = loadWork(ctx, input.documentId);
    checkRevision(work, input.expectedRevision);
    const stored = revisionOrThrow(ctx.userId, work.row.id, input.revision);
    const revision: Revision = {
      id: stored.id,
      documentId: stored.document_id,
      number: stored.number,
      author: JSON.parse(stored.author) as Actor,
      createdAt: stored.created_at,
      summary: stored.summary,
      restoredFrom: stored.restored_from,
      snapshot: JSON.parse(stored.snapshot) as Revision["snapshot"],
    };
    if (ctx.isAgent) {
      // Restoring must not be a way round edit protection.
      const wanted = new Map(revision.snapshot.blocks.map((b) => [b.id, b]));
      const lost = work.blocks.filter((b) => {
        if (protectionReason(b) === null) return false;
        const back = wanted.get(b.id);
        return !back || !sameJson(back, b);
      });
      if (lost.length > 0) {
        throw forbiddenWrite(
          "restore_revision",
          `Restoring revision ${input.revision} would change or remove ${plural(lost.length, "block")} she wrote, edited or reviewed (${lost.map((b) => b.id).join(", ")}). Agents leave those alone; ask her to restore this version in the app.`,
        );
      }
    }
    const current = restoreRevision(asDocument(work), revision, { actor: ctx.actor, now: ctx.now });
    work.title = current.title;
    work.kind = current.kind;
    work.blocks = current.blocks;
    work.restoredFrom = input.revision;
    const touched = new Set([...work.before.map((b) => b.id), ...current.blocks.map((b) => b.id)]);
    note(work, "restore_revision", `Restored revision ${input.revision}`, [...touched]);
    return {
      documentId: work.row.id,
      revision: work.baseRevision + 1,
      restoredFrom: input.revision,
      blockCount: current.blocks.length,
    };
  }

  function asDocument(work: Work): DocumentWithBlocks {
    return {
      ...toDocument(
        work.row,
        work.blocks.map((b) => b.id),
      ),
      title: work.title,
      kind: work.kind,
      revision: work.baseRevision,
      blocks: work.blocks,
    };
  }

  // ---- writes: commit --------------------------------------------------

  function commit(ctx: Ctx, work: Work): number {
    const revision = work.baseRevision + 1;
    const row = work.row;
    const reviewStatus = documentReviewStatus(work.blocks);
    if (work.isNew) {
      repo.insertDoc({
        id: row.id,
        user_id: row.user_id,
        node_id: row.node_id,
        kind: work.kind,
        title: work.title,
        review_status: reviewStatus,
        revision,
        created_by: row.created_by,
        created_at: row.created_at,
        last_edited_by: JSON.stringify(ctx.actor),
        updated_at: ctx.now,
      });
    } else {
      repo.updateDoc({
        id: row.id,
        kind: work.kind,
        title: work.title,
        review_status: reviewStatus,
        revision,
        last_edited_by: JSON.stringify(ctx.actor),
        updated_at: ctx.now,
      });
    }
    repo.writeBlocks(row.id, ctx.userId, work.before, work.blocks);
    repo.replaceCitations(row.id, ctx.userId, citationIndexRows(row.id, work.blocks));

    const summary = work.notes.join("; ").slice(0, 300);
    repo.insertRevision({
      id: newId("revision"),
      documentId: row.id,
      userId: ctx.userId,
      number: revision,
      author: ctx.actor,
      createdAt: ctx.now,
      summary,
      restoredFrom: work.restoredFrom,
      snapshot: snapshotDocument({ ...asDocument(work), revision }),
    });
    repo.pruneRevisions(row.id, revision, cap);

    const touched = [...work.touched].slice(0, MAX_FEED_BLOCK_IDS);
    const requestId = [...ctx.requestIds][0] ?? null;
    const action = work.isNew
      ? "document.created"
      : work.restoredFrom !== null
        ? "document.restored"
        : work.operations.every((o) => o === "review")
          ? "document.reviewed"
          : "document.updated";
    feed.record(ctx.userId, {
      action,
      objectType: "document",
      objectIds: [row.id, ...touched],
      documentId: row.id,
      nodeId: row.node_id,
      revision,
      actor: ctx.actor,
      requestId,
      summary: `${work.title}: ${summary}`,
      at: ctx.now,
    });
    if (ctx.isAgent) {
      const links: ActivityLink[] = [
        { type: "document", id: row.id, nodeId: row.node_id, label: work.title },
        ...touched
          .slice(0, 15)
          .map((id): ActivityLink => ({ type: "block", id, documentId: row.id })),
        ...[...ctx.requestIds].map((id): ActivityLink => ({ type: "request", id })),
      ];
      const unique = [...new Set(work.operations)];
      activity.record(ctx.userId, {
        actor: ctx.actor,
        action: unique.length === 1 ? (unique[0] as string) : "batch",
        summary: `${work.title}: ${summary}`,
        links,
        at: ctx.now,
      });
    }
    return revision;
  }

  /** Run `body` against a fresh context and commit every document it changed, all in one transaction. */
  function transact<T>(auth: AuthContext, body: (ctx: Ctx) => T): T {
    assertWrite(auth);
    return db.transaction((): T => {
      const ctx: Ctx = {
        auth,
        userId: auth.userId,
        actor: auth.actor,
        isAgent: auth.actor.type === "agent",
        now: nowIso(),
        works: new Map(),
        requestIds: new Set(),
      };
      const out = body(ctx);
      const revisions = new Map<string, number>();
      for (const [id, work] of ctx.works) {
        if (work.changed) revisions.set(id, commit(ctx, work));
        else revisions.set(id, work.baseRevision);
      }
      fixRevisions(out, revisions);
      return out;
    })();
  }

  /** Results are built before commit; point their revision numbers at the real ones. */
  function fixRevisions(out: unknown, revisions: ReadonlyMap<string, number>): void {
    const list = Array.isArray(out) ? out : [out];
    for (const item of list) {
      if (typeof item !== "object" || item === null) continue;
      const r = item as {
        documentId?: string;
        revision?: number;
        toDocumentId?: string;
        toRevision?: number;
      };
      if (r.documentId !== undefined && r.revision !== undefined) {
        r.revision = revisions.get(r.documentId) ?? r.revision;
      }
      if (r.toDocumentId !== undefined)
        r.toRevision = revisions.get(r.toDocumentId) ?? r.toRevision;
    }
  }

  const HANDLERS: { [K in WriterOperation]: (ctx: Ctx, input: Parsed<K>) => unknown } = {
    create_document: opCreate,
    insert_blocks: opInsert,
    update_block: opUpdate,
    move_blocks: opMove,
    delete_blocks: opDelete,
    replace_generated: opRegenerate,
    restore_revision: opRestore,
  };

  function parse<K extends WriterOperation>(
    auth: AuthContext,
    operation: K,
    input: unknown,
    prefix = "",
  ): Parsed<K> {
    if (!(operation in WRITER_OPERATIONS)) {
      throw new AppError("invalid_input", `Unknown operation "${String(operation)}".`, {
        hint: `Valid operations: ${Object.keys(WRITER_OPERATIONS).join(", ")}.`,
      });
    }
    const result = validateOperation(operation, input, { writer: auth.actor });
    if (!result.ok) throw problemsToError(result.problems, prefix);
    return result.value as Parsed<K>;
  }

  /**
   * Apply writer operations atomically: all or none. Every document touched
   * gets exactly one new revision, however many operations hit it. `expectedRevision`
   * on each operation is checked against the revision the batch started from.
   */
  function batch(auth: AuthContext, operations: readonly BatchOperation[]): OperationResult[] {
    return runBatch(auth, operations, true);
  }

  function runBatch(
    auth: AuthContext,
    operations: readonly BatchOperation[],
    batchPaths: boolean,
  ): OperationResult[] {
    assertWrite(auth);
    if (operations.length === 0) {
      throw new AppError("invalid_input", "Send at least one operation.", {
        example: {
          operations: [{ operation: "insert_blocks", input: { documentId: "doc_…", blocks: [] } }],
        },
      });
    }
    if (operations.length > 50) {
      throw new AppError("invalid_input", "At most 50 operations in one batch.", {
        hint: "Split the batch.",
      });
    }
    const parsed = operations.map((op, i) => ({
      operation: op.operation,
      value: parse(auth, op.operation, op.input, batchPaths ? `$.operations[${i}].input` : ""),
    }));
    return transact(auth, (ctx) =>
      parsed.map((op): OperationResult => {
        const handler = HANDLERS[op.operation] as (c: Ctx, v: unknown) => object;
        return { operation: op.operation, ...handler(ctx, op.value) } as OperationResult;
      }),
    );
  }

  function single<K extends WriterOperation>(
    auth: AuthContext,
    operation: K,
    input: OperationInput<K>,
  ): Extract<OperationResult, { operation: K }> {
    const [result] = runBatch(auth, [{ operation, input }], false);
    return result as Extract<OperationResult, { operation: K }>;
  }

  /** Create the document of a library node (or of a new document node under `parentId`). */
  const createDocument = (auth: AuthContext, input: OperationInput<"create_document">) =>
    single(auth, "create_document", input);
  const insertBlocks = (auth: AuthContext, input: OperationInput<"insert_blocks">) =>
    single(auth, "insert_blocks", input);
  const updateBlock = (auth: AuthContext, input: OperationInput<"update_block">) =>
    single(auth, "update_block", input);
  const moveBlocks = (auth: AuthContext, input: OperationInput<"move_blocks">) =>
    single(auth, "move_blocks", input);
  const deleteBlocks = (auth: AuthContext, input: OperationInput<"delete_blocks">) =>
    single(auth, "delete_blocks", input);
  const replaceGenerated = (auth: AuthContext, input: OperationInput<"replace_generated">) =>
    single(auth, "replace_generated", input);
  const restoreRevisionOp = (auth: AuthContext, input: OperationInput<"restore_revision">) =>
    single(auth, "restore_revision", input);

  /**
   * Mark blocks (or the whole document) reviewed or unverified (D10). Only a
   * browser session can: an agent can never verify. Send `expectedRevision`
   * so she cannot verify content that changed since she looked.
   */
  function setReview(auth: AuthContext, input: ReviewInput): WriteResult & { changed: number } {
    assertWrite(auth);
    assertSession(auth, "Marking content reviewed or unverified");
    return transact(auth, (ctx) => {
      const work = loadWork(ctx, input.documentId);
      checkRevision(work, input.expectedRevision);
      if (input.blockIds) {
        const missing = input.blockIds.filter((id) => !work.blocks.some((b) => b.id === id));
        if (missing.length > 0) throw notFoundBlock(work.row.id, missing);
      }
      const ids = input.blockIds ? new Set(input.blockIds) : null;
      const changedIds: string[] = [];
      work.blocks = work.blocks.map((b) => {
        if (ids && !ids.has(b.id)) return b;
        if (b.review.status === input.status) return b;
        changedIds.push(b.id);
        return input.status === "reviewed"
          ? markReviewed(b, ctx.now)
          : ({ ...b, review: { status: "unverified", reviewedAt: null } } as Block);
      });
      if (changedIds.length > 0) {
        note(
          work,
          "review",
          `Marked ${plural(changedIds.length, "block")} ${input.status === "reviewed" ? "reviewed" : "unverified"}`,
          changedIds,
        );
      }
      return {
        documentId: work.row.id,
        revision: work.baseRevision + 1,
        changed: changedIds.length,
      };
    });
  }

  // ---- node hooks (the integrator calls these from the library routes) ----

  const hookActor = (userId: string): Actor => ({ type: "user", userId });

  function eachDocOfNodes(userId: string, nodeIds: readonly string[]): DocRow[] {
    return nodeIds.flatMap((nodeId) => {
      const row = repo.docByNode(userId, nodeId);
      return row ? [row] : [];
    });
  }

  function hookEntry(userId: string, row: DocRow, action: string, summary: string, actor: Actor) {
    feed.record(userId, {
      action,
      objectType: "document",
      objectIds: [row.id],
      documentId: row.id,
      nodeId: row.node_id,
      revision: row.revision,
      actor,
      summary: `${row.title}: ${summary}`,
      at: nowIso(),
    });
  }

  /** A library node (and everything under it) went to the trash: hide the documents of these nodes. */
  function onNodeTrashed(
    userId: string,
    nodeIds: readonly string[],
    actor: Actor = hookActor(userId),
  ) {
    db.transaction(() => {
      for (const row of eachDocOfNodes(userId, nodeIds)) {
        if (repo.trash(userId, row.id, nowIso()) > 0) {
          hookEntry(userId, row, "document.trashed", "moved to the trash", actor);
        }
      }
    })();
  }

  /** The node came back: its document returns with all its blocks, revisions and citations. */
  function onNodeRestored(
    userId: string,
    nodeIds: readonly string[],
    actor: Actor = hookActor(userId),
  ) {
    db.transaction(() => {
      for (const row of eachDocOfNodes(userId, nodeIds)) {
        if (repo.untrash(userId, row.id) > 0) {
          hookEntry(userId, row, "document.restored_from_trash", "restored from the trash", actor);
        }
      }
    })();
  }

  /** The node was deleted for good: remove its documents, blocks, revisions, indexes. */
  function onNodeDeleted(
    userId: string,
    nodeIds: readonly string[],
    actor: Actor = hookActor(userId),
  ) {
    db.transaction(() => {
      for (const row of eachDocOfNodes(userId, nodeIds)) {
        hookEntry(userId, row, "document.deleted", "deleted for good", actor);
        repo.deleteDoc(userId, row.id);
      }
    })();
  }

  /** A node was duplicated: deep-copy its document (fresh block IDs) onto the copy. Returns the new document ID. */
  function onNodeDuplicated(
    userId: string,
    fromNodeId: string,
    toNodeId: string,
    actor: Actor = hookActor(userId),
  ): string | null {
    return db.transaction((): string | null => {
      const source = repo.docByNode(userId, fromNodeId);
      if (!source || source.trashed_at !== null) return null;
      if (repo.docByNode(userId, toNodeId)) return null;
      const copyNode = library.get(userId, toNodeId);
      const now = nowIso();
      const blocks = repo.blocks(source.id).map((b) => ({ ...b, id: newId("block") }) as Block);
      const id = newId("document");
      const title = copyNode.name.slice(0, 200);
      repo.insertDoc({
        id,
        user_id: userId,
        node_id: toNodeId,
        kind: source.kind,
        title,
        review_status: documentReviewStatus(blocks),
        revision: 1,
        created_by: JSON.stringify(actor),
        created_at: now,
        last_edited_by: JSON.stringify(actor),
        updated_at: now,
      });
      repo.writeBlocks(id, userId, [], blocks);
      repo.replaceCitations(id, userId, citationIndexRows(id, blocks));
      repo.insertRevision({
        id: newId("revision"),
        documentId: id,
        userId,
        number: 1,
        author: actor,
        createdAt: now,
        summary: `Copied from "${source.title}"`,
        restoredFrom: null,
        snapshot: { title, kind: source.kind, blocks },
      });
      feed.record(userId, {
        action: "document.created",
        objectType: "document",
        objectIds: [id],
        documentId: id,
        nodeId: toNodeId,
        revision: 1,
        actor,
        summary: `${title}: copied from "${source.title}"`,
        at: now,
      });
      return id;
    })();
  }

  return {
    // reads
    getDocument,
    getDocumentByNode,
    getFull,
    getBlock,
    listRevisions,
    getRevision,
    references,
    citedBy,
    searchDocuments,
    // writes
    batch,
    createDocument,
    insertBlocks,
    updateBlock,
    moveBlocks,
    deleteBlocks,
    replaceGenerated,
    restoreRevision: restoreRevisionOp,
    setReview,
    // node hooks
    onNodeTrashed,
    onNodeRestored,
    onNodeDeleted,
    onNodeDuplicated,
  };
}

export type DocumentsService = ReturnType<typeof createDocumentsService>;

function toRef(citation: Citation): SourceRef {
  return {
    fileId: citation.fileId,
    pageId: citation.pageId,
    quote: citation.quote,
    transcriptId: citation.transcriptId,
    transcriptRevision: citation.transcriptRevision,
  };
}
