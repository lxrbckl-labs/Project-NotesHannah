import {
  type Actor,
  type Block,
  type BlockInput,
  type Document,
  documentReviewStatus,
  findQuote,
  newId,
  type Page,
  type SourceFile,
  stampNewBlock,
  type Transcript,
  UPLOAD_LIMITS,
  validateOperation,
} from "@notes/schema";
import type { AuthContext } from "../http/auth-context.js";
import { AppError } from "../http/errors.js";
import type {
  ChangeItem,
  ChangesPort,
  DocumentsPort,
  FilesPort,
  PageResult,
  WriteSummary,
} from "./ports.js";

/**
 * In-memory versions of the MCP ports, for unit tests that do not need the
 * real domains (the real ones are exercised in test/mcp-real.test.ts). They
 * follow the domains' rules where a test depends on them, and nothing more.
 */

/** A valid 1x1 PNG. */
export const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function paged<T>(items: T[], cursor: string | undefined, limit: number): PageResult<T> {
  const start = cursor ? Number(cursor) : 0;
  return {
    items: items.slice(start, start + limit),
    nextCursor: start + limit < items.length ? String(start + limit) : null,
  };
}

const missing = (what: string) =>
  new AppError("not_found", `No such ${what}.`, { hint: "Check the ID." });

const sameAgent = (a: Actor | null, b: Actor) =>
  a?.type === "agent" && b.type === "agent" && a.keyId === b.keyId;

function writeOnly(auth: AuthContext) {
  if (auth.scope !== "write") throw new AppError("read_only_key", "This API key is read-only.");
}

export interface FakeFilesOptions {
  now?: () => string;
  /** Stands in for the files domain's destination rule (throw to refuse). */
  checkDestination?: (userId: string, nodeId: string) => void;
}

export function fakeFiles(options: FakeFilesOptions = {}) {
  const now = options.now ?? (() => new Date().toISOString());
  const files = new Map<string, SourceFile>();
  const pages = new Map<string, Page>();
  const transcripts = new Map<string, Transcript>();
  const images = new Map<string, Uint8Array>();

  function addFile(
    userId: string,
    name: string,
    pageCount: number,
    opts: { status?: SourceFile["status"]; nativeText?: string } = {},
  ) {
    const id = newId("file");
    const at = now();
    const status = opts.status ?? "converted";
    const converted = status !== "converting" && status !== "uploaded" && status !== "failed";
    files.set(id, {
      id,
      userId,
      nodeId: null,
      originalName: name,
      sha256: "0".repeat(64),
      bytes: 1000,
      type: "pdf",
      status,
      errorCode: null,
      errorMessage: null,
      pageCount: converted ? pageCount : null,
      uploadedBy: { type: "user", userId },
      claimedBy: null,
      claimedAt: null,
      createdAt: at,
      updatedAt: at,
      trashedAt: null,
      conversionNotes: [],
    });
    const pageIds: string[] = [];
    if (converted) {
      for (let i = 1; i <= pageCount; i++) {
        const pid = newId("page");
        pageIds.push(pid);
        pages.set(pid, {
          id: pid,
          fileId: id,
          index: i,
          width: 1568,
          height: 882,
          hasTextLayer: opts.nativeText !== undefined,
          nativeText: opts.nativeText ?? null,
          speakerNotes: null,
          transcriptId: null,
        });
      }
    }
    return { fileId: id, pageIds };
  }

  /** Finish a conversion started with status "converting". */
  function finishConversion(fileId: string, pageCount: number) {
    const f = files.get(fileId) as SourceFile;
    files.set(fileId, { ...f, status: "converted", pageCount });
    for (let i = 1; i <= pageCount; i++) {
      const pid = newId("page");
      pages.set(pid, {
        id: pid,
        fileId,
        index: i,
        width: 1568,
        height: 882,
        hasTextLayer: false,
        nativeText: null,
        speakerNotes: null,
        transcriptId: null,
      });
    }
  }

  function file(auth: AuthContext, id: string): SourceFile {
    const f = files.get(id);
    if (!f || f.userId !== auth.userId) throw missing("file");
    return f;
  }

  function page(auth: AuthContext, id: string): Page {
    const p = pages.get(id);
    if (!p) throw missing("page");
    file(auth, p.fileId);
    return p;
  }

  const pagesOf = (fileId: string) =>
    [...pages.values()].filter((p) => p.fileId === fileId).sort((a, b) => a.index - b.index);

  function recompute(fileId: string) {
    const f = files.get(fileId) as SourceFile;
    if (f.status === "converting" || f.status === "failed" || f.status === "uploaded") return;
    const all = pagesOf(fileId).every((p) => p.transcriptId !== null);
    const status = f.nodeId !== null ? "filed" : all ? "transcribed" : "converted";
    files.set(fileId, { ...f, status });
  }

  const port: FilesPort = {
    converterStatus: () => ({ state: "online", lastSeenAt: now(), queued: 0, processing: 0 }),
    listFiles(auth, opts) {
      const items = [...files.values()].filter(
        (f) =>
          f.userId === auth.userId &&
          (!opts.inbox || f.status !== "filed") &&
          (!opts.nodeId || f.nodeId === opts.nodeId) &&
          (!opts.status || f.status === opts.status),
      );
      return paged(items, opts.cursor, opts.limit);
    },
    getFile: file,
    listPages(auth, fileId) {
      file(auth, fileId);
      return pagesOf(fileId);
    },
    getPage: page,
    claim(auth, fileId) {
      writeOnly(auth);
      const f = file(auth, fileId);
      if (f.claimedBy && !sameAgent(f.claimedBy, auth.actor)) {
        throw new AppError("conflict", "Another agent has claimed this file.", {
          hint: "Pick another file.",
        });
      }
      const next = { ...f, claimedBy: auth.actor, claimedAt: now() };
      files.set(fileId, next);
      return next;
    },
    release(auth, fileId) {
      writeOnly(auth);
      const f = file(auth, fileId);
      if (f.claimedBy && !sameAgent(f.claimedBy, auth.actor)) {
        throw new AppError("conflict", "Another agent holds this claim.");
      }
      const next = { ...f, claimedBy: null, claimedAt: null };
      files.set(fileId, next);
      return next;
    },
    retry(auth, fileId) {
      writeOnly(auth);
      const f = file(auth, fileId);
      const next = { ...f, status: "converting" as const };
      files.set(fileId, next);
      return next;
    },
    fileUnder(auth, fileId, nodeId) {
      writeOnly(auth);
      const f = file(auth, fileId);
      if (nodeId !== null) options.checkDestination?.(auth.userId, nodeId);
      files.set(fileId, { ...f, nodeId });
      recompute(fileId);
      return files.get(fileId) as SourceFile;
    },
    pageImage(auth, pageId) {
      page(auth, pageId);
      return { data: images.get(pageId) ?? TINY_PNG, mimeType: "image/png" };
    },
    pageImageLink(auth, pageId, size) {
      page(auth, pageId);
      return {
        url: `http://127.0.0.1/api/pages/${pageId}/image?size=${size}&sig=test`,
        expiresAt: now(),
      };
    },
    getTranscript(auth, pageId) {
      const p = page(auth, pageId);
      return p.transcriptId ? (transcripts.get(p.transcriptId) ?? null) : null;
    },
    saveTranscript(auth, input) {
      writeOnly(auth);
      const p = page(auth, input.pageId);
      const f = file(auth, p.fileId);
      if (f.claimedBy && !sameAgent(f.claimedBy, auth.actor)) {
        throw new AppError("conflict", "Another agent has claimed this file.");
      }
      const previous = p.transcriptId ? transcripts.get(p.transcriptId) : undefined;
      const t: Transcript = {
        id: newId("transcript"),
        pageId: p.id,
        text: input.text,
        flags: input.flags,
        author: auth.actor,
        reviewStatus: "unverified",
        reviewedAt: null,
        revision: (previous?.revision ?? 0) + 1,
        createdAt: now(),
      };
      transcripts.set(t.id, t);
      pages.set(p.id, { ...p, transcriptId: t.id });
      recompute(p.fileId);
      return t;
    },
    requestUploads(auth, input) {
      writeOnly(auth);
      return input.files.map((f) => ({
        id: newId("upload"),
        name: f.name,
        url: `http://127.0.0.1/api/uploads/${newId("upload")}`,
        method: "PUT" as const,
        maxBytes: Math.min(f.bytes, UPLOAD_LIMITS.maxBytes),
        expiresAt: now(),
      }));
    },
  };

  /** Give a page a real image (the default is a 1x1 PNG). */
  function setImage(pageId: string, data: Uint8Array) {
    images.set(pageId, data);
  }

  return { port, addFile, finishConversion, setImage, files, pages, transcripts };
}

/**
 * Documents over a Map: create, insert and delete, with the citation rule and
 * the quote check against a lookup of page text. Enough for the tool tests.
 */
export function fakeDocuments(
  options: { now?: () => string; pageText?: (pageId: string) => string | null } = {},
) {
  const now = options.now ?? (() => new Date().toISOString());
  const docs = new Map<string, { userId: string; doc: Document; blocks: Block[] }>();

  function need(auth: AuthContext, id: string) {
    const d = docs.get(id);
    if (!d || d.userId !== auth.userId) throw new AppError("not_found", "No such document.");
    return d;
  }

  function checkQuotes(blocks: readonly BlockInput[]) {
    if (!options.pageText) return;
    blocks.forEach((b, i) => {
      b.citations.forEach((c, j) => {
        const text = options.pageText?.(c.pageId) ?? null;
        if (text !== null && findQuote(text, c.quote) < 0) {
          throw new AppError(
            "invalid_input",
            `$.blocks[${i}].citations[${j}]: The quote does not occur, character for character, in the page's current transcript.`,
          );
        }
      });
    });
  }

  function save(entry: { doc: Document; blocks: Block[] }, blocks: Block[], actor: Actor) {
    entry.blocks = blocks;
    entry.doc = {
      ...entry.doc,
      blockIds: blocks.map((b) => b.id),
      reviewStatus: documentReviewStatus(blocks),
      revision: entry.doc.revision + 1,
      lastEditedBy: actor,
      updatedAt: now(),
    };
  }

  const port: DocumentsPort = {
    getDocument(auth, id, range) {
      const d = need(auth, id);
      return {
        document: d.doc,
        blocks: d.blocks.slice(range.offset, range.offset + range.limit),
        total: d.blocks.length,
      };
    },
    documentForNode(auth, nodeId) {
      return (
        [...docs.values()].find((d) => d.userId === auth.userId && d.doc.nodeId === nodeId)?.doc ??
        null
      );
    },
    getBlock(auth, documentId, blockId) {
      const block = need(auth, documentId).blocks.find((b) => b.id === blockId);
      if (!block) throw new AppError("not_found", "No such block.");
      return block;
    },
    write(auth, operation, raw): WriteSummary {
      writeOnly(auth);
      const parsed = validateOperation(operation, raw, { writer: auth.actor });
      if (!parsed.ok) throw new AppError("invalid_input", parsed.problems[0]?.message ?? "invalid");
      const at = now();
      const input = parsed.value as Record<string, unknown> & {
        documentId: string;
        blocks?: BlockInput[];
        expectedRevision?: number;
      };
      if (operation === "create_document") {
        const c = input as unknown as {
          nodeId?: string;
          kind: Document["kind"];
          title: string;
          blocks: BlockInput[];
        };
        checkQuotes(c.blocks);
        const blocks = c.blocks.map((b) => stampNewBlock(b, { actor: auth.actor, now: at }));
        const doc: Document = {
          id: newId("document"),
          nodeId: c.nodeId ?? newId("node"),
          kind: c.kind,
          title: c.title,
          blockIds: blocks.map((b) => b.id),
          reviewStatus: documentReviewStatus(blocks),
          revision: 1,
          createdBy: auth.actor,
          createdAt: at,
          lastEditedBy: auth.actor,
          updatedAt: at,
          trashedAt: null,
        };
        docs.set(doc.id, { userId: auth.userId, doc, blocks });
        return {
          documentId: doc.id,
          nodeId: doc.nodeId,
          revision: 1,
          written: doc.blockIds,
          removed: [],
          skipped: [],
        };
      }
      const entry = need(auth, input.documentId);
      if (input.expectedRevision !== undefined && input.expectedRevision !== entry.doc.revision) {
        throw new AppError(
          "conflict",
          `The document is at revision ${entry.doc.revision}, not ${input.expectedRevision}.`,
        );
      }
      if (operation === "insert_blocks") {
        checkQuotes(input.blocks ?? []);
        const fresh = (input.blocks ?? []).map((b) =>
          stampNewBlock(b, { actor: auth.actor, now: at }),
        );
        save(entry, [...fresh, ...entry.blocks], auth.actor);
        return {
          documentId: entry.doc.id,
          revision: entry.doc.revision,
          written: fresh.map((b) => b.id),
          removed: [],
          skipped: [],
        };
      }
      if (operation === "delete_blocks") {
        const ids = (input as unknown as { blockIds: string[] }).blockIds;
        save(
          entry,
          entry.blocks.filter((b) => !ids.includes(b.id)),
          auth.actor,
        );
        return {
          documentId: entry.doc.id,
          revision: entry.doc.revision,
          written: [],
          removed: ids,
          skipped: [],
        };
      }
      throw new AppError("invalid_input", `The fake does not support ${operation}.`);
    },
    references(auth, documentId) {
      const d = need(auth, documentId);
      return d.blocks
        .flatMap((b) => b.citations)
        .map((c, i) => ({
          number: i + 1,
          fileId: c.fileId,
          pageId: c.pageId,
          quote: c.quote,
          status: "available",
          fileName: null,
          pageIndex: null,
          quoteStillPresent: null,
        }));
    },
    citedByCount: () => 0,
  };
  return { port, docs };
}

export function fakeChanges(changes: ChangeItem[] = []) {
  const port: ChangesPort = {
    changesSince(_userId, cursor, limit) {
      const start = cursor ? Number(cursor) : 0;
      const items = changes.slice(start, start + limit);
      return {
        items,
        nextCursor: String(start + items.length),
        hasMore: start + items.length < changes.length,
      };
    },
    latestCursor: () => String(changes.length),
  };
  return { port, changes };
}
