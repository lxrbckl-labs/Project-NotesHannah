import type { Actor } from "@notes/schema";
import type { Db } from "../../db/client.js";
import { AppError } from "../../http/errors.js";

/** One entry of the change feed (H9): something that changed, who did it, and when. */
export interface ChangeEntry {
  /** Position in the feed. Strictly increasing; pass the last one back as `cursor`. */
  seq: number;
  at: string;
  /** e.g. "document.created", "document.updated", "document.trashed". */
  action: string;
  objectType: string;
  /** The objects touched: the document, plus any blocks. */
  objectIds: string[];
  documentId: string | null;
  nodeId: string | null;
  /** The document's revision after the change, when it has one. */
  revision: number | null;
  actor: Actor;
  /** Her request an agent said it was answering, when it said so. */
  requestId: string | null;
  summary: string;
}

export interface ChangeInput {
  action: string;
  objectType: string;
  objectIds: readonly string[];
  documentId?: string | null | undefined;
  nodeId?: string | null | undefined;
  revision?: number | null | undefined;
  actor: Actor;
  requestId?: string | null | undefined;
  summary: string;
  /** ISO timestamp; defaults to the feed's clock. */
  at?: string | undefined;
}

export interface ChangePage {
  items: ChangeEntry[];
  /** Pass this as `cursor` next time. It never goes backwards, even when `items` is empty. */
  nextCursor: string;
  /** True when more entries are already waiting (the limit cut this page short). */
  hasMore: boolean;
}

interface Row {
  seq: number;
  at: string;
  action: string;
  object_type: string;
  object_ids: string;
  document_id: string | null;
  node_id: string | null;
  revision: number | null;
  actor: string;
  request_id: string | null;
  summary: string;
}

export const MAX_CHANGE_PAGE = 500;
const DEFAULT_CHANGE_PAGE = 100;

/** Parse a feed cursor ("0" or a prior `nextCursor`), or throw `invalid_input`. */
export function parseChangeCursor(cursor: string | undefined | null): number {
  if (cursor === undefined || cursor === null || cursor === "") return 0;
  if (!/^\d{1,15}$/.test(cursor)) {
    throw new AppError("invalid_input", "That cursor is not one this feed gave out.", {
      hint: 'Use the "nextCursor" of a previous response, or leave the cursor out to start from the beginning.',
      example: { cursor: "42" },
    });
  }
  return Number(cursor);
}

export function createChangeFeed(db: Db, now: () => number = Date.now) {
  const insert = db.prepare(
    `INSERT INTO changes (user_id, at, action, object_type, object_ids, document_id, node_id,
       revision, actor, request_id, summary)
     VALUES (@user_id, @at, @action, @object_type, @object_ids, @document_id, @node_id,
       @revision, @actor, @request_id, @summary)`,
  );
  const since = db.prepare(
    "SELECT * FROM changes WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT ?",
  );
  const latest = db.prepare("SELECT MAX(seq) AS seq FROM changes WHERE user_id = ?");

  function toEntry(r: Row): ChangeEntry {
    return {
      seq: r.seq,
      at: r.at,
      action: r.action,
      objectType: r.object_type,
      objectIds: JSON.parse(r.object_ids) as string[],
      documentId: r.document_id,
      nodeId: r.node_id,
      revision: r.revision,
      actor: JSON.parse(r.actor) as Actor,
      requestId: r.request_id,
      summary: r.summary,
    };
  }

  return {
    /** Append an entry. Call inside the same transaction as the change it describes. */
    record(userId: string, input: ChangeInput): number {
      const result = insert.run({
        user_id: userId,
        at: input.at ?? new Date(now()).toISOString(),
        action: input.action,
        object_type: input.objectType,
        object_ids: JSON.stringify(input.objectIds),
        document_id: input.documentId ?? null,
        node_id: input.nodeId ?? null,
        revision: input.revision ?? null,
        actor: JSON.stringify(input.actor),
        request_id: input.requestId ?? null,
        summary: input.summary.slice(0, 500),
      });
      return Number(result.lastInsertRowid);
    },

    /** Entries after `cursor`, oldest first. */
    changesSince(userId: string, cursor?: string | null, limit?: number): ChangePage {
      const after = parseChangeCursor(cursor);
      const size = Math.min(Math.max(limit ?? DEFAULT_CHANGE_PAGE, 1), MAX_CHANGE_PAGE);
      const rows = since.all(userId, after, size + 1) as Row[];
      const more = rows.length > size;
      const items = (more ? rows.slice(0, size) : rows).map(toEntry);
      const last = items[items.length - 1];
      return { items, nextCursor: String(last ? last.seq : after), hasMore: more };
    },

    /** The cursor that means "everything so far": start polling from here. */
    latestCursor(userId: string): string {
      const row = latest.get(userId) as { seq: number | null };
      return String(row.seq ?? 0);
    },
  };
}

export type ChangeFeed = ReturnType<typeof createChangeFeed>;
