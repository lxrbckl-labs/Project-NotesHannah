import { canContain, MAX_FOLDER_DEPTH, type NodeKind, newId } from "@notes/schema";
import { describe, expect, it } from "vitest";
import { createTestDatabase, type Db } from "../src/db/client.js";
import { createLibraryService } from "../src/domains/library/index.js";
import { AppError } from "../src/http/errors.js";

/** Small seeded generator so a failure can be replayed. */
function prng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Row {
  id: string;
  user_id: string;
  parent_id: string | null;
  kind: NodeKind;
  sort_key: string;
  trashed_at: string | null;
}

function checkInvariants(db: Db, label: string): void {
  const rows = db
    .prepare("SELECT id, user_id, parent_id, kind, sort_key, trashed_at FROM nodes")
    .all() as Row[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const seenKeys = new Set<string>();
  for (const r of rows) {
    const where = `${label}: ${r.kind} ${r.id}`;
    const parent = r.parent_id === null ? null : byId.get(r.parent_id);
    if (r.parent_id !== null) {
      expect(parent, `${where} has a parent`).toBeDefined();
      expect(parent?.user_id, `${where} parent belongs to the same user`).toBe(r.user_id);
      // a live node never sits under a trashed one
      if (r.trashed_at === null) expect(parent?.trashed_at, `${where} live under live`).toBeNull();
    }
    expect(canContain(parent?.kind ?? null, r.kind), `${where} placement`).toBe(true);

    // walk up: no cycles, bounded folder depth
    const visited = new Set<string>([r.id]);
    let folders = r.kind === "folder" ? 1 : 0;
    for (let up = parent; up; up = up.parent_id === null ? undefined : byId.get(up.parent_id)) {
      expect(visited.has(up.id), `${where} cycle`).toBe(false);
      visited.add(up.id);
      if (up.kind === "folder") folders++;
    }
    expect(folders, `${where} folder depth`).toBeLessThanOrEqual(MAX_FOLDER_DEPTH);

    const key = `${r.user_id}|${r.parent_id ?? ""}|${r.sort_key}`;
    expect(seenKeys.has(key), `${where} duplicate sort key`).toBe(false);
    seenKeys.add(key);
    expect(r.sort_key.length).toBeLessThanOrEqual(64);
  }
  // every course still has its five sections, in the fixed order
  for (const course of rows.filter((r) => r.kind === "course")) {
    const sections = db
      .prepare("SELECT section FROM nodes WHERE parent_id = ? ORDER BY sort_key")
      .all(course.id) as Array<{ section: string }>;
    expect(sections.map((s) => s.section)).toEqual([
      "sources",
      "lectures",
      "study_guides",
      "practice",
      "exams",
    ]);
  }
  // the search index matches the table
  const ftsCount = db.prepare("SELECT COUNT(*) AS n FROM nodes_fts").get() as { n: number };
  expect(ftsCount.n).toBe(rows.length);
}

const KINDS: NodeKind[] = ["term", "course", "folder", "lecture", "document"];

describe("library invariants under random operations", () => {
  for (const seed of [1, 2, 3]) {
    it(`holds after hundreds of random operations (seed ${seed})`, () => {
      const db = createTestDatabase();
      const lib = createLibraryService(db);
      const users = [newId("user"), newId("user")];
      const rnd = prng(seed);
      const pick = <T>(list: T[]): T | undefined => list[Math.floor(rnd() * list.length)];
      let succeeded = 0;
      const stats: Record<string, number> = {};

      const ids = (user: string, where = "1=1") =>
        (
          db
            .prepare(`SELECT id, kind, trashed_at FROM nodes WHERE user_id = ? AND ${where}`)
            .all(user) as Array<{ id: string; kind: NodeKind; trashed_at: string | null }>
        ).map((r) => r);

      for (let step = 0; step < 400; step++) {
        const user = pick(users) as string;
        const all = ids(user);
        const live = all.filter((n) => n.trashed_at === null);
        const op = pick([
          "create",
          "create",
          "create",
          "create",
          "move",
          "move",
          "move",
          "update",
          "duplicate",
          "trash",
          "trash",
          "restore",
          "delete",
        ]) as string;
        try {
          if (op === "create") {
            const kind = pick(KINDS) as NodeKind;
            const parent = pick(live);
            lib.create(user, {
              parentId: kind === "term" || !parent ? null : parent.id,
              kind: kind as never,
              name: `${kind} ${step}`,
            });
          } else if (op === "move") {
            const node = pick(all);
            const target = pick(live);
            if (!node) continue;
            const siblings = target
              ? (db
                  .prepare("SELECT id FROM nodes WHERE parent_id = ? AND trashed_at IS NULL")
                  .all(target.id) as Array<{ id: string }>)
              : [];
            const after = rnd() < 0.3 ? undefined : rnd() < 0.3 ? null : pick(siblings)?.id;
            lib.move(user, node.id, {
              parentId: rnd() < 0.05 ? null : (target?.id ?? null),
              ...(after === undefined ? {} : { afterId: after }),
            });
          } else if (op === "update") {
            const node = pick(live);
            if (node)
              lib.update(user, node.id, { name: `renamed ${step}`, favourite: rnd() < 0.5 });
          } else if (op === "duplicate") {
            const node = pick(live);
            if (node) lib.duplicate(user, node.id);
          } else if (op === "trash") {
            const node = pick(live);
            if (node) lib.trash(user, node.id);
          } else if (op === "restore") {
            const node = pick(all.filter((n) => n.trashed_at !== null));
            if (node) lib.restore(user, node.id);
          } else if (op === "delete") {
            const node = pick(all.filter((n) => n.trashed_at !== null));
            if (node) lib.permanentDelete(user, node.id);
          } else {
            continue;
          }
          succeeded++;
          stats[op] = (stats[op] ?? 0) + 1;
        } catch (error) {
          // refused operations are fine; anything else is a bug
          expect(error, `step ${step} ${op}`).toBeInstanceOf(AppError);
        }
        if (step % 25 === 0) checkInvariants(db, `seed ${seed} step ${step}`);
      }
      checkInvariants(db, `seed ${seed} end`);
      expect(succeeded).toBeGreaterThan(150);
      for (const op of ["create", "move", "duplicate", "trash", "restore", "delete"]) {
        expect(stats[op] ?? 0, `${op} succeeded at least once`).toBeGreaterThan(0);
      }
      // each user's data is untouched by the other's operations
      for (const user of users) {
        for (const n of ids(user)) {
          expect(() => lib.get(users.find((u) => u !== user) as string, n.id)).toThrow(AppError);
        }
      }
    });
  }
});
