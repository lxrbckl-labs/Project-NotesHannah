import type { Canvas, Point } from "@notes/schema";
import type { Db } from "../../db/client.js";

export type LayoutVariant = "wide" | "tall";

/** A document of hers that is not in the trash: the only kind whose canvas can be reached. */
export interface VisibleDoc {
  id: string;
  nodeId: string;
  title: string;
  revision: number;
}

interface CanvasRow {
  document_id: string;
  user_id: string;
  revision: number;
  data: string;
  created_at: string;
  updated_at: string;
}

type Stored = Pick<Canvas, "cards" | "connectors" | "frames" | "syncedBlockIds" | "allowSelfLinks">;

/** The SQL behind the canvas domain. Nothing here decides policy. */
export function createCanvasRepo(db: Db) {
  const q = {
    doc: db.prepare(
      `SELECT id, node_id, title, revision FROM documents
       WHERE id = ? AND user_id = ? AND trashed_at IS NULL`,
    ),
    docOfNode: db.prepare("SELECT id, trashed_at FROM documents WHERE node_id = ? AND user_id = ?"),
    blockIds: db.prepare("SELECT id FROM blocks WHERE document_id = ? ORDER BY position"),
    get: db.prepare("SELECT * FROM canvases WHERE document_id = ? AND user_id = ?"),
    insert: db.prepare(
      `INSERT INTO canvases (document_id, user_id, revision, data, created_at, updated_at)
       VALUES (@document_id, @user_id, @revision, @data, @at, @at)`,
    ),
    update: db.prepare(
      `UPDATE canvases SET revision = @revision, data = @data, updated_at = @at
       WHERE document_id = @document_id AND user_id = @user_id AND revision = @previous`,
    ),
    cacheGet: db.prepare(
      "SELECT positions FROM canvas_layout_cache WHERE document_id = ? AND variant = ?",
    ),
    cachePut: db.prepare(
      `INSERT INTO canvas_layout_cache (document_id, variant, positions, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (document_id, variant) DO UPDATE SET positions = excluded.positions,
         updated_at = excluded.updated_at`,
    ),
    cacheClear: db.prepare("DELETE FROM canvas_layout_cache WHERE document_id = ?"),
  };

  const toStored = (canvas: Canvas): string =>
    JSON.stringify({
      cards: canvas.cards,
      connectors: canvas.connectors,
      frames: canvas.frames,
      syncedBlockIds: canvas.syncedBlockIds,
      allowSelfLinks: canvas.allowSelfLinks,
    } satisfies Stored);

  return {
    doc(userId: string, documentId: string): VisibleDoc | undefined {
      const row = q.doc.get(documentId, userId) as
        | { id: string; node_id: string; title: string; revision: number }
        | undefined;
      return row && { id: row.id, nodeId: row.node_id, title: row.title, revision: row.revision };
    },
    /** The document of a node, trashed or not (the duplicate hook runs before anyone looks). */
    docOfNode(userId: string, nodeId: string) {
      const row = q.docOfNode.get(nodeId, userId) as
        | { id: string; trashed_at: string | null }
        | undefined;
      return row && { id: row.id, trashed: row.trashed_at !== null };
    },
    blockIds(documentId: string): string[] {
      return (q.blockIds.all(documentId) as Array<{ id: string }>).map((r) => r.id);
    },
    get(userId: string, documentId: string): Canvas | undefined {
      const row = q.get.get(documentId, userId) as CanvasRow | undefined;
      if (!row) return undefined;
      const data = JSON.parse(row.data) as Stored;
      return { documentId, revision: row.revision, updatedAt: row.updated_at, ...data };
    },
    insert(userId: string, canvas: Canvas): void {
      q.insert.run({
        document_id: canvas.documentId,
        user_id: userId,
        revision: canvas.revision,
        data: toStored(canvas),
        at: canvas.updatedAt,
      });
    },
    /** Write the next revision; false when the stored revision is not `previous` (never, in one process). */
    update(userId: string, canvas: Canvas, previous: number): boolean {
      return (
        q.update.run({
          document_id: canvas.documentId,
          user_id: userId,
          revision: canvas.revision,
          data: toStored(canvas),
          at: canvas.updatedAt,
          previous,
        }).changes === 1
      );
    },
    cacheGet(documentId: string, variant: LayoutVariant): Record<string, Point> | null {
      const row = q.cacheGet.get(documentId, variant) as { positions: string } | undefined;
      return row ? (JSON.parse(row.positions) as Record<string, Point>) : null;
    },
    cachePut(
      documentId: string,
      variant: LayoutVariant,
      positions: Record<string, Point>,
      at: string,
    ) {
      q.cachePut.run(documentId, variant, JSON.stringify(positions), at);
    },
    cacheClear(documentId: string): void {
      q.cacheClear.run(documentId);
    },
  };
}

export type CanvasRepo = ReturnType<typeof createCanvasRepo>;
