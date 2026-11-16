import type { Actor } from "@notes/schema";
import type { Db } from "../../db/client.js";
import { AppError } from "../../http/errors.js";

/** A link from an activity entry to an object it touched. */
export interface ActivityLink {
  type: "document" | "block" | "request" | (string & {});
  id: string;
  /** The document a block belongs to. */
  documentId?: string;
  /** The library node, to open it. */
  nodeId?: string;
  /** A name to show, e.g. the document's title. */
  label?: string;
}

/** What other domains hand to the log. */
export interface ActivityInput {
  actor: Actor;
  /** A stable code, e.g. "block.inserted". */
  action: string;
  /** What the agent did, in plain words. */
  summary: string;
  links?: readonly ActivityLink[];
  /** ISO timestamp; defaults to the log's clock. */
  at?: string | undefined;
}

/**
 * What other domains (files, MCP) call to log agent work. Entries for the
 * signed-in user are ignored: the log is about agents.
 */
export interface ActivityPort {
  record(userId: string, entry: ActivityInput): void;
}

export interface ActivityEntry {
  id: number;
  at: string;
  keyId: string;
  keyLabel: string | null;
  action: string;
  summary: string;
  links: ActivityLink[];
}

export interface ActivityFilters {
  keyId?: string | undefined;
  action?: string | undefined;
  /** Only entries that touched this object (a document, block or request ID). */
  objectId?: string | undefined;
  since?: string | undefined;
  until?: string | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

export interface ActivityPage {
  items: ActivityEntry[];
  nextCursor: string | null;
}

interface Row {
  seq: number;
  at: string;
  key_id: string;
  key_label: string | null;
  action: string;
  summary: string;
  links: string;
}

const MAX_LINKS = 25;

export function createActivityLog(db: Db, now: () => number = Date.now) {
  const insert = db.prepare(
    `INSERT INTO activity (user_id, at, key_id, key_label, action, summary, links)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertObject = db.prepare(
    "INSERT OR IGNORE INTO activity_objects (activity_seq, object_id) VALUES (?, ?)",
  );

  function record(userId: string, entry: ActivityInput): boolean {
    if (entry.actor.type !== "agent") return false;
    const links = (entry.links ?? []).slice(0, MAX_LINKS);
    const result = insert.run(
      userId,
      entry.at ?? new Date(now()).toISOString(),
      entry.actor.keyId,
      entry.actor.label ?? null,
      entry.action,
      entry.summary.slice(0, 500),
      JSON.stringify(links),
    );
    const seq = Number(result.lastInsertRowid);
    for (const link of links) insertObject.run(seq, link.id);
    return true;
  }

  function list(userId: string, filters: ActivityFilters = {}): ActivityPage {
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
    const where = ["a.user_id = ?"];
    const args: unknown[] = [userId];
    if (filters.keyId) {
      where.push("a.key_id = ?");
      args.push(filters.keyId);
    }
    if (filters.action) {
      where.push("a.action = ?");
      args.push(filters.action);
    }
    if (filters.objectId) {
      where.push(
        "EXISTS (SELECT 1 FROM activity_objects o WHERE o.activity_seq = a.seq AND o.object_id = ?)",
      );
      args.push(filters.objectId);
    }
    if (filters.since) {
      where.push("a.at >= ?");
      args.push(filters.since);
    }
    if (filters.until) {
      where.push("a.at <= ?");
      args.push(filters.until);
    }
    if (filters.cursor) {
      if (!/^\d{1,15}$/.test(filters.cursor)) {
        throw new AppError("invalid_input", "That cursor is not one this log gave out.", {
          hint: 'Use the "nextCursor" of a previous response.',
          example: { cursor: "42" },
        });
      }
      where.push("a.seq < ?");
      args.push(Number(filters.cursor));
    }
    const rows = db
      .prepare(
        `SELECT a.* FROM activity a WHERE ${where.join(" AND ")} ORDER BY a.seq DESC LIMIT ?`,
      )
      .all(...args, limit + 1) as Row[];
    const more = rows.length > limit;
    const slice = more ? rows.slice(0, limit) : rows;
    const items = slice.map(
      (r): ActivityEntry => ({
        id: r.seq,
        at: r.at,
        keyId: r.key_id,
        keyLabel: r.key_label,
        action: r.action,
        summary: r.summary,
        links: JSON.parse(r.links) as ActivityLink[],
      }),
    );
    const last = items[items.length - 1];
    return { items, nextCursor: more && last ? String(last.id) : null };
  }

  const port: ActivityPort = {
    record(userId, entry) {
      record(userId, entry);
    },
  };

  return { record, recordActivity: record, listActivity: list, list, port };
}

export type ActivityLog = ReturnType<typeof createActivityLog>;
