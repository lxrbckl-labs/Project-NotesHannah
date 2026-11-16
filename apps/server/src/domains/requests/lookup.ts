import type { RequestTarget } from "@notes/schema";
import type { Db } from "../../db/client.js";

/** What an agent (and the screen) is told about the thing a request points at. */
export interface TargetInfo {
  /** False when it does not exist for this user (never made, someone else's, or deleted for good). */
  exists: boolean;
  /** In the trash, itself or through a parent. */
  trashed: boolean;
  name: string | null;
  /** Readable library path, e.g. "Fall 2026 / Pharmacology II / Lectures". */
  path: string | null;
  /** The first words of the block, document, page or question. */
  preview: string | null;
  /** The library node the target lives under (or is). */
  nodeId: string | null;
  /** Something worth saying, e.g. that a block was replaced by a regeneration. */
  note: string | null;
}

export const NO_TARGET: TargetInfo = {
  exists: false,
  trashed: false,
  name: null,
  path: null,
  preview: null,
  nodeId: null,
  note: null,
};

/**
 * The narrow view of the library, documents and files that requests need.
 * `describe` must only report on things owned by `userId`: another user's
 * object does not exist.
 */
export interface TargetLookup {
  describe(userId: string, target: RequestTarget): TargetInfo;
}

const PREVIEW_CHARS = 140;

export function previewOf(text: string | null | undefined): string | null {
  if (!text) return null;
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length === 0) return null;
  return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS - 1)}…` : flat;
}

// ---- in-memory fake -------------------------------------------------------------------

export interface FakeTargetLookup extends TargetLookup {
  addNode(userId: string, id: string, info: Partial<TargetInfo> & { name: string }): void;
  addDocument(
    userId: string,
    id: string,
    info: Partial<TargetInfo> & { name: string; blocks?: Record<string, string> },
  ): void;
  addSource(
    userId: string,
    fileId: string,
    info: Partial<TargetInfo> & { name: string; pages?: string[] },
  ): void;
  addQuestion(userId: string, id: string, info: Partial<TargetInfo> & { name: string }): void;
  /** Remove a block, as a regeneration does. */
  removeBlock(documentId: string, blockId: string): void;
  setTrashed(id: string, trashed: boolean): void;
  remove(id: string): void;
}

interface FakeEntry {
  userId: string;
  info: TargetInfo;
  blocks?: Record<string, string>;
  pages?: string[];
}

/** An in-memory lookup for tests. The library root always exists. */
export function createFakeTargetLookup(): FakeTargetLookup {
  const entries = new Map<string, FakeEntry>();
  const base = (info: Partial<TargetInfo>): TargetInfo => ({ ...NO_TARGET, exists: true, ...info });
  return {
    addNode(userId, id, info) {
      entries.set(id, { userId, info: base({ path: info.name, nodeId: id, ...info }) });
    },
    addDocument(userId, id, info) {
      const { blocks, ...rest } = info;
      entries.set(id, { userId, info: base(rest), ...(blocks ? { blocks } : {}) });
    },
    addSource(userId, fileId, info) {
      const { pages, ...rest } = info;
      entries.set(fileId, { userId, info: base(rest), ...(pages ? { pages } : {}) });
    },
    addQuestion(userId, id, info) {
      entries.set(id, { userId, info: base(info) });
    },
    removeBlock(documentId, blockId) {
      const entry = entries.get(documentId);
      if (entry?.blocks) delete entry.blocks[blockId];
    },
    setTrashed(id, trashed) {
      const entry = entries.get(id);
      if (entry) entry.info = { ...entry.info, trashed };
    },
    remove(id) {
      entries.delete(id);
    },
    describe(userId, target) {
      const own = (id: string) => {
        const entry = entries.get(id);
        return entry && entry.userId === userId ? entry : undefined;
      };
      switch (target.type) {
        case "library":
          return base({ name: "Library", path: "", nodeId: null });
        case "node":
          return own(target.nodeId)?.info ?? NO_TARGET;
        case "document":
          return own(target.documentId)?.info ?? NO_TARGET;
        case "block": {
          const entry = own(target.documentId);
          if (!entry) return NO_TARGET;
          const text = entry.blocks?.[target.blockId];
          if (entry.blocks && text === undefined) {
            return {
              ...entry.info,
              note: "The block was replaced when the document was regenerated. This request is about that part of the document; the document is shown instead.",
            };
          }
          return { ...entry.info, preview: previewOf(text) ?? entry.info.preview };
        }
        case "source": {
          const entry = own(target.fileId);
          if (!entry) return NO_TARGET;
          if (target.pageId) return { ...entry.info, preview: previewOf(entry.pages?.[0]) };
          return entry.info;
        }
        case "question":
          return own(target.questionId)?.info ?? NO_TARGET;
      }
    },
  };
}

// ---- over the database ----------------------------------------------------------------------

export interface DbTargetLookupOptions {
  /** Practice questions live in another lane; plug a lookup in when it merges. Default: allowed, unnamed. */
  question?: (userId: string, questionId: string) => Partial<TargetInfo> | null;
}

interface NodeLink {
  id: string;
  parent_id: string | null;
  name: string;
  trashed_at: string | null;
}

/**
 * Reads the library, documents and files tables directly (read only), so it
 * keeps working whatever the services above them look like. It touches no
 * other domain's code, only their documented tables.
 */
export function createDbTargetLookup(db: Db, options: DbTargetLookupOptions = {}): TargetLookup {
  const chain = db.prepare(
    `WITH RECURSIVE up(id, parent_id, name, trashed_at, depth) AS (
       SELECT id, parent_id, name, trashed_at, 0 FROM nodes WHERE id = ? AND user_id = ?
       UNION ALL
       SELECT n.id, n.parent_id, n.name, n.trashed_at, up.depth + 1 FROM nodes n JOIN up ON n.id = up.parent_id
     ) SELECT id, parent_id, name, trashed_at FROM up ORDER BY depth DESC`,
  );
  const doc = db.prepare(
    "SELECT id, node_id, title, trashed_at FROM documents WHERE id = ? AND user_id = ?",
  );
  const block = db.prepare("SELECT plain_text FROM blocks WHERE id = ? AND document_id = ?");
  const firstBlock = db.prepare(
    "SELECT plain_text FROM blocks WHERE document_id = ? AND plain_text != '' ORDER BY position LIMIT 1",
  );
  const file = db.prepare(
    "SELECT id, node_id, original_name, trashed_at FROM source_files WHERE id = ? AND user_id = ?",
  );
  const page = db.prepare(
    `SELECT p.idx, p.native_text, t.text AS transcript
     FROM pages p LEFT JOIN transcripts t ON t.id = p.transcript_id
     WHERE p.id = ? AND p.file_id = ? AND p.user_id = ?`,
  );

  function nodeInfo(userId: string, nodeId: string): TargetInfo {
    const rows = chain.all(nodeId, userId) as NodeLink[];
    const self = rows[rows.length - 1];
    if (!self) return NO_TARGET;
    return {
      exists: true,
      trashed: rows.some((r) => r.trashed_at !== null),
      name: self.name,
      path: rows.map((r) => r.name).join(" / "),
      preview: null,
      nodeId,
      note: null,
    };
  }

  function documentInfo(
    userId: string,
    documentId: string,
  ): (TargetInfo & { docId: string }) | null {
    const d = doc.get(documentId, userId) as
      | { id: string; node_id: string; title: string; trashed_at: string | null }
      | undefined;
    if (!d) return null;
    const where = nodeInfo(userId, d.node_id);
    // A document whose node is gone is on its way out: it no longer exists for requests.
    if (!where.exists) return null;
    const first = firstBlock.get(d.id) as { plain_text: string } | undefined;
    return {
      docId: d.id,
      exists: true,
      trashed: d.trashed_at !== null || where.trashed,
      name: d.title,
      path: where.path,
      preview: previewOf(first?.plain_text),
      nodeId: d.node_id,
      note: null,
    };
  }

  return {
    describe(userId, target): TargetInfo {
      switch (target.type) {
        case "library":
          return { ...NO_TARGET, exists: true, name: "Library", path: "" };
        case "node":
          return nodeInfo(userId, target.nodeId);
        case "document": {
          const { docId: _docId, ...info } = documentInfo(userId, target.documentId) ?? {
            ...NO_TARGET,
            docId: "",
          };
          return info;
        }
        case "block": {
          const found = documentInfo(userId, target.documentId);
          if (!found) return NO_TARGET;
          const { docId: _docId, ...info } = found;
          const b = block.get(target.blockId, target.documentId) as
            | { plain_text: string }
            | undefined;
          if (!b) {
            return {
              ...info,
              note: "The block was replaced when the document was regenerated. This request is about that part of the document; the document is shown instead.",
            };
          }
          return { ...info, preview: previewOf(b.plain_text) ?? info.preview };
        }
        case "source": {
          const f = file.get(target.fileId, userId) as
            | {
                id: string;
                node_id: string | null;
                original_name: string;
                trashed_at: number | null;
              }
            | undefined;
          if (!f) return NO_TARGET;
          const where = f.node_id ? nodeInfo(userId, f.node_id) : null;
          let preview: string | null = null;
          let name = f.original_name;
          if (target.pageId) {
            const p = page.get(target.pageId, f.id, userId) as
              | { idx: number; native_text: string | null; transcript: string | null }
              | undefined;
            if (!p) return NO_TARGET;
            name = `${f.original_name}, page ${p.idx}`;
            preview = previewOf(p.transcript) ?? previewOf(p.native_text);
          }
          return {
            exists: true,
            trashed: f.trashed_at !== null || Boolean(where?.trashed),
            name,
            path: where?.path ?? null,
            preview,
            nodeId: f.node_id,
            note: null,
          };
        }
        case "question": {
          const q = options.question?.(userId, target.questionId);
          if (options.question && q === null) return NO_TARGET;
          return { ...NO_TARGET, exists: true, ...(q ?? {}) };
        }
      }
    },
  };
}
