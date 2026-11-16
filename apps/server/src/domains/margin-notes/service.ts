import {
  type Block,
  blockPlainText,
  type ColorToken,
  CreateMarginNoteInput,
  MARGIN_NOTE_LIMITS,
  type MarginNote,
  type MarginNoteSearchHit,
  marginNoteSnippet,
  newId,
  ReattachMarginNoteInput,
  UpdateMarginNoteInput,
} from "@notes/schema";
import type { z } from "zod";
import type { Db } from "../../db/client.js";
import type { AuthContext } from "../../http/auth-context.js";
import type { ServerDeps } from "../../http/deps.js";
import { AppError } from "../../http/errors.js";
import { leaveTrace, type Trace } from "../activity/trace.js";

interface NoteRow {
  seq: number;
  id: string;
  user_id: string;
  document_id: string;
  block_id: string;
  quote: string | null;
  text: string;
  colour: string | null;
  resolved_at: string | null;
  detached_at: string | null;
  snippet: string;
  created_at: string;
  updated_at: string;
}

interface DocRow {
  id: string;
  node_id: string;
  title: string;
}

/** What a document write tells the domains built on its blocks (the documents service's port). */
export interface BlocksChange {
  userId: string;
  documentId: string;
  nodeId: string;
  title: string;
  blocks: readonly Block[];
  at: string;
}

/** A note as an agent reads it: with the type of the block it sits beside (null when detached). */
export type AgentMarginNote = MarginNote & { blockType: string | null };

/** One of her open notes across documents, for an agent's "what is she stuck on" look. */
export type RecentMarginNote = AgentMarginNote & { documentTitle: string; nodeId: string };

const notFoundDocument = () =>
  new AppError("not_found", "No such document.", {
    hint: "Check the document ID. Find a document through its library node: GET /api/nodes/:nodeId/document.",
  });

const notFoundNote = (documentId: string) =>
  new AppError("not_found", "No such side note on this document.", {
    hint: `Side note IDs look like mgn_...; list them with GET /api/documents/${documentId}/margin-notes.`,
  });

const EXAMPLE = {
  blockId: "blk_01J9Z8Y7X6W5V4T3S2R1Q0P9N8",
  text: "Ask in office hours: why is labetalol fine in pregnancy?",
  quote: "labetalol",
  colour: "yellow",
};

/** "beta  blockers" -> ["beta", "blockers"], lower case, each safe inside LIKE. */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .map((w) => w.replace(/[\\%_]/g, (c) => `\\${c}`));
}

function view(row: NoteRow): MarginNote {
  return {
    id: row.id,
    documentId: row.document_id,
    blockId: row.block_id,
    quote: row.quote,
    text: row.text,
    colour: (row.colour as ColorToken | null) ?? null,
    resolved: row.resolved_at !== null,
    resolvedAt: row.resolved_at,
    detached: row.detached_at !== null,
    detachedAt: row.detached_at,
    snippet: row.snippet,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Her side notes (docs/side-notes.md): private remarks beside the blocks of a document. Per user
 * like every domain: another person's document or note behaves exactly like a missing one. A
 * document in the trash is not found either, as the documents service treats it for reads.
 *
 * Notes live in their own table and are never part of the document: writing one leaves the
 * blocks, the review state and the revision history alone, so she can annotate a guide an agent
 * wrote without touching it. Agents read them (they say where she is stuck); only her browser
 * session writes them.
 *
 * The documents and blocks tables are read directly and read only, the way references read
 * them: domains do not import each other's code.
 *
 * Duplicating a document does not copy its notes: they are her remarks on that one copy.
 */
export function createMarginNotesService(deps: Pick<ServerDeps, "db" | "now">, ports: Trace = {}) {
  const db: Db = deps.db;
  const nowIso = () => new Date(deps.now()).toISOString();

  const q = {
    doc: db.prepare(
      "SELECT id, node_id, title FROM documents WHERE id = ? AND user_id = ? AND trashed_at IS NULL",
    ),
    block: db.prepare(
      "SELECT id, type, plain_text FROM blocks WHERE id = ? AND document_id = ? AND user_id = ?",
    ),
    list: db.prepare(
      "SELECT * FROM margin_notes WHERE user_id = ? AND document_id = ? ORDER BY seq",
    ),
    byId: db.prepare("SELECT * FROM margin_notes WHERE id = ? AND user_id = ? AND document_id = ?"),
    count: db.prepare(
      "SELECT COUNT(*) AS n FROM margin_notes WHERE user_id = ? AND document_id = ?",
    ),
    insert: db.prepare(
      `INSERT INTO margin_notes (id, user_id, document_id, block_id, quote, text, colour, snippet, created_at, updated_at)
       VALUES (@id, @user_id, @document_id, @block_id, @quote, @text, @colour, @snippet, @now, @now)`,
    ),
    update: db.prepare(
      `UPDATE margin_notes SET text = @text, colour = @colour, resolved_at = @resolved_at, updated_at = @now
       WHERE id = @id AND user_id = @user_id`,
    ),
    reattach: db.prepare(
      `UPDATE margin_notes SET block_id = @block_id, quote = @quote, snippet = @snippet, detached_at = NULL,
       updated_at = @now WHERE id = @id AND user_id = @user_id`,
    ),
    del: db.prepare("DELETE FROM margin_notes WHERE id = ? AND user_id = ?"),
    // The block-write hook: only what it needs, and usually no rows at all.
    anchors: db.prepare(
      "SELECT id, block_id, snippet, detached_at FROM margin_notes WHERE user_id = ? AND document_id = ?",
    ),
    follow: db.prepare("UPDATE margin_notes SET detached_at = NULL, snippet = ? WHERE id = ?"),
    detach: db.prepare(
      "UPDATE margin_notes SET detached_at = COALESCE(detached_at, ?) WHERE id = ?",
    ),
  };

  /** Writing a note is hers alone: a write scope is not enough, it takes her browser session. */
  function assertHers(auth: AuthContext): void {
    if (auth.scope !== "write") {
      throw new AppError("read_only_key", "This API key is read-only.", {
        hint: "Side notes are hers: only her signed-in browser session writes them.",
      });
    }
    if (auth.via !== "session" || auth.actor.type !== "user") {
      throw new AppError(
        "forbidden",
        "Side notes are hers: an agent can read them, not write them.",
        {
          hint: "Read them with GET /api/documents/:id/margin-notes or the side_notes tool, then address them in your edits or in a request reply. Only she adds, changes or deletes a side note.",
        },
      );
    }
  }

  function parse<T extends z.ZodType>(schema: T, input: unknown, example: unknown): z.infer<T> {
    const r = schema.safeParse(input);
    if (r.success) return r.data;
    throw new AppError("invalid_input", "The side note is not valid.", {
      hint: r.error.issues.map((i) => `${i.path.join(".") || "(body)"}: ${i.message}`).join("; "),
      example,
    });
  }

  function document(userId: string, documentId: string): DocRow {
    const d = q.doc.get(documentId, userId) as DocRow | undefined;
    if (!d) throw notFoundDocument();
    return d;
  }

  /** The block as it is now, or a not_found that says where to look. */
  function block(userId: string, documentId: string, blockId: string) {
    const b = q.block.get(blockId, documentId, userId) as
      | { id: string; type: string; plain_text: string }
      | undefined;
    if (!b) {
      throw new AppError("not_found", `Block ${blockId} is not in this document.`, {
        hint: `A side note sits beside one of the document's current blocks. Read them: GET /api/documents/${documentId}.`,
      });
    }
    return b;
  }

  function note(userId: string, documentId: string, noteId: string): NoteRow {
    const r = q.byId.get(noteId, userId, documentId) as NoteRow | undefined;
    if (!r) throw notFoundNote(documentId);
    return r;
  }

  function trace(auth: AuthContext, d: DocRow, action: string, id: string, summary: string) {
    leaveTrace(ports, auth.userId, auth.actor, {
      action,
      objectType: "margin_note",
      objectIds: [id],
      documentId: d.id,
      nodeId: d.node_id,
      // Never her words: the feed is read by agents and the note may be private thinking.
      summary,
      // Only she writes notes, and the activity log records agents only: nothing to add there.
      quiet: true,
    });
  }

  /** Every note of hers on the document, oldest first (resolved and detached ones included). */
  function list(auth: AuthContext, documentId: string): MarginNote[] {
    const d = document(auth.userId, documentId);
    return (q.list.all(auth.userId, d.id) as NoteRow[]).map(view);
  }

  function create(auth: AuthContext, documentId: string, raw: unknown): MarginNote {
    assertHers(auth);
    const input = parse(CreateMarginNoteInput, raw, EXAMPLE);
    const d = document(auth.userId, documentId);
    const b = block(auth.userId, d.id, input.blockId);
    const { n } = q.count.get(auth.userId, d.id) as { n: number };
    if (n >= MARGIN_NOTE_LIMITS.perDocument) {
      throw new AppError(
        "invalid_input",
        `This document already has ${n} side notes, the most kept on one document.`,
        { hint: "Delete some resolved ones first." },
      );
    }
    const now = nowIso();
    const id = newId("marginNote", Date.parse(now));
    db.transaction(() => {
      q.insert.run({
        id,
        user_id: auth.userId,
        document_id: d.id,
        block_id: b.id,
        quote: input.quote || null,
        text: input.text,
        colour: input.colour,
        snippet: marginNoteSnippet(b.plain_text),
        now,
      });
      trace(auth, d, "margin_note.added", id, `Added a side note on "${d.title}"`);
    })();
    return view(note(auth.userId, d.id, id));
  }

  function update(auth: AuthContext, documentId: string, noteId: string, raw: unknown): MarginNote {
    assertHers(auth);
    const input = parse(UpdateMarginNoteInput, raw, { resolved: true });
    const d = document(auth.userId, documentId);
    const old = note(auth.userId, d.id, noteId);
    const now = nowIso();
    // Resolving keeps the first time it was resolved; un-resolving clears it.
    const resolvedAt =
      input.resolved === undefined
        ? old.resolved_at
        : input.resolved
          ? (old.resolved_at ?? now)
          : null;
    db.transaction(() => {
      q.update.run({
        id: old.id,
        user_id: auth.userId,
        text: input.text ?? old.text,
        colour: input.colour === undefined ? old.colour : input.colour,
        resolved_at: resolvedAt,
        now,
      });
      const what =
        input.resolved !== undefined && (old.resolved_at !== null) !== input.resolved
          ? input.resolved
            ? "Resolved"
            : "Reopened"
          : "Changed";
      trace(auth, d, "margin_note.changed", old.id, `${what} a side note on "${d.title}"`);
    })();
    return view(note(auth.userId, d.id, old.id));
  }

  function remove(auth: AuthContext, documentId: string, noteId: string): void {
    assertHers(auth);
    const d = document(auth.userId, documentId);
    const old = note(auth.userId, d.id, noteId);
    db.transaction(() => {
      q.del.run(old.id, auth.userId);
      trace(auth, d, "margin_note.deleted", old.id, `Deleted a side note on "${d.title}"`);
    })();
  }

  /** Move a note (usually a detached one) beside another block of the same document. */
  function reattach(
    auth: AuthContext,
    documentId: string,
    noteId: string,
    raw: unknown,
  ): MarginNote {
    assertHers(auth);
    const input = parse(ReattachMarginNoteInput, raw, { blockId: EXAMPLE.blockId });
    const d = document(auth.userId, documentId);
    const old = note(auth.userId, d.id, noteId);
    const b = block(auth.userId, d.id, input.blockId);
    db.transaction(() => {
      q.reattach.run({
        id: old.id,
        user_id: auth.userId,
        block_id: b.id,
        quote: input.quote || null,
        snippet: marginNoteSnippet(b.plain_text),
        now: nowIso(),
      });
      trace(auth, d, "margin_note.reattached", old.id, `Moved a side note on "${d.title}"`);
    })();
    return view(note(auth.userId, d.id, old.id));
  }

  // ---- agent reads (the side_notes tool) ----

  /**
   * Her notes on one document for an agent: open ones first, then resolved; within each, in the
   * order of the blocks they sit beside, detached ones last (oldest first among equals).
   */
  function forAgent(
    auth: AuthContext,
    documentId: string,
  ): { document: { id: string; title: string; nodeId: string }; items: AgentMarginNote[] } {
    const d = document(auth.userId, documentId);
    const rows = db
      .prepare(
        `SELECT n.*, b.type AS block_type, b.position AS block_position
         FROM margin_notes n LEFT JOIN blocks b ON b.id = n.block_id AND b.document_id = n.document_id
         WHERE n.user_id = ? AND n.document_id = ?
         ORDER BY n.resolved_at IS NOT NULL, b.position IS NULL, b.position, n.seq`,
      )
      .all(auth.userId, d.id) as Array<NoteRow & { block_type: string | null }>;
    return {
      document: { id: d.id, title: d.title, nodeId: d.node_id },
      items: rows.map((r) => ({ ...view(r), blockType: r.block_type })),
    };
  }

  /** Her open notes across every document in sight, newest first. */
  function recent(
    auth: AuthContext,
    options: { limit?: number | undefined } = {},
  ): RecentMarginNote[] {
    const limit = Math.min(100, Math.max(1, options.limit ?? 20));
    const rows = db
      .prepare(
        `SELECT n.*, d.title AS document_title, d.node_id, b.type AS block_type
         FROM margin_notes n JOIN documents d ON d.id = n.document_id
         LEFT JOIN blocks b ON b.id = n.block_id AND b.document_id = n.document_id
         WHERE n.user_id = ? AND n.resolved_at IS NULL AND d.trashed_at IS NULL
         ORDER BY n.seq DESC LIMIT ${limit}`,
      )
      .all(auth.userId) as Array<
      NoteRow & { document_title: string; node_id: string; block_type: string | null }
    >;
    return rows.map((r) => ({
      ...view(r),
      blockType: r.block_type,
      documentTitle: r.document_title,
      nodeId: r.node_id,
    }));
  }

  /**
   * Her notes whose text or quote hold every word, for the unified search. Open notes first, then
   * newest. Notes on documents in the trash stay out of sight, like the documents themselves.
   */
  function searchMarginNotes(
    userId: string,
    text: string,
    options: { offset?: number | undefined; limit?: number | undefined } = {},
  ): Array<Omit<MarginNoteSearchHit, "kind">> {
    const ws = words(text);
    if (ws.length === 0) return [];
    const params: Record<string, unknown> = { user: userId };
    const all: string[] = [];
    for (const [i, w] of ws.entries()) {
      params[`w${i}`] = `%${w}%`;
      all.push(`lower(n.text || ' ' || COALESCE(n.quote, '')) LIKE @w${i} ESCAPE '\\'`);
    }
    const rows = db
      .prepare(
        `SELECT n.*, d.title AS document_title, d.node_id FROM margin_notes n
         JOIN documents d ON d.id = n.document_id
         WHERE n.user_id = @user AND d.trashed_at IS NULL AND ${all.join(" AND ")}
         ORDER BY n.resolved_at IS NOT NULL, n.seq DESC
         LIMIT ${Math.max(1, options.limit ?? 50)} OFFSET ${Math.max(0, options.offset ?? 0)}`,
      )
      .all(params) as Array<NoteRow & { document_title: string; node_id: string }>;
    return rows.map((r) => ({
      noteId: r.id,
      documentId: r.document_id,
      nodeId: r.node_id,
      documentTitle: r.document_title,
      blockId: r.block_id,
      resolved: r.resolved_at !== null,
      detached: r.detached_at !== null,
      snippet: marginNoteSnippet(r.text),
    }));
  }

  // ---- document hook (the composition root calls this from the documents service) ----

  /**
   * A document's blocks were written. Runs inside that write's own transaction, with the blocks as
   * they now are, so a note always agrees with the document:
   *
   * - its block is still there: attached (a note detached earlier comes back when a restored
   *   revision brings the same block id back), and the snippet follows the block's text, so it is
   *   always the last known text;
   * - its block is gone (deleted, or replaced with fresh ids by replace_generated): detached from
   *   the first time it went missing, snippet kept. The note itself is never lost.
   *
   * Moving blocks keeps their ids, so notes simply follow. The note's own updatedAt stays: she did
   * not change it. No feed entry either: the document write already has one.
   */
  function onBlocksChanged(change: BlocksChange): void {
    const rows = q.anchors.all(change.userId, change.documentId) as Array<{
      id: string;
      block_id: string;
      snippet: string;
      detached_at: string | null;
    }>;
    if (rows.length === 0) return;
    const blocks = new Map(change.blocks.map((b) => [b.id, b]));
    for (const r of rows) {
      const b = blocks.get(r.block_id);
      if (b) {
        const snippet = marginNoteSnippet(blockPlainText(b));
        if (r.detached_at !== null || snippet !== r.snippet) q.follow.run(snippet, r.id);
      } else if (r.detached_at === null) {
        q.detach.run(change.at, r.id);
      }
    }
  }

  return {
    list,
    create,
    update,
    delete: remove,
    reattach,
    forAgent,
    recent,
    searchMarginNotes,
    onBlocksChanged,
  };
}

export type MarginNotesService = ReturnType<typeof createMarginNotesService>;
