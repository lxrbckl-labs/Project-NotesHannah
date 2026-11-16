import {
  CreateReferenceInput,
  newId,
  REFERENCE_LIMITS,
  type ReferenceKind,
  type ReferencePlace,
  type ReferenceSearchHit,
  referenceSourceOf,
  type SavedReference,
  UpdateReferenceInput,
} from "@notes/schema";
import type { z } from "zod";
import type { Db } from "../../db/client.js";
import type { AuthContext } from "../../http/auth-context.js";
import type { ServerDeps } from "../../http/deps.js";
import { AppError } from "../../http/errors.js";
import { leaveTrace, plural, type Trace } from "../activity/trace.js";
import { loadTree, nodeWords, type Tree } from "../practice/tree.js";

/** The library kinds a reference can be tied to: the places she studies in. */
const TIEABLE = new Set(["course", "folder", "lecture", "document"]);

interface ReferenceRow {
  seq: number;
  id: string;
  user_id: string;
  title: string;
  url: string;
  note: string;
  kind: string | null;
  favourite: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ReferenceListOptions {
  q?: string | undefined;
  kind?: ReferenceKind | undefined;
  nodeId?: string | undefined;
  /** With nodeId: also references tied to anything inside it (default true). */
  within?: boolean | undefined;
  courseId?: string | undefined;
  favourite?: boolean | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

const notFound = () =>
  new AppError("not_found", "No such reference.", {
    hint: "Reference IDs look like ref_...; list them with GET /api/references.",
  });

const EXAMPLE = {
  title: "Hypertension guideline (ACC/AHA)",
  url: "https://doi.org/10.1161/HYP.0000000000000065",
  note: "The BP targets table.",
  kind: "guideline",
  nodeIds: ["nod_..."],
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

function encodeCursor(offset: number): string {
  return Buffer.from(`o:${offset}`, "utf8").toString("base64url");
}
function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const [tag, n] = Buffer.from(cursor, "base64url").toString("utf8").split(":");
  const offset = Number(n);
  if (tag !== "o" || !Number.isInteger(offset) || offset < 0) {
    throw new AppError("invalid_input", "The cursor is not valid.", {
      hint: "Pass the nextCursor value from the previous page unchanged, or omit cursor.",
    });
  }
  return offset;
}

/**
 * Her saved references (features O1 to O6). Per user like every domain: another person's
 * reference behaves exactly like a missing one. Agents may read and add; changing and deleting
 * stay with her (delete needs her browser session).
 */
export function createReferencesService(deps: Pick<ServerDeps, "db" | "now">, ports: Trace = {}) {
  const db: Db = deps.db;
  const nowIso = () => new Date(deps.now()).toISOString();

  const q = {
    byId: db.prepare('SELECT * FROM "references" WHERE id = ? AND user_id = ?'),
    count: db.prepare('SELECT COUNT(*) AS n FROM "references" WHERE user_id = ?'),
    insert: db.prepare(
      `INSERT INTO "references" (id, user_id, title, url, note, kind, favourite, created_by, created_at, updated_at)
       VALUES (@id, @user_id, @title, @url, @note, @kind, @favourite, @created_by, @created_at, @updated_at)`,
    ),
    update: db.prepare(
      `UPDATE "references" SET title = @title, url = @url, note = @note, kind = @kind, favourite = @favourite,
       updated_at = @updated_at WHERE id = @id AND user_id = @user_id`,
    ),
    del: db.prepare('DELETE FROM "references" WHERE id = ? AND user_id = ?'),
    places: db.prepare(
      "SELECT node_id FROM reference_nodes WHERE reference_id = ? ORDER BY position, node_id",
    ),
    clearPlaces: db.prepare("DELETE FROM reference_nodes WHERE reference_id = ?"),
    addPlace: db.prepare(
      "INSERT INTO reference_nodes (reference_id, user_id, node_id, position) VALUES (?, ?, ?, ?)",
    ),
  };

  function assertWrite(auth: AuthContext): void {
    if (auth.scope !== "write") {
      throw new AppError("read_only_key", "This API key is read-only.", {
        hint: "Create a read-write key in Settings to make changes.",
      });
    }
  }

  function parse<T extends z.ZodType>(schema: T, input: unknown, example: unknown): z.infer<T> {
    const r = schema.safeParse(input);
    if (r.success) return r.data;
    throw new AppError("invalid_input", "The reference is not valid.", {
      hint: r.error.issues.map((i) => `${i.path.join(".") || "(body)"}: ${i.message}`).join("; "),
      example,
    });
  }

  function courseOf(tree: Tree, nodeId: string): { id: string; name: string } | null {
    for (const id of tree.chain(nodeId)) {
      const n = tree.nodes.get(id);
      if (n?.kind === "course") return { id: n.id, name: n.name };
    }
    return null;
  }

  function place(tree: Tree, nodeId: string): ReferencePlace | null {
    const n = tree.nodes.get(nodeId);
    if (!n) return null;
    const course = courseOf(tree, nodeId);
    // A node under a trashed ancestor is out of sight too, even when it was not trashed itself.
    const trashed = tree.chain(nodeId).some((id) => tree.nodes.get(id)?.trashed);
    return {
      nodeId,
      name: n.name,
      kind: n.kind,
      path: tree.path(nodeId),
      courseId: course?.id ?? null,
      courseName: course?.name ?? null,
      trashed,
    };
  }

  function view(row: ReferenceRow, tree: Tree): SavedReference {
    const ids = (q.places.all(row.id) as Array<{ node_id: string }>).map((r) => r.node_id);
    return {
      id: row.id,
      title: row.title,
      url: row.url,
      note: row.note,
      kind: (row.kind as ReferenceKind | null) ?? null,
      source: referenceSourceOf(row.url),
      favourite: row.favourite === 1,
      places: ids.flatMap((id) => {
        const p = place(tree, id);
        return p ? [p] : [];
      }),
      createdBy: JSON.parse(row.created_by),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function row(userId: string, id: string): ReferenceRow {
    const r = q.byId.get(id, userId) as ReferenceRow | undefined;
    if (!r) throw notFound();
    return r;
  }

  /** Every tied place must be a live course, folder, lecture or document of hers. */
  function checkPlaces(tree: Tree, nodeIds: readonly string[]): string[] {
    const unique = [...new Set(nodeIds)];
    for (const id of unique) {
      const n = tree.nodes.get(id);
      if (!n) {
        throw new AppError("not_found", `No such library item: ${id}.`, {
          hint: "Tie a reference to a course, folder, lecture or document of hers; list them with GET /api/nodes.",
        });
      }
      if (!TIEABLE.has(n.kind)) {
        throw new AppError("invalid_input", `"${n.name}" is a ${n.kind}.`, {
          hint: "A reference can be tied to a course, folder, lecture or document.",
        });
      }
      if (tree.chain(id).some((x) => tree.nodes.get(x)?.trashed)) {
        throw new AppError("invalid_input", `"${n.name}" is in the trash.`, {
          hint: "Restore it first, or leave it out.",
        });
      }
    }
    return unique;
  }

  function placesWords(tree: Tree, nodeIds: readonly string[]): string {
    return nodeIds.length === 0
      ? ""
      : `, tied to ${nodeIds.map((id) => nodeWords(tree.nodes.get(id))).join(", ")}`;
  }

  function create(auth: AuthContext, raw: unknown): SavedReference {
    assertWrite(auth);
    const input = parse(CreateReferenceInput, raw, EXAMPLE);
    const { n } = q.count.get(auth.userId) as { n: number };
    if (n >= REFERENCE_LIMITS.perUser) {
      throw new AppError("invalid_input", `She already has ${n} saved references, the most kept.`, {
        hint: "Delete some she no longer needs first.",
      });
    }
    const tree = loadTree(db, auth.userId);
    const nodeIds = checkPlaces(tree, input.nodeIds);
    const now = nowIso();
    const id = newId("reference", Date.parse(now));
    db.transaction(() => {
      q.insert.run({
        id,
        user_id: auth.userId,
        title: input.title,
        url: input.url,
        note: input.note,
        kind: input.kind,
        favourite: input.favourite ? 1 : 0,
        created_by: JSON.stringify(auth.actor),
        created_at: now,
        updated_at: now,
      });
      for (const [i, nodeId] of nodeIds.entries()) q.addPlace.run(id, auth.userId, nodeId, i);
      leaveTrace(ports, auth.userId, auth.actor, {
        action: "reference.created",
        objectType: "reference",
        objectIds: [id],
        nodeId: nodeIds[0] ?? null,
        summary: `Saved the reference "${input.title}"${placesWords(tree, nodeIds)}`,
      });
    })();
    return view(row(auth.userId, id), tree);
  }

  function get(auth: AuthContext, id: string): SavedReference {
    return view(row(auth.userId, id), loadTree(db, auth.userId));
  }

  /** Pinned first, then newest first. Small per person (at most 500), so filtering happens here. */
  function list(
    auth: AuthContext,
    opts: ReferenceListOptions = {},
  ): { items: SavedReference[]; nextCursor: string | null } {
    const limit = Math.min(REFERENCE_LIMITS.perUser, Math.max(1, opts.limit ?? 100));
    const offset = decodeCursor(opts.cursor);
    const where = ["user_id = @user"];
    const params: Record<string, unknown> = { user: auth.userId };
    if (opts.kind) {
      where.push("kind = @kind");
      params.kind = opts.kind;
    }
    if (opts.favourite !== undefined) {
      where.push("favourite = @fav");
      params.fav = opts.favourite ? 1 : 0;
    }
    for (const [i, w] of words(opts.q ?? "").entries()) {
      where.push(`lower(title || ' ' || note || ' ' || url) LIKE @w${i} ESCAPE '\\'`);
      params[`w${i}`] = `%${w}%`;
    }
    const tree = loadTree(db, auth.userId);
    const scopes: string[][] = [];
    if (opts.nodeId) {
      if (!tree.nodes.has(opts.nodeId)) {
        throw new AppError("not_found", `No such library item: ${opts.nodeId}.`);
      }
      scopes.push(opts.within === false ? [opts.nodeId] : tree.subtree(opts.nodeId));
    }
    if (opts.courseId) {
      if (!tree.nodes.has(opts.courseId)) {
        throw new AppError("not_found", `No such course: ${opts.courseId}.`);
      }
      scopes.push(tree.subtree(opts.courseId));
    }
    for (const [i, ids] of scopes.entries()) {
      // Only ties to places in sight count: a trashed lecture's references stay hidden there.
      const live = ids.filter((id) => !tree.chain(id).some((x) => tree.nodes.get(x)?.trashed));
      where.push(
        `id IN (SELECT reference_id FROM reference_nodes WHERE user_id = @user AND node_id IN (SELECT value FROM json_each(@scope${i})))`,
      );
      params[`scope${i}`] = JSON.stringify(live);
    }
    const rows = db
      .prepare(
        `SELECT * FROM "references" WHERE ${where.join(" AND ")}
         ORDER BY favourite DESC, seq DESC LIMIT ${limit + 1} OFFSET ${offset}`,
      )
      .all(params) as ReferenceRow[];
    const page = rows.slice(0, limit);
    return {
      items: page.map((r) => view(r, tree)),
      nextCursor: rows.length > limit ? encodeCursor(offset + limit) : null,
    };
  }

  function update(auth: AuthContext, id: string, raw: unknown): SavedReference {
    assertWrite(auth);
    const input = parse(UpdateReferenceInput, raw, { title: "New title", favourite: true });
    const old = row(auth.userId, id);
    const tree = loadTree(db, auth.userId);
    const nodeIds = input.nodeIds ? checkPlaces(tree, input.nodeIds) : null;
    db.transaction(() => {
      q.update.run({
        id,
        user_id: auth.userId,
        title: input.title ?? old.title,
        url: input.url ?? old.url,
        note: input.note ?? old.note,
        kind: input.kind === undefined ? old.kind : input.kind,
        favourite: input.favourite === undefined ? old.favourite : input.favourite ? 1 : 0,
        updated_at: nowIso(),
      });
      if (nodeIds) {
        q.clearPlaces.run(id);
        for (const [i, nodeId] of nodeIds.entries()) q.addPlace.run(id, auth.userId, nodeId, i);
      }
      const changed = [
        input.title !== undefined && input.title !== old.title ? `renamed to "${input.title}"` : "",
        input.url !== undefined && input.url !== old.url ? "address changed" : "",
        input.note !== undefined && input.note !== old.note ? "note changed" : "",
        input.kind !== undefined && input.kind !== old.kind ? "kind changed" : "",
        nodeIds ? `now tied to ${plural(nodeIds.length, "place")}` : "",
        input.favourite !== undefined && (input.favourite ? 1 : 0) !== old.favourite
          ? input.favourite
            ? "pinned"
            : "unpinned"
          : "",
      ].filter(Boolean);
      leaveTrace(ports, auth.userId, auth.actor, {
        action: "reference.updated",
        objectType: "reference",
        objectIds: [id],
        summary: `Changed the reference "${old.title}": ${changed.join(", ") || "no visible change"}`,
      });
    })();
    return view(row(auth.userId, id), tree);
  }

  /** Delete a saved reference. Hers only (her browser session); the library places are untouched. */
  function remove(auth: AuthContext, id: string): void {
    assertWrite(auth);
    if (auth.via !== "session" || auth.actor.type !== "user") {
      throw new AppError("forbidden", "Deleting a reference needs her signed-in browser session.", {
        hint: "An agent can read and add references; ask her to delete one.",
      });
    }
    const old = row(auth.userId, id);
    db.transaction(() => {
      q.del.run(id, auth.userId);
      leaveTrace(ports, auth.userId, auth.actor, {
        action: "reference.deleted",
        objectType: "reference",
        objectIds: [id],
        summary: `Deleted the reference "${old.title}"`,
      });
    })();
  }

  /**
   * Her references whose title, note or address hold every word, for the unified search. A
   * person keeps at most 500, so a plain scan is quick; title matches come first, then pinned.
   */
  function searchReferences(
    userId: string,
    text: string,
    options: { offset?: number | undefined; limit?: number | undefined } = {},
  ): Array<Omit<ReferenceSearchHit, "kind">> {
    const ws = words(text);
    if (ws.length === 0) return [];
    const params: Record<string, unknown> = { user: userId };
    const all: string[] = [];
    const inTitle: string[] = [];
    for (const [i, w] of ws.entries()) {
      params[`w${i}`] = `%${w}%`;
      all.push(`lower(title || ' ' || note || ' ' || url) LIKE @w${i} ESCAPE '\\'`);
      inTitle.push(`lower(title) LIKE @w${i} ESCAPE '\\'`);
    }
    const rows = db
      .prepare(
        `SELECT * FROM "references" WHERE user_id = @user AND ${all.join(" AND ")}
         ORDER BY (${inTitle.join(" AND ")}) DESC, favourite DESC, seq DESC
         LIMIT ${Math.max(1, options.limit ?? 50)} OFFSET ${Math.max(0, options.offset ?? 0)}`,
      )
      .all(params) as ReferenceRow[];
    return rows.map((r) => ({
      referenceId: r.id,
      title: r.title,
      url: r.url,
      referenceKind: (r.kind as ReferenceKind | null) ?? null,
      source: referenceSourceOf(r.url),
      snippet: r.note || r.url,
    }));
  }

  /**
   * Where her study material draws on this reference: blocks whose outside references name it
   * (by its id, or by the same address). Read straight from the documents table, the way practice
   * reads the library tree: read only, and a reference never changes a document.
   */
  function usedIn(
    auth: AuthContext,
    id: string,
  ): Array<{ documentId: string; documentTitle: string; nodeId: string; blockId: string }> {
    const r = row(auth.userId, id);
    const rows = db
      .prepare(
        `SELECT DISTINCT b.id AS block_id, d.id AS document_id, d.title, d.node_id, b.position
         FROM blocks b JOIN documents d ON d.id = b.document_id, json_each(b.data, '$.references') ref
         WHERE b.user_id = ? AND d.trashed_at IS NULL
           AND (json_extract(ref.value, '$.referenceId') = ? OR json_extract(ref.value, '$.url') = ?)
         ORDER BY d.title, b.position LIMIT 100`,
      )
      .all(auth.userId, r.id, r.url) as Array<{
      block_id: string;
      document_id: string;
      title: string;
      node_id: string;
    }>;
    return rows.map((x) => ({
      documentId: x.document_id,
      documentTitle: x.title,
      nodeId: x.node_id,
      blockId: x.block_id,
    }));
  }

  // ---- node hooks (the composition root calls these from the library listener) ----

  /**
   * Nodes deleted for good: their ties go, the references stay (a reference is hers, not a part
   * of the lecture). Trashing and restoring need no hook: ties are kept and simply hidden while
   * the place is in the trash.
   */
  function onNodeDeleted(userId: string, nodeIds: readonly string[]): void {
    db.prepare(
      "DELETE FROM reference_nodes WHERE user_id = ? AND node_id IN (SELECT value FROM json_each(?))",
    ).run(userId, JSON.stringify([...new Set(nodeIds)]));
  }

  /** A node was duplicated: what was tied to the original is tied to the copy too. */
  function onNodesDuplicated(
    userId: string,
    pairs: ReadonlyArray<readonly [string, string]>,
  ): void {
    const rows = db.prepare(
      "SELECT reference_id, (SELECT COALESCE(MAX(position), -1) + 1 FROM reference_nodes x WHERE x.reference_id = r.reference_id) AS next FROM reference_nodes r WHERE user_id = ? AND node_id = ?",
    );
    const add = db.prepare(
      "INSERT OR IGNORE INTO reference_nodes (reference_id, user_id, node_id, position) VALUES (?, ?, ?, ?)",
    );
    db.transaction(() => {
      for (const [from, to] of pairs) {
        for (const r of rows.all(userId, from) as Array<{ reference_id: string; next: number }>) {
          add.run(r.reference_id, userId, to, r.next);
        }
      }
    })();
  }

  return {
    create,
    get,
    list,
    update,
    delete: remove,
    usedIn,
    searchReferences,
    onNodeDeleted,
    onNodesDuplicated,
  };
}

export type ReferencesService = ReturnType<typeof createReferencesService>;
