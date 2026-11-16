import {
  type Actor,
  COURSE_SECTIONS,
  type CreateNodeInput,
  canContain,
  isFixed,
  type LibraryNode,
  MAX_FOLDER_DEPTH,
  type MoveNodeInput,
  type NodeKind,
  type NodeWithLinks,
  newId,
  type UpdateNodeInput,
} from "@notes/schema";
import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";
import type { Db } from "../../db/client.js";
import { AppError } from "../../http/errors.js";
import type { ActivityPort, ChangeInput } from "../activity/index.js";
import { decodeCursor, encodeCursor } from "./cursor.js";
import {
  call,
  EXAMPLE_ID,
  inTrash,
  misplaced,
  notFound,
  sectionRefused,
  tooDeep,
} from "./rules.js";

interface Row {
  seq: number;
  id: string;
  user_id: string;
  parent_id: string | null;
  kind: NodeKind;
  name: string;
  section: LibraryNode["section"];
  course_code: string | null;
  lecture_number: number | null;
  lecture_date: string | null;
  sort_key: string;
  favourite: number;
  created_at: string;
  updated_at: string;
  trashed_at: string | null;
  opened_at: string | null;
}

interface ChainRow {
  id: string;
  parent_id: string | null;
  kind: NodeKind;
  name: string;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface SearchHit {
  kind: "node";
  node: NodeWithLinks;
  snippet: string;
}

export interface ListOptions {
  cursor?: string | undefined;
  limit?: number | undefined;
  /** Skip this many hits (search only). Takes the place of `cursor`; the unified search pages with it. */
  offset?: number | undefined;
}

/**
 * Told about whole-subtree changes, inside the same transaction, so other
 * domains can keep what hangs off a node in step (its document, the source
 * files filed under it). Every listener is optional. `nodeIds` always cover
 * the node and everything under it.
 */
export interface LibraryListener {
  /** The nodes just went to the trash. */
  trashed?(event: NodesEvent): void;
  /** The nodes just came back from the trash. */
  restored?(event: NodesEvent): void;
  /** The nodes are about to be deleted for good (still readable while this runs). */
  deleted?(event: NodesEvent): void;
  /** `pairs` map each original node to its fresh copy, the copied root first. */
  duplicated?(event: {
    userId: string;
    actor: Actor;
    pairs: ReadonlyArray<{ fromId: string; toId: string }>;
  }): void;
}

export interface NodesEvent {
  userId: string;
  actor: Actor;
  nodeIds: readonly string[];
}

/** Where the change feed entries go (the activity domain's `ChangeFeed` fits). */
export interface ChangeRecorder {
  record(userId: string, input: ChangeInput): unknown;
}

export interface LibraryServiceOptions {
  /** Injected clock for tests. */
  now?: () => Date;
  listener?: LibraryListener;
  /** Every change is appended here, as the actor who made it. */
  changes?: ChangeRecorder;
  /** What agents do is logged here in plain words (entries for the user are ignored by the log). */
  activity?: ActivityPort;
}

const DEFAULT_LIMIT = 50;
/** Sort keys longer than this are rebalanced (the schema allows 64). */
const MAX_KEY_LENGTH = 48;
const MAX_NAME_LENGTH = 200;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export function createLibraryService(db: Db, options: LibraryServiceOptions = {}) {
  const clock = options.now ?? (() => new Date());
  const listener = options.listener ?? {};
  let lastStamp = 0;

  const userActor = (userId: string): Actor => ({ type: "user", userId });

  /** "lecture 07 · Beta blockers", "course Pharmacology II": a node in plain words. */
  function label(r: Pick<Row, "kind" | "name" | "lecture_number">): string {
    const number =
      r.kind === "lecture" && r.lecture_number !== null
        ? `${String(r.lecture_number).padStart(2, "0")} · `
        : "";
    return `${r.kind} ${number}${r.name}`;
  }

  /** Append to the change feed and, for an agent, the activity log. */
  function note(
    userId: string,
    actor: Actor,
    entry: { action: string; summary: string; node: Row; objectIds?: readonly string[] },
  ): void {
    options.changes?.record(userId, {
      action: `node.${entry.action}`,
      objectType: "node",
      objectIds: entry.objectIds ?? [entry.node.id],
      nodeId: entry.node.id,
      actor,
      summary: entry.summary,
    });
    options.activity?.record(userId, {
      actor,
      action: `library.${entry.action}`,
      summary: entry.summary,
      links: [{ type: "node", id: entry.node.id, nodeId: entry.node.id, label: entry.node.name }],
    });
  }

  /** Strictly increasing ISO timestamps, so one trash operation never shares a stamp with another. */
  function stamp(): string {
    const ms = Math.max(clock().getTime(), lastStamp + 1);
    lastStamp = ms;
    return new Date(ms).toISOString();
  }

  const q = {
    byId: db.prepare("SELECT * FROM nodes WHERE id = ? AND user_id = ?"),
    chain: db.prepare(
      `WITH RECURSIVE up(id, parent_id, kind, name) AS (
         SELECT id, parent_id, kind, name FROM nodes WHERE id = ? AND user_id = ?
         UNION ALL
         SELECT n.id, n.parent_id, n.kind, n.name FROM nodes n JOIN up ON n.id = up.parent_id
       ) SELECT * FROM up`,
    ),
    subtree: db.prepare(
      `WITH RECURSIVE sub(id) AS (
         SELECT id FROM nodes WHERE id = ? AND user_id = ?
         UNION ALL
         SELECT n.id FROM nodes n JOIN sub ON n.parent_id = sub.id
       ) SELECT n.* FROM nodes n JOIN sub ON n.id = sub.id`,
    ),
    childCount: db.prepare(
      `SELECT COUNT(*) AS n FROM nodes
       WHERE parent_id = ? AND (trashed_at IS NULL OR trashed_at = ?)`,
    ),
    maxKey: db.prepare(
      "SELECT MAX(sort_key) AS k FROM nodes WHERE user_id = ? AND parent_id IS ? AND id != ?",
    ),
    minKey: db.prepare(
      "SELECT MIN(sort_key) AS k FROM nodes WHERE user_id = ? AND parent_id IS ? AND id != ?",
    ),
    nextKey: db.prepare(
      `SELECT MIN(sort_key) AS k FROM nodes
       WHERE user_id = ? AND parent_id IS ? AND sort_key > ? AND id != ?`,
    ),
    siblingIds: db.prepare(
      "SELECT id FROM nodes WHERE user_id = ? AND parent_id IS ? ORDER BY sort_key",
    ),
    setKey: db.prepare("UPDATE nodes SET sort_key = ? WHERE id = ?"),
    insert: db.prepare(
      `INSERT INTO nodes (id, user_id, parent_id, kind, name, section, course_code,
         lecture_number, lecture_date, sort_key, favourite, created_at, updated_at)
       VALUES (@id, @user_id, @parent_id, @kind, @name, @section, @course_code,
         @lecture_number, @lecture_date, @sort_key, @favourite, @created_at, @updated_at)`,
    ),
  };

  const row = (userId: string, id: string) => q.byId.get(id, userId) as Row | undefined;

  function need(userId: string, id: string): Row {
    const found = row(userId, id);
    if (!found) throw notFound();
    return found;
  }

  function needLive(userId: string, id: string, action: string): Row {
    const found = need(userId, id);
    if (found.trashed_at !== null) throw inTrash(action, id);
    return found;
  }

  const chainOf = (userId: string, id: string): ChainRow[] =>
    (q.chain.all(id, userId) as ChainRow[]).reverse();

  function toNode(r: Row): LibraryNode {
    return {
      id: r.id,
      userId: r.user_id,
      parentId: r.parent_id,
      kind: r.kind,
      name: r.name,
      section: r.section,
      course: r.kind === "course" ? { code: r.course_code } : null,
      lecture: r.kind === "lecture" ? { number: r.lecture_number, date: r.lecture_date } : null,
      sortKey: r.sort_key,
      favourite: r.favourite === 1,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      trashedAt: r.trashed_at,
    };
  }

  /** Add path, child count and ancestors. Parents shared by a page are walked once. */
  function decorate(userId: string, rows: Row[]): NodeWithLinks[] {
    const parents = new Map<string | null, ChainRow[]>();
    return rows.map((r) => {
      let above = parents.get(r.parent_id);
      if (!above) {
        above = r.parent_id === null ? [] : chainOf(userId, r.parent_id);
        parents.set(r.parent_id, above);
      }
      const count = (q.childCount.get(r.id, r.trashed_at) as { n: number }).n;
      return {
        ...toNode(r),
        path: [...above.map((a) => a.name), r.name].join(" / "),
        childCount: count,
        ancestors: above.map((a) => a.id),
      };
    });
  }

  const one = (userId: string, r: Row): NodeWithLinks => decorate(userId, [r])[0] as NodeWithLinks;

  // ---- ordering -------------------------------------------------------

  function rebalance(userId: string, parentId: string | null): void {
    const ids = (q.siblingIds.all(userId, parentId) as Array<{ id: string }>).map((r) => r.id);
    for (const id of ids) q.setKey.run(`~${id}`, id);
    const keys = generateNKeysBetween(null, null, ids.length);
    ids.forEach((id, i) => {
      q.setKey.run(keys[i] as string, id);
    });
  }

  /**
   * A sort key for a node placed under `parentId`. `after` undefined means last,
   * null first, otherwise right after that sibling. `exclude` is the node being
   * moved, which must not count as its own neighbour.
   */
  function keyFor(
    userId: string,
    parentId: string | null,
    after: string | null | undefined,
    exclude: string,
  ): string {
    const compute = (): string => {
      if (after === undefined) {
        const last = (q.maxKey.get(userId, parentId, exclude) as { k: string | null }).k;
        return generateKeyBetween(last, null);
      }
      if (after === null) {
        const first = (q.minKey.get(userId, parentId, exclude) as { k: string | null }).k;
        return generateKeyBetween(null, first);
      }
      const anchor = row(userId, after);
      if (!anchor || anchor.parent_id !== parentId || anchor.id === exclude || anchor.trashed_at) {
        throw new AppError(
          "invalid_input",
          "afterId must be a sibling in the destination, other than the item being moved.",
          {
            hint: "Use the id of an item already inside the destination parent, or null to place first, or omit afterId to place last.",
            example: { parentId, afterId: null } satisfies MoveNodeInput,
          },
        );
      }
      const next = (
        q.nextKey.get(userId, parentId, anchor.sort_key, exclude) as { k: string | null }
      ).k;
      return generateKeyBetween(anchor.sort_key, next);
    };
    let key = compute();
    if (key.length > MAX_KEY_LENGTH) {
      rebalance(userId, parentId);
      key = compute();
    }
    return key;
  }

  // ---- placement rules ------------------------------------------------

  function folderCount(chain: ChainRow[]): number {
    return chain.filter((c) => c.kind === "folder").length;
  }

  function sectionIdOf(chain: ChainRow[]): string | null {
    return chain.find((c) => c.kind === "section")?.id ?? null;
  }

  function checkPlacement(
    op: "create" | "move",
    userId: string,
    kind: NodeKind,
    parent: Row | null,
    folderChain: number,
  ): void {
    if (!canContain(parent?.kind ?? null, kind)) {
      throw misplaced(op, kind, parent?.kind ?? null);
    }
    if (parent) {
      const chain = chainOf(userId, parent.id);
      if (folderCount(chain) + folderChain > MAX_FOLDER_DEPTH) {
        throw tooDeep(op, kind, sectionIdOf(chain));
      }
    }
  }

  /** Longest run of folders on any path inside the subtree, counting its root. */
  function folderChainIn(rows: Row[], rootId: string): number {
    const children = new Map<string | null, Row[]>();
    for (const r of rows) {
      const list = children.get(r.parent_id) ?? [];
      list.push(r);
      children.set(r.parent_id, list);
    }
    const walk = (id: string, kind: NodeKind): number => {
      let deepest = 0;
      for (const child of children.get(id) ?? []) {
        deepest = Math.max(deepest, walk(child.id, child.kind));
      }
      return deepest + (kind === "folder" ? 1 : 0);
    };
    const root = rows.find((r) => r.id === rootId) as Row;
    return walk(root.id, root.kind);
  }

  // ---- reads ----------------------------------------------------------

  function list(
    userId: string,
    opts: ListOptions & { parentId?: string | null | undefined } = {},
  ): Page<NodeWithLinks> {
    const parentId = opts.parentId ?? null;
    if (parentId !== null) need(userId, parentId);
    const limit = opts.limit ?? DEFAULT_LIMIT;
    const after = opts.cursor
      ? decodeCursor(opts.cursor, (v): v is { k: string } => isObject(v) && typeof v.k === "string")
          .k
      : "";
    const rows = db
      .prepare(
        `SELECT * FROM nodes
         WHERE user_id = ? AND parent_id IS ? AND trashed_at IS NULL AND sort_key > ?
         ORDER BY sort_key LIMIT ?`,
      )
      .all(userId, parentId, after, limit + 1) as Row[];
    return paged(userId, rows, limit, (last) => ({ k: last.sort_key }));
  }

  function paged(
    userId: string,
    rows: Row[],
    limit: number,
    cursorOf: (last: Row) => unknown,
  ): Page<NodeWithLinks> {
    const more = rows.length > limit;
    const slice = more ? rows.slice(0, limit) : rows;
    const last = slice[slice.length - 1];
    return {
      items: decorate(userId, slice),
      nextCursor: more && last ? encodeCursor(cursorOf(last)) : null,
    };
  }

  function get(userId: string, id: string): NodeWithLinks {
    return one(userId, need(userId, id));
  }

  function markOpened(userId: string, id: string): void {
    const r = need(userId, id);
    if (r.trashed_at !== null) return;
    db.prepare("UPDATE nodes SET opened_at = ? WHERE id = ?").run(stamp(), id);
  }

  function listTrash(userId: string, opts: ListOptions = {}): Page<NodeWithLinks> {
    const limit = opts.limit ?? DEFAULT_LIMIT;
    const c = opts.cursor
      ? decodeCursor(
          opts.cursor,
          (v): v is { t: string; i: string } =>
            isObject(v) && typeof v.t === "string" && typeof v.i === "string",
        )
      : null;
    const rows = db
      .prepare(
        `SELECT n.* FROM nodes n
         WHERE n.user_id = @user AND n.trashed_at IS NOT NULL
           AND (n.parent_id IS NULL OR NOT EXISTS (
             SELECT 1 FROM nodes p WHERE p.id = n.parent_id AND p.trashed_at IS NOT NULL))
           AND (@t IS NULL OR n.trashed_at < @t OR (n.trashed_at = @t AND n.id < @i))
         ORDER BY n.trashed_at DESC, n.id DESC LIMIT @limit`,
      )
      .all({ user: userId, t: c?.t ?? null, i: c?.i ?? null, limit: limit + 1 }) as Row[];
    return paged(userId, rows, limit, (last) => ({ t: last.trashed_at, i: last.id }));
  }

  function recents(userId: string, opts: { limit?: number | undefined } = {}): Page<NodeWithLinks> {
    const rows = db
      .prepare(
        `SELECT * FROM nodes
         WHERE user_id = ? AND trashed_at IS NULL AND kind != 'section'
         ORDER BY MAX(COALESCE(opened_at, ''), updated_at) DESC, id DESC LIMIT ?`,
      )
      .all(userId, opts.limit ?? 20) as Row[];
    return { items: decorate(userId, rows), nextCursor: null };
  }

  function favourites(userId: string): Page<NodeWithLinks> {
    const rows = db
      .prepare(
        `SELECT * FROM nodes WHERE user_id = ? AND favourite = 1 AND trashed_at IS NULL
         ORDER BY updated_at DESC, id DESC`,
      )
      .all(userId) as Row[];
    return { items: decorate(userId, rows), nextCursor: null };
  }

  /** Turn free text into a safe FTS5 query: every word a quoted prefix term. */
  function ftsQuery(text: string): string | null {
    const words = text.match(/[\p{L}\p{N}]+/gu)?.slice(0, 12) ?? [];
    return words.length === 0 ? null : words.map((w) => `"${w}"*`).join(" ");
  }

  function search(userId: string, opts: ListOptions & { q: string }): Page<SearchHit> {
    const limit = opts.limit ?? DEFAULT_LIMIT;
    const match = ftsQuery(opts.q);
    if (match === null) return { items: [], nextCursor: null };
    const offset =
      opts.offset ??
      (opts.cursor
        ? decodeCursor(opts.cursor, (v): v is { o: number } => isObject(v) && Number.isInteger(v.o))
            .o
        : 0);
    const rows = db
      .prepare(
        `SELECT n.*, snippet(nodes_fts, 0, '', '', '…', 12) AS snippet
         FROM nodes_fts JOIN nodes n ON n.seq = nodes_fts.rowid
         WHERE nodes_fts MATCH ? AND n.user_id = ? AND n.trashed_at IS NULL AND n.kind != 'section'
         ORDER BY nodes_fts.rank, n.id LIMIT ? OFFSET ?`,
      )
      .all(match, userId, limit + 1, offset) as Array<Row & { snippet: string }>;
    const more = rows.length > limit;
    const slice = more ? rows.slice(0, limit) : rows;
    const nodes = decorate(userId, slice);
    return {
      items: nodes.map((node, i) => ({
        kind: "node" as const,
        node,
        snippet: (slice[i] as Row & { snippet: string }).snippet,
      })),
      nextCursor: more ? encodeCursor({ o: offset + limit }) : null,
    };
  }

  // ---- writes ---------------------------------------------------------

  function insertNode(r: Omit<Row, "seq" | "trashed_at" | "opened_at">): void {
    q.insert.run(r);
  }

  function create(userId: string, input: CreateNodeInput, by?: Actor): NodeWithLinks {
    const actor = by ?? userActor(userId);
    return db.transaction(() => {
      if ((input.kind as NodeKind) === "section") throw sectionRefused("created by hand");
      const parent = input.parentId === null ? null : needLive(userId, input.parentId, "added to");
      checkPlacement("create", userId, input.kind, parent, input.kind === "folder" ? 1 : 0);
      if (input.course !== undefined && input.kind !== "course") {
        throw new AppError("invalid_input", "course details only apply to a course.", {
          hint: "Remove the course field, or set kind to course.",
          example: {
            parentId: EXAMPLE_ID,
            kind: "course",
            name: "Pharmacology II",
            course: { code: "PHAR 7340" },
          },
        });
      }
      if (input.lecture !== undefined && input.kind !== "lecture") {
        throw new AppError("invalid_input", "lecture details only apply to a lecture.", {
          hint: "Remove the lecture field, or set kind to lecture.",
          example: {
            parentId: EXAMPLE_ID,
            kind: "lecture",
            name: "Beta blockers",
            lecture: { number: 7, date: "2026-10-14" },
          },
        });
      }
      const now = stamp();
      const id = newId("node");
      insertNode({
        id,
        user_id: userId,
        parent_id: parent?.id ?? null,
        kind: input.kind,
        name: input.name,
        section: null,
        course_code: input.kind === "course" ? (input.course?.code ?? null) : null,
        lecture_number: input.kind === "lecture" ? (input.lecture?.number ?? null) : null,
        lecture_date: input.kind === "lecture" ? (input.lecture?.date ?? null) : null,
        sort_key: keyFor(userId, parent?.id ?? null, undefined, id),
        favourite: 0,
        created_at: now,
        updated_at: now,
      });
      if (input.kind === "course") {
        const keys = generateNKeysBetween(null, null, COURSE_SECTIONS.length);
        COURSE_SECTIONS.forEach((s, i) => {
          insertNode({
            id: newId("node"),
            user_id: userId,
            parent_id: id,
            kind: "section",
            name: s.name,
            section: s.section,
            course_code: null,
            lecture_number: null,
            lecture_date: null,
            sort_key: keys[i] as string,
            favourite: 0,
            created_at: now,
            updated_at: now,
          });
        });
      }
      const created = need(userId, id);
      note(userId, actor, {
        action: "created",
        summary: `Created ${label(created)}`,
        node: created,
      });
      return one(userId, created);
    })();
  }

  function update(userId: string, id: string, input: UpdateNodeInput, by?: Actor): NodeWithLinks {
    const actor = by ?? userActor(userId);
    return db.transaction(() => {
      const r = needLive(userId, id, "changed");
      if (isFixed(r.kind)) throw sectionRefused("renamed or changed");
      if (Object.keys(input).length === 0) {
        throw new AppError("invalid_input", "Nothing to change.", {
          hint: "Send at least one of name, course, lecture or favourite.",
          example: { name: "New name" } satisfies UpdateNodeInput,
        });
      }
      if (input.course !== undefined && r.kind !== "course") {
        throw new AppError("invalid_input", `A ${r.kind} has no course details.`, {
          hint: "Only a course takes the course field.",
          example: { name: "New name" } satisfies UpdateNodeInput,
        });
      }
      if (input.lecture !== undefined && r.kind !== "lecture") {
        throw new AppError("invalid_input", `A ${r.kind} has no lecture details.`, {
          hint: "Only a lecture takes the lecture field.",
          example: { name: "New name" } satisfies UpdateNodeInput,
        });
      }
      db.prepare(
        `UPDATE nodes SET name = ?, course_code = ?, lecture_number = ?, lecture_date = ?,
           favourite = ?, updated_at = ? WHERE id = ?`,
      ).run(
        input.name ?? r.name,
        input.course ? input.course.code : r.course_code,
        input.lecture ? input.lecture.number : r.lecture_number,
        input.lecture ? input.lecture.date : r.lecture_date,
        input.favourite === undefined ? r.favourite : input.favourite ? 1 : 0,
        stamp(),
        id,
      );
      const after = need(userId, id);
      const parts: string[] = [];
      if (input.name !== undefined && input.name !== r.name) {
        parts.push(`Renamed ${label(r)} to "${after.name}"`);
      }
      if (input.favourite !== undefined && (input.favourite ? 1 : 0) !== r.favourite) {
        parts.push(
          input.favourite
            ? `Marked ${label(after)} as a favourite`
            : `Removed ${label(after)} from favourites`,
        );
      }
      if (parts.length === 0) parts.push(`Changed the details of ${label(after)}`);
      note(userId, actor, { action: "updated", summary: parts.join("; "), node: after });
      return one(userId, after);
    })();
  }

  function move(userId: string, id: string, input: MoveNodeInput, by?: Actor): NodeWithLinks {
    const actor = by ?? userActor(userId);
    return db.transaction(() => {
      const r = needLive(userId, id, "moved");
      if (isFixed(r.kind)) throw sectionRefused("moved");
      const parent =
        input.parentId === null ? null : needLive(userId, input.parentId, "moved into");
      if (parent && chainOf(userId, parent.id).some((c) => c.id === id)) {
        throw new AppError(
          "invalid_input",
          "An item cannot be moved into itself or inside its own contents.",
          {
            hint: "Pick a destination outside this item.",
            example: { parentId: r.parent_id, afterId: null } satisfies MoveNodeInput,
          },
        );
      }
      const subtree = q.subtree.all(id, userId) as Row[];
      checkPlacement("move", userId, r.kind, parent, folderChainIn(subtree, id));
      const key = keyFor(userId, parent?.id ?? null, input.afterId, id);
      db.prepare("UPDATE nodes SET parent_id = ?, sort_key = ?, updated_at = ? WHERE id = ?").run(
        parent?.id ?? null,
        key,
        stamp(),
        id,
      );
      const moved = need(userId, id);
      const place = parent ? `into ${label(parent)}` : "to the top level";
      note(userId, actor, {
        action: "moved",
        summary:
          parent?.id === r.parent_id
            ? `Reordered ${label(moved)}`
            : `Moved ${label(moved)} ${place}`,
        node: moved,
      });
      return one(userId, moved);
    })();
  }

  function duplicate(userId: string, id: string, by?: Actor): NodeWithLinks {
    const actor = by ?? userActor(userId);
    return db.transaction(() => {
      const original = needLive(userId, id, "duplicated");
      if (isFixed(original.kind)) throw sectionRefused("duplicated");
      const live = (q.subtree.all(id, userId) as Row[]).filter((r) => r.trashed_at === null);
      const children = new Map<string, Row[]>();
      for (const r of live) {
        if (r.id === id) continue;
        const list = children.get(r.parent_id as string) ?? [];
        list.push(r);
        children.set(r.parent_id as string, list);
      }
      const now = stamp();
      const next = (
        q.nextKey.get(userId, original.parent_id, original.sort_key, id) as { k: string | null }
      ).k;
      let rootKey = generateKeyBetween(original.sort_key, next);
      if (rootKey.length > MAX_KEY_LENGTH) {
        rebalance(userId, original.parent_id);
        const fresh = need(userId, id);
        const after = (
          q.nextKey.get(userId, original.parent_id, fresh.sort_key, id) as { k: string | null }
        ).k;
        rootKey = generateKeyBetween(fresh.sort_key, after);
      }
      const copyId = newId("node");
      const suffix = " copy";
      const copyName = `${original.name.slice(0, MAX_NAME_LENGTH - suffix.length)}${suffix}`;
      const pairs: Array<{ fromId: string; toId: string }> = [];
      const copyOf = (src: Row, newParent: string | null, key: string, copy: string): void => {
        pairs.push({ fromId: src.id, toId: copy });
        insertNode({
          id: copy,
          user_id: userId,
          parent_id: newParent,
          kind: src.kind,
          name: src.id === id ? copyName : src.name,
          section: src.section,
          course_code: src.course_code,
          lecture_number: src.lecture_number,
          lecture_date: src.lecture_date,
          sort_key: key,
          favourite: 0,
          created_at: now,
          updated_at: src.id === id ? now : src.updated_at,
        });
        for (const child of children.get(src.id) ?? []) {
          copyOf(child, copy, child.sort_key, newId("node"));
        }
      };
      copyOf(original, original.parent_id, rootKey, copyId);
      const copy = need(userId, copyId);
      note(userId, actor, {
        action: "duplicated",
        summary: `Duplicated ${label(original)}${pairs.length > 1 ? ` with ${pairs.length - 1} items inside` : ""}`,
        node: copy,
        objectIds: [copy.id, original.id],
      });
      listener.duplicated?.({ userId, actor, pairs });
      return one(userId, copy);
    })();
  }

  function trash(userId: string, id: string, by?: Actor): NodeWithLinks {
    const actor = by ?? userActor(userId);
    return db.transaction(() => {
      const r = need(userId, id);
      if (isFixed(r.kind)) throw sectionRefused("trashed");
      if (r.trashed_at !== null) {
        throw new AppError("conflict", "This item is already in the trash.", {
          hint: `Restore it with POST /api/nodes/${id}/restore, or delete it for good with DELETE /api/nodes/${id}.`,
          example: call("POST", `/api/nodes/${id}/restore`),
        });
      }
      const now = stamp();
      const ids = (q.subtree.all(id, userId) as Row[])
        .filter((s) => s.trashed_at === null)
        .map((s) => s.id);
      const mark = db.prepare("UPDATE nodes SET trashed_at = ? WHERE id = ?");
      for (const nodeId of ids) mark.run(now, nodeId);
      db.prepare("UPDATE nodes SET updated_at = ? WHERE id = ?").run(now, id);
      const trashed = need(userId, id);
      note(userId, actor, {
        action: "trashed",
        summary: `Moved ${label(trashed)} to the trash${ids.length > 1 ? ` with ${ids.length - 1} items inside` : ""}`,
        node: trashed,
      });
      listener.trashed?.({ userId, actor, nodeIds: ids });
      return one(userId, trashed);
    })();
  }

  function restore(userId: string, id: string, by?: Actor): NodeWithLinks {
    const actor = by ?? userActor(userId);
    return db.transaction(() => {
      const r = need(userId, id);
      if (isFixed(r.kind)) throw sectionRefused("restored on its own");
      if (r.trashed_at === null) {
        throw new AppError("conflict", "This item is not in the trash.", {
          hint: "Only items in the trash can be restored. List them with GET /api/trash.",
          example: call("GET", "/api/trash"),
        });
      }
      if (r.parent_id !== null) {
        const parent = need(userId, r.parent_id);
        if (parent.trashed_at !== null) {
          throw new AppError("conflict", `Its parent "${parent.name}" is still in the trash.`, {
            hint: `Restore the parent first with POST /api/nodes/${parent.id}/restore, then restore this item.`,
            example: call("POST", `/api/nodes/${parent.id}/restore`),
          });
        }
      }
      const unmark = db.prepare("UPDATE nodes SET trashed_at = NULL WHERE id = ?");
      const restored: string[] = [];
      for (const s of q.subtree.all(id, userId) as Row[]) {
        if (s.trashed_at === r.trashed_at) {
          unmark.run(s.id);
          restored.push(s.id);
        }
      }
      db.prepare("UPDATE nodes SET updated_at = ? WHERE id = ?").run(stamp(), id);
      const back = need(userId, id);
      note(userId, actor, {
        action: "restored",
        summary: `Restored ${label(back)} from the trash${restored.length > 1 ? ` with ${restored.length - 1} items inside` : ""}`,
        node: back,
      });
      listener.restored?.({ userId, actor, nodeIds: restored });
      return one(userId, back);
    })();
  }

  /** Permanently delete a node and everything under it. Only from the trash. */
  function permanentDelete(userId: string, id: string, by?: Actor): void {
    const actor = by ?? userActor(userId);
    db.transaction(() => {
      const r = need(userId, id);
      if (isFixed(r.kind)) throw sectionRefused("deleted on its own");
      if (r.trashed_at === null) {
        throw new AppError("conflict", "Only items in the trash can be deleted for good.", {
          hint: `Move it to the trash first with POST /api/nodes/${id}/trash.`,
          example: call("POST", `/api/nodes/${id}/trash`),
        });
      }
      const nodeIds = (q.subtree.all(id, userId) as Row[]).map((s) => s.id);
      // Before the rows go, so listeners can still read what hangs off them.
      listener.deleted?.({ userId, actor, nodeIds });
      db.prepare("DELETE FROM nodes WHERE id = ? AND user_id = ?").run(id, userId);
      note(userId, actor, {
        action: "deleted",
        summary: `Deleted ${label(r)} for good${nodeIds.length > 1 ? ` with ${nodeIds.length - 1} items inside` : ""}`,
        node: r,
        objectIds: nodeIds,
      });
    })();
  }

  return {
    list,
    get,
    create,
    update,
    move,
    duplicate,
    trash,
    restore,
    permanentDelete,
    listTrash,
    recents,
    favourites,
    search,
    markOpened,
  };
}

export type LibraryService = ReturnType<typeof createLibraryService>;
