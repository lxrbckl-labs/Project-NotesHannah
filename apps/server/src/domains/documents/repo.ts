import {
  type Actor,
  type Block,
  blockPlainText,
  type CitationIndexRow,
  type Document,
  type RevisionSnapshot,
} from "@notes/schema";
import type { Db } from "../../db/client.js";

export interface DocRow {
  seq: number;
  id: string;
  user_id: string;
  node_id: string;
  kind: Document["kind"];
  title: string;
  review_status: Document["reviewStatus"];
  revision: number;
  created_by: string;
  created_at: string;
  last_edited_by: string;
  updated_at: string;
  trashed_at: string | null;
}

export interface RevisionRow {
  id: string;
  document_id: string;
  number: number;
  author: string;
  created_at: string;
  summary: string | null;
  restored_from: number | null;
  block_count: number;
  snapshot?: string;
}

export const toDocument = (r: DocRow, blockIds: string[]): Document => ({
  id: r.id,
  nodeId: r.node_id,
  kind: r.kind,
  title: r.title,
  blockIds,
  reviewStatus: r.review_status,
  revision: r.revision,
  createdBy: JSON.parse(r.created_by) as Actor,
  createdAt: r.created_at,
  lastEditedBy: JSON.parse(r.last_edited_by) as Actor,
  updatedAt: r.updated_at,
  trashedAt: r.trashed_at,
});

/** The SQL behind the documents domain. Nothing here decides policy. */
export function createRepo(db: Db) {
  const q = {
    doc: db.prepare("SELECT * FROM documents WHERE id = ? AND user_id = ?"),
    docByNode: db.prepare("SELECT * FROM documents WHERE node_id = ? AND user_id = ?"),
    blocks: db.prepare("SELECT data FROM blocks WHERE document_id = ? ORDER BY position"),
    blockIds: db.prepare("SELECT id FROM blocks WHERE document_id = ? ORDER BY position"),
    insertDoc: db.prepare(
      `INSERT INTO documents (id, user_id, node_id, kind, title, review_status, revision,
         created_by, created_at, last_edited_by, updated_at)
       VALUES (@id, @user_id, @node_id, @kind, @title, @review_status, @revision,
         @created_by, @created_at, @last_edited_by, @updated_at)`,
    ),
    updateDoc: db.prepare(
      `UPDATE documents SET kind = @kind, title = @title, review_status = @review_status,
         revision = @revision, last_edited_by = @last_edited_by, updated_at = @updated_at
       WHERE id = @id`,
    ),
    upsertBlock: db.prepare(
      `INSERT INTO blocks (id, document_id, user_id, position, type, origin, review_status,
         last_edited_by, plain_text, data)
       VALUES (@id, @document_id, @user_id, @position, @type, @origin, @review_status,
         @last_edited_by, @plain_text, @data)
       ON CONFLICT (id) DO UPDATE SET document_id = excluded.document_id,
         position = excluded.position, type = excluded.type, origin = excluded.origin,
         review_status = excluded.review_status, last_edited_by = excluded.last_edited_by,
         plain_text = excluded.plain_text, data = excluded.data
       WHERE blocks.user_id = excluded.user_id`,
    ),
    deleteBlock: db.prepare("DELETE FROM blocks WHERE id = ? AND document_id = ?"),
    deleteCitations: db.prepare("DELETE FROM document_citations WHERE document_id = ?"),
    insertCitation: db.prepare(
      `INSERT INTO document_citations (user_id, document_id, block_id, field, file_id, page_id,
         item_type, quote, region)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    insertRevision: db.prepare(
      `INSERT INTO document_revisions (id, document_id, user_id, number, author, created_at,
         summary, restored_from, block_count, snapshot)
       VALUES (@id, @document_id, @user_id, @number, @author, @created_at, @summary,
         @restored_from, @block_count, @snapshot)`,
    ),
    pruneRevisions: db.prepare(
      "DELETE FROM document_revisions WHERE document_id = ? AND number > 1 AND number <= ?",
    ),
    revision: db.prepare(
      "SELECT * FROM document_revisions WHERE document_id = ? AND number = ? AND user_id = ?",
    ),
    oldestRevision: db.prepare(
      "SELECT MIN(number) AS n FROM document_revisions WHERE document_id = ? AND number > 1",
    ),
    trash: db.prepare(
      "UPDATE documents SET trashed_at = ? WHERE id = ? AND user_id = ? AND trashed_at IS NULL",
    ),
    untrash: db.prepare(
      "UPDATE documents SET trashed_at = NULL WHERE id = ? AND user_id = ? AND trashed_at IS NOT NULL",
    ),
    deleteDoc: db.prepare("DELETE FROM documents WHERE id = ? AND user_id = ?"),
  };

  return {
    doc: (userId: string, id: string) => q.doc.get(id, userId) as DocRow | undefined,
    docByNode: (userId: string, nodeId: string) =>
      q.docByNode.get(nodeId, userId) as DocRow | undefined,
    blocks: (documentId: string): Block[] =>
      (q.blocks.all(documentId) as Array<{ data: string }>).map((r) => JSON.parse(r.data) as Block),
    blockIds: (documentId: string): string[] =>
      (q.blockIds.all(documentId) as Array<{ id: string }>).map((r) => r.id),
    insertDoc: (row: Omit<DocRow, "seq" | "trashed_at">) => q.insertDoc.run(row),
    updateDoc: (
      row: Omit<DocRow, "seq" | "trashed_at" | "user_id" | "node_id" | "created_by" | "created_at">,
    ) => q.updateDoc.run(row),

    /** Write the difference between two block lists: upsert what is new or moved, delete what went. */
    writeBlocks(
      documentId: string,
      userId: string,
      before: readonly Block[],
      after: readonly Block[],
    ) {
      const old = new Map(before.map((b, i) => [b.id, { json: JSON.stringify(b), position: i }]));
      const keep = new Set(after.map((b) => b.id));
      for (const b of before) if (!keep.has(b.id)) q.deleteBlock.run(b.id, documentId);
      after.forEach((b, position) => {
        const json = JSON.stringify(b);
        const was = old.get(b.id);
        if (was && was.json === json && was.position === position) return;
        q.upsertBlock.run({
          id: b.id,
          document_id: documentId,
          user_id: userId,
          position,
          type: b.type,
          origin: b.origin,
          review_status: b.review.status,
          last_edited_by: JSON.stringify(b.provenance.lastEditedBy),
          plain_text: blockPlainText(b),
          data: json,
        });
      });
    },

    replaceCitations(documentId: string, userId: string, rows: readonly CitationIndexRow[]) {
      q.deleteCitations.run(documentId);
      for (const row of rows) {
        if (row.location.kind !== "block") continue;
        q.insertCitation.run(
          userId,
          documentId,
          row.location.blockId,
          row.location.field,
          row.fileId,
          row.pageId,
          row.itemType,
          row.quote,
          row.region ? JSON.stringify(row.region) : null,
        );
      }
    },

    insertRevision(row: {
      id: string;
      documentId: string;
      userId: string;
      number: number;
      author: Actor;
      createdAt: string;
      summary: string | null;
      restoredFrom: number | null;
      snapshot: RevisionSnapshot;
    }) {
      q.insertRevision.run({
        id: row.id,
        document_id: row.documentId,
        user_id: row.userId,
        number: row.number,
        author: JSON.stringify(row.author),
        created_at: row.createdAt,
        summary: row.summary,
        restored_from: row.restoredFrom,
        block_count: row.snapshot.blocks.length,
        snapshot: JSON.stringify(row.snapshot),
      });
    },

    /** Drop snapshots older than the newest `cap`, always keeping revision 1. Returns how many went. */
    pruneRevisions(documentId: string, newest: number, cap: number): number {
      return q.pruneRevisions.run(documentId, newest - cap).changes;
    },
    revision: (userId: string, documentId: string, number: number) =>
      q.revision.get(documentId, number, userId) as
        | (RevisionRow & { snapshot: string })
        | undefined,
    oldestKeptRevision: (documentId: string) =>
      (q.oldestRevision.get(documentId) as { n: number | null }).n,
    trash: (userId: string, id: string, at: string) => q.trash.run(at, id, userId).changes,
    untrash: (userId: string, id: string) => q.untrash.run(id, userId).changes,
    deleteDoc: (userId: string, id: string) => q.deleteDoc.run(id, userId).changes,
  };
}

export type Repo = ReturnType<typeof createRepo>;
