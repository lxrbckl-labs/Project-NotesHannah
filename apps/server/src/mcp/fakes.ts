import {
  type Actor,
  applyBlockPatch,
  type Block,
  canAgentOverwrite,
  type Document,
  documentReviewStatus,
  insertIds,
  moveIds,
  newId,
  type Page,
  planRegeneration,
  type SourceFile,
  stampEditedBlock,
  stampNewBlock,
  type Transcript,
  UPLOAD_LIMITS,
} from "@notes/schema";
import { AppError } from "../http/errors.js";
import type {
  Change,
  ChangesPort,
  DocumentsPort,
  FilesPort,
  PageResult,
  WriteResult,
} from "./ports.js";

/**
 * In-memory implementations of the MCP ports, for tests and as a reference
 * for the integrator's adapters. Not used in production.
 */

/** A valid 1x1 PNG. */
export const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function paged<T>(items: T[], cursor: string | undefined, limit: number): PageResult<T> {
  const start = cursor ? Number(cursor) : 0;
  const slice = items.slice(start, start + limit);
  const next = start + limit < items.length ? String(start + limit) : null;
  return { items: slice, nextCursor: next };
}

const missing = (what: string) =>
  new AppError("not_found", `No such ${what} in your library.`, {
    hint: 'Check the ID; list files with inbox {"action":"list"}.',
  });

const sameAgent = (a: Actor | null, b: Actor) =>
  a?.type === "agent" && b.type === "agent" && a.keyId === b.keyId;

export interface FakeFilesOptions {
  now?: () => string;
  /**
   * Stands in for the files domain's destination rule: throw an AppError
   * when a file may not be filed under this node. Default: allow any node.
   */
  checkDestination?: (userId: string, nodeId: string) => void;
}

export function fakeFiles(options: FakeFilesOptions = {}) {
  const now = options.now ?? (() => new Date().toISOString());
  const files = new Map<string, SourceFile>();
  const pages = new Map<string, Page>();
  const transcripts = new Map<string, Transcript>();
  const images = new Map<string, { data: Uint8Array; width: number; height: number }>();

  function addFile(
    userId: string,
    name: string,
    pageCount: number,
    options: { status?: SourceFile["status"]; nativeText?: string } = {},
  ) {
    const id = newId("file");
    const at = now();
    files.set(id, {
      id,
      userId,
      nodeId: null,
      originalName: name,
      sha256: "0".repeat(64),
      bytes: 1000,
      type: "pdf",
      status: options.status ?? "converted",
      errorCode: null,
      errorMessage: null,
      pageCount,
      uploadedBy: { type: "user", userId },
      claimedBy: null,
      claimedAt: null,
      createdAt: at,
      updatedAt: at,
      trashedAt: null,
    });
    const pageIds: string[] = [];
    for (let i = 1; i <= pageCount; i++) {
      const pid = newId("page");
      pageIds.push(pid);
      pages.set(pid, {
        id: pid,
        fileId: id,
        index: i,
        width: 1568,
        height: 882,
        hasTextLayer: options.nativeText !== undefined,
        nativeText: options.nativeText ?? null,
        speakerNotes: null,
        transcriptId: null,
      });
    }
    return { fileId: id, pageIds };
  }

  function file(userId: string, id: string): SourceFile {
    const f = files.get(id);
    if (!f || f.userId !== userId) throw missing("file");
    return f;
  }

  function page(userId: string, id: string): Page {
    const p = pages.get(id);
    if (!p) throw missing("page");
    file(userId, p.fileId);
    return p;
  }

  const pagesOf = (fileId: string) =>
    [...pages.values()].filter((p) => p.fileId === fileId).sort((a, b) => a.index - b.index);

  const port: FilesPort = {
    inboxSummary(userId) {
      const mine = [...files.values()].filter((f) => f.userId === userId && f.status !== "filed");
      const byStatus: Record<string, number> = {};
      for (const f of mine) byStatus[f.status] = (byStatus[f.status] ?? 0) + 1;
      return { pending: mine.length, byStatus, converter: "ok" };
    },
    listInbox(userId, options) {
      const items = [...files.values()].filter(
        (f) =>
          f.userId === userId &&
          f.status !== "filed" &&
          (!options.status || f.status === options.status),
      );
      return paged(items, options.cursor, options.limit);
    },
    listFilesUnder(userId, nodeId, options) {
      const items = [...files.values()].filter((f) => f.userId === userId && f.nodeId === nodeId);
      return paged(items, options.cursor, options.limit);
    },
    getFile: file,
    listPages(userId, fileId, options) {
      file(userId, fileId);
      return paged(pagesOf(fileId), options.cursor, options.limit);
    },
    claim(actor, userId, fileId) {
      const f = file(userId, fileId);
      if (f.claimedBy && !sameAgent(f.claimedBy, actor)) {
        throw new AppError("conflict", "Another agent has claimed this file.", {
          hint: 'Pick another file from inbox {"action":"list"}.',
        });
      }
      const next = { ...f, claimedBy: actor, claimedAt: now() };
      files.set(fileId, next);
      return next;
    },
    release(actor, userId, fileId) {
      const f = file(userId, fileId);
      if (!sameAgent(f.claimedBy, actor)) {
        throw new AppError("conflict", "You do not hold a claim on this file.", {
          hint: "Only the agent that claimed a file can release it.",
        });
      }
      const next = { ...f, claimedBy: null, claimedAt: null };
      files.set(fileId, next);
      return next;
    },
    fileUnder(_actor, userId, fileId, nodeId) {
      const f = file(userId, fileId);
      if (nodeId !== null) options.checkDestination?.(userId, nodeId);
      const transcribed = pagesOf(fileId).every((p) => p.transcriptId !== null);
      const status = nodeId !== null ? "filed" : transcribed ? "transcribed" : "converted";
      const next = {
        ...f,
        nodeId,
        status: status as SourceFile["status"],
        claimedBy: null,
        claimedAt: null,
      };
      files.set(fileId, next);
      return next;
    },
    getPage(userId, pageId) {
      const p = page(userId, pageId);
      const f = file(userId, p.fileId);
      const all = pagesOf(f.id);
      const at = all.findIndex((x) => x.id === p.id);
      const t = p.transcriptId ? transcripts.get(p.transcriptId) : undefined;
      return {
        page: p,
        file: {
          id: f.id,
          originalName: f.originalName,
          pageCount: f.pageCount,
          status: f.status,
          nodeId: f.nodeId,
        },
        previousPageId: all[at - 1]?.id ?? null,
        nextPageId: all[at + 1]?.id ?? null,
        transcript: t ? { id: t.id, revision: t.revision, reviewStatus: t.reviewStatus } : null,
      };
    },
    pageImage(userId, pageId) {
      page(userId, pageId);
      const image = images.get(pageId);
      return image
        ? { ...image, mimeType: "image/png" }
        : { data: TINY_PNG, mimeType: "image/png", width: 1, height: 1 };
    },
    pageImageLink(userId, pageId, size) {
      page(userId, pageId);
      return {
        url: `http://127.0.0.1/files/pages/${pageId}?size=${size}&sig=test`,
        expiresAt: now(),
      };
    },
    getTranscript(userId, transcriptId) {
      const t = transcripts.get(transcriptId);
      if (!t) throw missing("transcript");
      page(userId, t.pageId);
      return t;
    },
    saveTranscript(actor, userId, input) {
      const p = page(userId, input.pageId);
      const previous = p.transcriptId ? transcripts.get(p.transcriptId) : undefined;
      const t: Transcript = {
        id: newId("transcript"),
        pageId: p.id,
        text: input.text,
        flags: input.flags,
        author: actor,
        reviewStatus: "unverified",
        reviewedAt: null,
        revision: (previous?.revision ?? 0) + 1,
        createdAt: now(),
      };
      transcripts.set(t.id, t);
      pages.set(p.id, { ...p, transcriptId: t.id });
      return t;
    },
    requestUploads(_actor, _userId, input) {
      return input.files.map((f) => {
        const id = newId("upload");
        return {
          id,
          name: f.name,
          url: `http://127.0.0.1/api/uploads/${id}`,
          method: "PUT" as const,
          maxBytes: UPLOAD_LIMITS.maxBytes,
          expiresAt: now(),
        };
      });
    },
    searchTranscripts(userId, query, options) {
      const hits = [...transcripts.values()]
        .filter((t) => t.text.toLowerCase().includes(query.toLowerCase()))
        .flatMap((t) => {
          const p = pages.get(t.pageId) as Page;
          const f = files.get(p.fileId) as SourceFile;
          if (f.userId !== userId) return [];
          return [
            {
              transcriptId: t.id,
              pageId: p.id,
              fileId: f.id,
              pageIndex: p.index,
              fileName: f.originalName,
              snippet: t.text.slice(0, 80),
            },
          ];
        });
      return paged(hits, options.cursor, options.limit);
    },
  };
  /** Give a page a real PNG (the default is a 1x1 pixel). */
  function setImage(pageId: string, data: Uint8Array, width: number, height: number) {
    images.set(pageId, { data, width, height });
  }

  return { port, addFile, setImage, files, pages, transcripts };
}

export function fakeDocuments(now: () => string = () => new Date().toISOString()) {
  const docs = new Map<string, { userId: string; doc: Document; blocks: Block[] }>();

  function need(userId: string, id: string) {
    const d = docs.get(id);
    if (!d || d.userId !== userId) throw new AppError("not_found", "No such document.");
    return d;
  }

  function save(
    entry: { userId: string; doc: Document; blocks: Block[] },
    blocks: Block[],
    actor: Actor,
  ) {
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

  function checkRevision(entry: { doc: Document }, expected: number | undefined) {
    if (expected !== undefined && expected !== entry.doc.revision) {
      throw new AppError(
        "conflict",
        `The document is at revision ${entry.doc.revision}, not ${expected}.`,
        { hint: "Read it again with get_item and redo the change." },
      );
    }
  }

  const result = (
    entry: { doc: Document },
    written: string[],
    removed: string[] = [],
    skipped: WriteResult["skipped"] = [],
  ): WriteResult => ({
    documentId: entry.doc.id,
    nodeId: entry.doc.nodeId,
    revision: entry.doc.revision,
    written,
    removed,
    skipped,
  });

  const port: DocumentsPort = {
    getDocument(userId, documentId, range) {
      const d = need(userId, documentId);
      return { document: d.doc, blocks: d.blocks.slice(range.offset, range.offset + range.limit) };
    },
    documentForNode(userId, nodeId) {
      return (
        [...docs.values()].find((d) => d.userId === userId && d.doc.nodeId === nodeId)?.doc ?? null
      );
    },
    getBlock(userId, blockId) {
      for (const d of docs.values()) {
        if (d.userId !== userId) continue;
        const block = d.blocks.find((b) => b.id === blockId);
        if (block) return { documentId: d.doc.id, block };
      }
      throw new AppError("not_found", "No such block.");
    },
    createDocument(actor, userId, input) {
      const at = now();
      const blocks = input.blocks.map((b) => stampNewBlock(b, { actor, now: at }));
      const doc: Document = {
        id: newId("document"),
        nodeId: input.nodeId ?? newId("node"),
        kind: input.kind,
        title: input.title,
        blockIds: blocks.map((b) => b.id),
        reviewStatus: documentReviewStatus(blocks),
        revision: 1,
        createdBy: actor,
        createdAt: at,
        lastEditedBy: actor,
        updatedAt: at,
        trashedAt: null,
      };
      docs.set(doc.id, { userId, doc, blocks });
      return result({ doc }, doc.blockIds);
    },
    applyOperation(actor, userId, operation, input) {
      const body = input as unknown as { documentId: string; expectedRevision?: number };
      const entry = need(userId, body.documentId);
      checkRevision(entry, body.expectedRevision);
      const at = now();
      switch (operation) {
        case "insert_blocks": {
          const i = input as unknown as {
            blocks: Parameters<typeof stampNewBlock>[0][];
            position: Parameters<typeof insertIds>[2];
          };
          const fresh = i.blocks.map((b) => stampNewBlock(b, { actor, now: at }));
          const order = insertIds(
            entry.blocks.map((b) => b.id),
            fresh.map((b) => b.id),
            i.position,
          );
          if (!order)
            throw new AppError("invalid_input", "position names a block not in this document.");
          const all = new Map([...entry.blocks, ...fresh].map((b) => [b.id, b]));
          save(
            entry,
            order.map((id) => all.get(id) as Block),
            actor,
          );
          return result(
            entry,
            fresh.map((b) => b.id),
          );
        }
        case "update_block": {
          const u = input as unknown as {
            mode: "replace" | "patch";
            blockId: string;
            block?: Parameters<typeof stampNewBlock>[0];
            patch?: Parameters<typeof applyBlockPatch>[1];
            requestId?: string;
          };
          const at0 = entry.blocks.findIndex((b) => b.id === u.blockId);
          const existing = entry.blocks[at0];
          if (!existing) throw new AppError("not_found", "No such block in this document.");
          const decision = canAgentOverwrite(existing, { requestId: u.requestId });
          if (!decision.allowed) {
            throw new AppError(
              "conflict",
              `She ${decision.reason === "reviewed" ? "reviewed" : "edited"} this block, so it is protected.`,
              {
                hint: "Leave it, or act on her request and pass its requestId.",
              },
            );
          }
          let next: Parameters<typeof stampNewBlock>[0];
          if (u.mode === "replace") next = u.block as Parameters<typeof stampNewBlock>[0];
          else {
            const patched = applyBlockPatch(existing, u.patch as never);
            if (!patched.ok) {
              throw new AppError(
                "invalid_input",
                patched.problems.map((p) => `${p.path}: ${p.message}`).join("; "),
              );
            }
            next = patched.block;
          }
          const blocks = [...entry.blocks];
          blocks[at0] = stampEditedBlock(existing, next, { actor, now: at });
          save(entry, blocks, actor);
          return result(entry, [u.blockId]);
        }
        case "move_blocks": {
          const m = input as unknown as {
            blockIds: string[];
            position: Parameters<typeof moveIds>[2];
          };
          const order = moveIds(
            entry.blocks.map((b) => b.id),
            m.blockIds,
            m.position,
          );
          if (!order)
            throw new AppError("invalid_input", "A block or the position is not in this document.");
          const all = new Map(entry.blocks.map((b) => [b.id, b]));
          save(
            entry,
            order.map((id) => all.get(id) as Block),
            actor,
          );
          return result(entry, m.blockIds);
        }
        case "delete_blocks": {
          const d = input as unknown as { blockIds: string[]; requestId?: string };
          for (const id of d.blockIds) {
            const b = entry.blocks.find((x) => x.id === id);
            if (!b) throw new AppError("not_found", `No block ${id} in this document.`);
            if (!canAgentOverwrite(b, { requestId: d.requestId }).allowed) {
              throw new AppError("conflict", `Block ${id} is protected.`);
            }
          }
          save(
            entry,
            entry.blocks.filter((b) => !d.blockIds.includes(b.id)),
            actor,
          );
          return result(entry, [], d.blockIds);
        }
        case "replace_generated": {
          const r = input as unknown as {
            blocks: Parameters<typeof stampNewBlock>[0][];
            scope?: string[];
            requestId?: string;
          };
          const plan = planRegeneration(entry.blocks, r.blocks, {
            actor,
            now: at,
            ...(r.scope ? { scope: r.scope } : {}),
            requestId: r.requestId,
          });
          save(entry, plan.blocks, actor);
          return result(entry, plan.written, plan.removed, plan.skipped);
        }
        default:
          throw new AppError("invalid_input", "restore_revision is not supported by the fake.");
      }
    },
  };
  return { port, docs };
}

export function fakeChanges(changes: Change[] = []) {
  const port: ChangesPort = {
    changesSince(_userId, options) {
      const start = options.cursor ? Number(options.cursor) : 0;
      const items = changes.slice(start, start + options.limit);
      return {
        items,
        cursor: String(start + items.length),
        more: start + items.length < changes.length,
      };
    },
  };
  return { port, changes };
}
