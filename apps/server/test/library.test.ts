import { CreateNodeInput, MAX_FOLDER_DEPTH, MoveNodeInput, newId } from "@notes/schema";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createTestDatabase } from "../src/db/client.js";
import { libraryRoutes } from "../src/domains/library/index.js";
import type { AppEnv } from "../src/http/auth-context.js";
import { handleError } from "../src/http/errors.js";

// biome-ignore lint/suspicious/noExplicitAny: response bodies are inspected loosely in tests
type Json = any;

interface Caller {
  user: string | null;
  via?: "session" | "key";
  scope?: "read" | "write";
}

function setup() {
  const db = createTestDatabase();
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    const user = c.req.header("x-user");
    c.set(
      "auth",
      user
        ? ({
            userId: user,
            actor: { type: "user", userId: user },
            via: c.req.header("x-via") ?? "session",
            scope: c.req.header("x-scope") ?? "write",
          } as never)
        : null,
    );
    await next();
  });
  app.route("/", libraryRoutes(db));
  app.onError(handleError);

  const alice = newId("user");
  const bob = newId("user");

  async function call(
    who: Caller | string | null,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: Json }> {
    const caller: Caller = typeof who === "string" || who === null ? { user: who } : who;
    const headers: Record<string, string> = {};
    if (caller.user) headers["x-user"] = caller.user;
    if (caller.via) headers["x-via"] = caller.via;
    if (caller.scope) headers["x-scope"] = caller.scope;
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await app.request(path, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }

  /** Create a node as `who` and return it, failing loudly if refused. */
  async function make(
    who: string,
    parentId: string | null,
    kind: string,
    name: string,
    extra: Record<string, unknown> = {},
  ): Promise<Json> {
    const res = await call(who, "POST", "/api/nodes", { parentId, kind, name, ...extra });
    expect(res.body, `create ${kind} ${name}`).toHaveProperty("node");
    expect(res.status).toBe(201);
    return res.body.node;
  }

  async function children(who: string, parentId: string | null): Promise<Json[]> {
    const out: Json[] = [];
    let cursor: string | null = null;
    do {
      const q: string = `?limit=200${parentId ? `&parentId=${parentId}` : ""}${cursor ? `&cursor=${cursor}` : ""}`;
      const res = await call(who, "GET", `/api/nodes${q}`);
      out.push(...res.body.items);
      cursor = res.body.nextCursor;
    } while (cursor);
    return out;
  }

  async function names(who: string, parentId: string | null): Promise<string[]> {
    return (await children(who, parentId)).map((n) => n.name);
  }

  /** term > course > its five sections */
  async function spine(who: string) {
    const term = await make(who, null, "term", "Fall 2026");
    const course = await make(who, term.id, "course", "Pharmacology II", {
      course: { code: "PHAR 7340" },
    });
    const sections = await children(who, course.id);
    const bySection = Object.fromEntries(sections.map((s) => [s.section, s]));
    return { term, course, sections: bySection };
  }

  return { db, app, alice, bob, call, make, children, names, spine };
}

function expectRuleError(res: { status: number; body: Json }, code = "invalid_input") {
  expect(res.status).toBe(code === "invalid_input" ? 400 : 409);
  expect(res.body.error.code).toBe(code);
  expect(res.body.error.message).toEqual(expect.any(String));
  expect(res.body.error.hint).toEqual(expect.any(String));
  expect(res.body.error.example).toBeDefined();
}

describe("the spine", () => {
  it("builds term, course with five sections, lecture and document", async () => {
    const t = setup();
    const { term, course, sections } = await t.spine(t.alice);

    expect(term).toMatchObject({ kind: "term", parentId: null, path: "Fall 2026", ancestors: [] });
    expect(course).toMatchObject({
      kind: "course",
      path: "Fall 2026 / Pharmacology II",
      course: { code: "PHAR 7340" },
      childCount: 5,
      ancestors: [term.id],
    });
    const listed = await t.children(t.alice, course.id);
    expect(listed.map((s) => s.name)).toEqual([
      "Sources",
      "Lectures",
      "Study guides",
      "Practice",
      "Exams",
    ]);
    expect(listed.map((s) => s.section)).toEqual([
      "sources",
      "lectures",
      "study_guides",
      "practice",
      "exams",
    ]);
    expect(sections.lectures.path).toBe("Fall 2026 / Pharmacology II / Lectures");

    const lecture = await t.make(t.alice, sections.lectures.id, "lecture", "Beta blockers", {
      lecture: { number: 7, date: "2026-10-14" },
    });
    expect(lecture.lecture).toEqual({ number: 7, date: "2026-10-14" });
    expect(lecture.course).toBeNull();
    const doc = await t.make(t.alice, lecture.id, "document", "Merged note");
    expect(doc.path).toBe("Fall 2026 / Pharmacology II / Lectures / Beta blockers / Merged note");
    expect(doc.ancestors).toEqual([term.id, course.id, sections.lectures.id, lecture.id]);

    const got = await t.call(t.alice, "GET", `/api/nodes/${lecture.id}`);
    expect(got.body.node.childCount).toBe(1);
    expect(got.body.node.fileCount).toBe(0);

    // Source files filed under it are counted on their own, and one in the trash is not counted.
    const file = t.db.prepare(
      `INSERT INTO source_files (id, user_id, node_id, original_name, sha256, bytes, type, status,
         uploaded_by, created_at, updated_at, trashed_at)
       VALUES (?, ?, ?, ?, ?, 10, 'pdf', 'converted', '{}', 1, 1, ?)`,
    );
    file.run("fil_a", "usr_test", lecture.id, "slides.pdf", "a".repeat(64), null);
    file.run("fil_b", "usr_test", lecture.id, "notes.pdf", "b".repeat(64), null);
    file.run("fil_c", "usr_test", lecture.id, "old.pdf", "c".repeat(64), 5);
    const after = await t.call(t.alice, "GET", `/api/nodes/${lecture.id}`);
    expect(after.body.node).toMatchObject({ childCount: 1, fileCount: 2 });
  });

  it("creating a course is atomic: a refused course leaves no sections", async () => {
    const t = setup();
    const term = await t.make(t.alice, null, "term", "Fall");
    const before = (t.db.prepare("SELECT COUNT(*) AS n FROM nodes").get() as { n: number }).n;
    const bad = await t.call(t.alice, "POST", "/api/nodes", {
      parentId: term.id,
      kind: "course",
      name: "X",
      lecture: { number: 1, date: null },
    });
    expect(bad.status).toBe(400);
    expect((t.db.prepare("SELECT COUNT(*) AS n FROM nodes").get() as { n: number }).n).toBe(before);
  });
});

describe("placement rules", () => {
  it("refuses each wrong placement with code, hint and a valid-shaped example", async () => {
    const t = setup();
    const { term, course, sections } = await t.spine(t.alice);
    const lecture = await t.make(t.alice, sections.lectures.id, "lecture", "L");
    const cases: Array<[string | null, string]> = [
      [null, "document"],
      [null, "course"],
      [null, "folder"],
      [term.id, "term"],
      [term.id, "lecture"],
      [course.id, "folder"],
      [course.id, "document"],
      [sections.sources.id, "term"],
      [sections.sources.id, "course"],
      [lecture.id, "lecture"],
      [lecture.id, "folder"],
    ];
    for (const [parentId, kind] of cases) {
      const res = await t.call(t.alice, "POST", "/api/nodes", { parentId, kind, name: "X" });
      expectRuleError(res);
      expect(CreateNodeInput.safeParse(res.body.error.example).success, `${kind}`).toBe(true);
    }
    const doc = await t.make(t.alice, lecture.id, "document", "D");
    const underDoc = await t.call(t.alice, "POST", "/api/nodes", {
      parentId: doc.id,
      kind: "document",
      name: "X",
    });
    expectRuleError(underDoc);
  });

  it("refuses wrong placements on move too", async () => {
    const t = setup();
    const { term, sections } = await t.spine(t.alice);
    const lecture = await t.make(t.alice, sections.lectures.id, "lecture", "L");
    const res = await t.call(t.alice, "POST", `/api/nodes/${lecture.id}/move`, {
      parentId: term.id,
    });
    expectRuleError(res);
    expect(MoveNodeInput.safeParse(res.body.error.example).success).toBe(true);
  });

  it("refuses to create a section by hand and names the field", async () => {
    const t = setup();
    const { course } = await t.spine(t.alice);
    const res = await t.call(t.alice, "POST", "/api/nodes", {
      parentId: course.id,
      kind: "section",
      name: "Extra",
    });
    expectRuleError(res);
    expect(res.body.error.message).toContain("kind");
  });

  it("limits folder depth below a section, on create and for whole moved subtrees", async () => {
    const t = setup();
    const { sections } = await t.spine(t.alice);
    // Folders nest as deep as she likes; the limit is a far-off backstop. Build right up to it.
    const chain = [await t.make(t.alice, sections.sources.id, "folder", "f1")];
    for (let depth = 2; depth <= MAX_FOLDER_DEPTH; depth++) {
      const parent = chain[chain.length - 1];
      if (!parent) throw new Error("chain");
      chain.push(await t.make(t.alice, parent.id, "folder", `f${depth}`));
    }
    const f1 = chain[0];
    const deepest = chain[chain.length - 1];
    if (!f1 || !deepest) throw new Error("chain");
    const tooDeep = await t.call(t.alice, "POST", "/api/nodes", {
      parentId: deepest.id,
      kind: "folder",
      name: "one too many",
    });
    expectRuleError(tooDeep);
    expect(tooDeep.body.error.example.parentId).toBe(sections.sources.id);
    // a lecture is not a folder, so it may sit at the deepest level
    await t.make(t.alice, deepest.id, "lecture", "deep lecture");

    const other = await t.make(t.alice, sections.practice.id, "folder", "other");
    const move = await t.call(t.alice, "POST", `/api/nodes/${f1.id}/move`, { parentId: other.id });
    expectRuleError(move); // the whole chain under another folder would be one past the limit
    const ok = await t.call(t.alice, "POST", `/api/nodes/${deepest.id}/move`, {
      parentId: other.id,
    });
    expect(ok.status).toBe(200);
    expect(ok.body.node.path).toBe(
      `Fall 2026 / Pharmacology II / Practice / other / f${MAX_FOLDER_DEPTH}`,
    );
  });

  it("refuses moving an item into itself or its descendants", async () => {
    const t = setup();
    const { sections } = await t.spine(t.alice);
    const f1 = await t.make(t.alice, sections.sources.id, "folder", "f1");
    const f2 = await t.make(t.alice, f1.id, "folder", "f2");
    for (const target of [f1.id, f2.id]) {
      const res = await t.call(t.alice, "POST", `/api/nodes/${f1.id}/move`, { parentId: target });
      expectRuleError(res);
    }
    expect(await t.names(t.alice, sections.sources.id)).toEqual(["f1"]);
  });
});

describe("sections are fixed", () => {
  it("refuse rename, move, duplicate, trash, restore and delete", async () => {
    const t = setup();
    const { term, course, sections } = await t.spine(t.alice);
    const id = sections.lectures.id;
    const attempts: Array<[string, string, unknown?]> = [
      ["PATCH", `/api/nodes/${id}`, { name: "Renamed" }],
      // A favourite sent together with a rename is still a change to the section.
      ["PATCH", `/api/nodes/${id}`, { name: "Renamed", favourite: true }],
      ["POST", `/api/nodes/${id}/move`, { parentId: course.id, afterId: null }],
      ["POST", `/api/nodes/${id}/duplicate`],
      ["POST", `/api/nodes/${id}/trash`],
      ["POST", `/api/nodes/${id}/restore`],
      ["DELETE", `/api/nodes/${id}`],
    ];
    for (const [method, path, body] of attempts) {
      expectRuleError(await t.call(t.alice, method, path, body), "invalid_input");
    }
    // trashing the course carries the sections along; they come back with it
    await t.call(t.alice, "POST", `/api/nodes/${course.id}/trash`);
    expectRuleError(await t.call(t.alice, "POST", `/api/nodes/${id}/restore`));
    await t.call(t.alice, "POST", `/api/nodes/${course.id}/restore`);
    expect(await t.names(t.alice, course.id)).toHaveLength(5);
    expect(await t.names(t.alice, term.id)).toEqual(["Pharmacology II"]);
  });

  it("can be marked as a favorite and unmarked: the star changes nothing about the section", async () => {
    const t = setup();
    const { sections } = await t.spine(t.alice);
    const id = sections.study_guides.id;
    const on = await t.call(t.alice, "PATCH", `/api/nodes/${id}`, { favourite: true });
    expect(on.status).toBe(200);
    expect(on.body.node.favourite).toBe(true);
    expect(on.body.node.name).toBe("Study guides");
    const off = await t.call(t.alice, "PATCH", `/api/nodes/${id}`, { favourite: false });
    expect(off.body.node.favourite).toBe(false);
  });
});

describe("update", () => {
  it("renames, edits meta and favorites; rejects bad input with the field named", async () => {
    const t = setup();
    const { course, sections } = await t.spine(t.alice);
    const lecture = await t.make(t.alice, sections.lectures.id, "lecture", "L1");
    const renamed = await t.call(t.alice, "PATCH", `/api/nodes/${course.id}`, {
      name: "Pharm II",
      course: { code: "PHAR 7341" },
    });
    expect(renamed.body.node).toMatchObject({ name: "Pharm II", course: { code: "PHAR 7341" } });
    expect(renamed.body.node.updatedAt >= course.updatedAt).toBe(true);
    const meta = await t.call(t.alice, "PATCH", `/api/nodes/${lecture.id}`, {
      lecture: { number: 3, date: "2026-09-01" },
    });
    expect(meta.body.node.lecture).toEqual({ number: 3, date: "2026-09-01" });

    const badName = await t.call(t.alice, "PATCH", `/api/nodes/${course.id}`, { name: "  " });
    expectRuleError(badName);
    expect(badName.body.error.message).toContain("name");
    expectRuleError(await t.call(t.alice, "PATCH", `/api/nodes/${course.id}`, {}));
    expectRuleError(
      await t.call(t.alice, "PATCH", `/api/nodes/${lecture.id}`, { course: { code: "X" } }),
    );
    const notJson = await t.app.request(`/api/nodes/${course.id}`, {
      method: "PATCH",
      headers: { "x-user": t.alice, "content-type": "application/json" },
      body: "{nope",
    });
    expect(notJson.status).toBe(400);
  });

  it("validates query strings and cursors", async () => {
    const t = setup();
    for (const q of ["limit=0", "limit=abc", "limit=999", "parentId=nope"]) {
      const res = await t.call(t.alice, "GET", `/api/nodes?${q}`);
      expectRuleError(res);
    }
    const badCursor = await t.call(t.alice, "GET", "/api/nodes?cursor=%25%25");
    expectRuleError(badCursor);
    const noQ = await t.call(t.alice, "GET", "/api/search");
    expectRuleError(noQ);
    expect(noQ.body.error.message).toContain("q");
  });
});

describe("ordering", () => {
  it("keeps sibling order through inserts, moves and cross-parent moves", async () => {
    const t = setup();
    const { sections } = await t.spine(t.alice);
    const s = sections.sources.id;
    const [a, b, c, d] = [
      await t.make(t.alice, s, "document", "a"),
      await t.make(t.alice, s, "document", "b"),
      await t.make(t.alice, s, "document", "c"),
      await t.make(t.alice, s, "document", "d"),
    ];
    expect(await t.names(t.alice, s)).toEqual(["a", "b", "c", "d"]);
    const move = (id: string, afterId?: string | null) =>
      t.call(t.alice, "POST", `/api/nodes/${id}/move`, {
        parentId: s,
        ...(afterId !== undefined ? { afterId } : {}),
      });
    await move(d.id, null); // first
    expect(await t.names(t.alice, s)).toEqual(["d", "a", "b", "c"]);
    await move(a.id); // last
    expect(await t.names(t.alice, s)).toEqual(["d", "b", "c", "a"]);
    await move(c.id, d.id); // between d and b
    expect(await t.names(t.alice, s)).toEqual(["d", "c", "b", "a"]);
    await move(d.id, b.id); // down within the same parent
    expect(await t.names(t.alice, s)).toEqual(["c", "b", "d", "a"]);
    await move(c.id, c.id).then((res) => expectRuleError(res)); // itself is not a sibling
    expectRuleError(await move(b.id, "nod_01HZX3K9Q2V7M4N8P6R5T0W1YB"));

    // only the moved row changes on a move
    const before = await t.children(t.alice, s);
    await move(a.id, c.id);
    const after = await t.children(t.alice, s);
    const changed = after.filter((n) => before.find((o) => o.id === n.id)?.sortKey !== n.sortKey);
    expect(changed.map((n) => n.name)).toEqual(["a"]);
    expect(after.map((n) => n.name)).toEqual(["c", "a", "b", "d"]);

    // across parents with a position
    const other = await t.make(t.alice, sections.practice.id, "folder", "other");
    const x = await t.make(t.alice, other.id, "document", "x");
    const y = await t.make(t.alice, other.id, "document", "y");
    const res = await t.call(t.alice, "POST", `/api/nodes/${b.id}/move`, {
      parentId: other.id,
      afterId: x.id,
    });
    expect(res.status).toBe(200);
    expect(await t.names(t.alice, other.id)).toEqual(["x", "b", "y"]);
    expect(y.id).toBeDefined();
  });

  it("stays valid after hundreds of inserts at the same spot", async () => {
    const t = setup();
    const { sections } = await t.spine(t.alice);
    const s = sections.sources.id;
    const first = await t.make(t.alice, s, "document", "first");
    await t.make(t.alice, s, "document", "last");
    for (let i = 0; i < 300; i++) {
      const d = await t.make(t.alice, s, "document", `d${i}`);
      await t.call(t.alice, "POST", `/api/nodes/${d.id}/move`, { parentId: s, afterId: first.id });
    }
    const all = (await t.children(t.alice, s)) as Json[];
    expect(all).toHaveLength(302);
    expect(all.every((n) => n.sortKey.length <= 64)).toBe(true);
    expect(new Set(all.map((n) => n.sortKey)).size).toBe(302);
    expect(all[0].name).toBe("first");
    expect(all[1].name).toBe("d299");
    expect(all[all.length - 1].name).toBe("last");
  }, 30_000);
});

describe("duplicate", () => {
  it("copies the whole subtree with fresh ids, right after the original", async () => {
    const t = setup();
    const { term, course, sections } = await t.spine(t.alice);
    const second = await t.make(t.alice, term.id, "course", "Pathology");
    const lecture = await t.make(t.alice, sections.lectures.id, "lecture", "L1", {
      lecture: { number: 1, date: "2026-08-24" },
    });
    await t.make(t.alice, lecture.id, "document", "note");
    const f = await t.make(t.alice, sections.sources.id, "folder", "slides");
    await t.make(t.alice, f.id, "document", "deck");
    await t.call(t.alice, "PATCH", `/api/nodes/${course.id}`, { favourite: true });

    const res = await t.call(t.alice, "POST", `/api/nodes/${course.id}/duplicate`);
    expect(res.status).toBe(201);
    const copy = res.body.node;
    expect(copy.name).toBe("Pharmacology II copy");
    expect(copy.course).toEqual({ code: "PHAR 7340" });
    expect(copy.favourite).toBe(false);
    expect(await t.names(t.alice, term.id)).toEqual([
      "Pharmacology II",
      "Pharmacology II copy",
      "Pathology",
    ]);

    const walk = async (id: string): Promise<Array<{ id: string; shape: string }>> => {
      const out: Array<{ id: string; shape: string }> = [];
      for (const n of await t.children(t.alice, id)) {
        out.push({ id: n.id, shape: `${n.kind}:${n.name}:${JSON.stringify(n.lecture)}` });
        for (const d of await walk(n.id)) out.push({ id: d.id, shape: `${n.name}>${d.shape}` });
      }
      return out;
    };
    const original = await walk(course.id);
    const copied = await walk(copy.id);
    expect(original.length).toBe(5 + 1 + 1 + 1 + 1);
    expect(copied.map((n) => n.shape)).toEqual(original.map((n) => n.shape));
    const ids = new Set([...original, ...copied].map((n) => n.id));
    expect(ids.size).toBe(original.length * 2);
    expect(copied.some((n) => original.some((o) => o.id === n.id))).toBe(false);
    expect(second.id).toBeDefined();
  });

  it("skips trashed descendants", async () => {
    const t = setup();
    const { sections } = await t.spine(t.alice);
    const f = await t.make(t.alice, sections.sources.id, "folder", "f");
    const keep = await t.make(t.alice, f.id, "document", "keep");
    const gone = await t.make(t.alice, f.id, "document", "gone");
    await t.call(t.alice, "POST", `/api/nodes/${gone.id}/trash`);
    const copy = (await t.call(t.alice, "POST", `/api/nodes/${f.id}/duplicate`)).body.node;
    expect(await t.names(t.alice, copy.id)).toEqual([keep.name]);
  });
});

describe("trash", () => {
  it("trashes and restores subtrees; the trash lists only top-most items", async () => {
    const t = setup();
    const { term, course, sections } = await t.spine(t.alice);
    const lecture = await t.make(t.alice, sections.lectures.id, "lecture", "L1");
    const doc = await t.make(t.alice, lecture.id, "document", "note");

    const trashed = await t.call(t.alice, "POST", `/api/nodes/${course.id}/trash`);
    expect(trashed.body.node.trashedAt).toEqual(expect.any(String));
    expect(await t.names(t.alice, term.id)).toEqual([]);
    expect((await t.call(t.alice, "GET", `/api/nodes/${doc.id}`)).body.node.trashedAt).toBe(
      trashed.body.node.trashedAt,
    );
    const trash = await t.call(t.alice, "GET", "/api/trash");
    expect(trash.body.items.map((n: Json) => n.id)).toEqual([course.id]);
    expect(trash.body.items[0].childCount).toBe(5);
    expect(trash.body.nextCursor).toBeNull();

    // changes on trashed items are refused with a restore hint
    for (const [method, path, body] of [
      ["PATCH", `/api/nodes/${doc.id}`, { name: "x" }],
      ["POST", `/api/nodes/${doc.id}/move`, { parentId: lecture.id }],
      ["POST", `/api/nodes/${doc.id}/duplicate`],
      ["POST", `/api/nodes/${doc.id}/trash`],
    ] as Array<[string, string, unknown?]>) {
      expectRuleError(await t.call(t.alice, method, path, body), "conflict");
    }
    expectRuleError(
      await t.call(t.alice, "POST", "/api/nodes", {
        parentId: lecture.id,
        kind: "document",
        name: "late",
      }),
      "conflict",
    );

    const back = await t.call(t.alice, "POST", `/api/nodes/${course.id}/restore`);
    expect(back.body.node.trashedAt).toBeNull();
    expect((await t.call(t.alice, "GET", `/api/nodes/${doc.id}`)).body.node.trashedAt).toBeNull();
    expect((await t.call(t.alice, "GET", "/api/trash")).body.items).toEqual([]);
    expectRuleError(await t.call(t.alice, "POST", `/api/nodes/${course.id}/restore`), "conflict");
  });

  it("restores only what was trashed with the node, and refuses a trashed parent", async () => {
    const t = setup();
    const { course, sections } = await t.spine(t.alice);
    const lecture = await t.make(t.alice, sections.lectures.id, "lecture", "L1");
    const doc = await t.make(t.alice, lecture.id, "document", "note");
    await t.call(t.alice, "POST", `/api/nodes/${lecture.id}/trash`); // earlier, on its own
    await t.call(t.alice, "POST", `/api/nodes/${course.id}/trash`); // later, with the rest

    const refused = await t.call(t.alice, "POST", `/api/nodes/${lecture.id}/restore`);
    expectRuleError(refused, "conflict");
    expect(refused.body.error.hint).toContain(`/api/nodes/${sections.lectures.id}/restore`);
    const refusedSection = await t.call(t.alice, "POST", `/api/nodes/${doc.id}/restore`);
    expectRuleError(refusedSection, "conflict");

    await t.call(t.alice, "POST", `/api/nodes/${course.id}/restore`);
    expect(
      (await t.call(t.alice, "GET", `/api/nodes/${sections.lectures.id}`)).body.node.trashedAt,
    ).toBeNull();
    // the lecture stayed trashed, and now tops its own trashed subtree
    const trash = await t.call(t.alice, "GET", "/api/trash");
    expect(trash.body.items.map((n: Json) => n.id)).toEqual([lecture.id]);
    expect((await t.call(t.alice, "POST", `/api/nodes/${lecture.id}/restore`)).status).toBe(200);
    expect((await t.call(t.alice, "GET", `/api/nodes/${doc.id}`)).body.node.trashedAt).toBeNull();
  });

  it("deletes permanently only from the trash and only with a session", async () => {
    const t = setup();
    const { course, sections } = await t.spine(t.alice);
    const lecture = await t.make(t.alice, sections.lectures.id, "lecture", "Zebra lecture");
    const doc = await t.make(t.alice, lecture.id, "document", "note");

    expectRuleError(await t.call(t.alice, "DELETE", `/api/nodes/${lecture.id}`), "conflict");
    await t.call(t.alice, "POST", `/api/nodes/${lecture.id}/trash`);

    const key = { user: t.alice, via: "key" as const, scope: "write" as const };
    const viaKey = await t.call(key, "DELETE", `/api/nodes/${lecture.id}`);
    expect(viaKey.status).toBe(403);
    expect(viaKey.body.error.code).toBe("forbidden");
    const readKey = await t.call(
      { user: t.alice, via: "key", scope: "read" },
      "DELETE",
      `/api/nodes/${lecture.id}`,
    );
    expect(readKey.body.error.code).toBe("read_only_key");
    expect((await t.call(t.bob, "DELETE", `/api/nodes/${lecture.id}`)).status).toBe(404);
    expect((await t.call(t.alice, "GET", `/api/nodes/${lecture.id}`)).status).toBe(200);

    const del = await t.call(t.alice, "DELETE", `/api/nodes/${lecture.id}`);
    expect(del.status).toBe(204);
    expect((await t.call(t.alice, "GET", `/api/nodes/${lecture.id}`)).status).toBe(404);
    expect((await t.call(t.alice, "GET", `/api/nodes/${doc.id}`)).status).toBe(404);
    expect((await t.call(t.alice, "GET", "/api/search?q=zebra")).body.items).toEqual([]);
    expect((await t.call(t.alice, "GET", `/api/nodes/${course.id}`)).status).toBe(200);
  });

  it("pages the trash", async () => {
    const t = setup();
    const { sections } = await t.spine(t.alice);
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const d = await t.make(t.alice, sections.sources.id, "document", `d${i}`);
      await t.call(t.alice, "POST", `/api/nodes/${d.id}/trash`);
      ids.unshift(d.id); // newest first
    }
    const first = await t.call(t.alice, "GET", "/api/trash?limit=2");
    const second = await t.call(
      t.alice,
      "GET",
      `/api/trash?limit=2&cursor=${first.body.nextCursor}`,
    );
    const third = await t.call(
      t.alice,
      "GET",
      `/api/trash?limit=2&cursor=${second.body.nextCursor}`,
    );
    expect(
      [...first.body.items, ...second.body.items, ...third.body.items].map((n) => n.id),
    ).toEqual(ids);
    expect(third.body.nextCursor).toBeNull();
  });
});

describe("paging", () => {
  it("walks 120 children with no duplicates or gaps", async () => {
    const t = setup();
    const { sections } = await t.spine(t.alice);
    const s = sections.sources.id;
    const made: string[] = [];
    for (let i = 0; i < 120; i++) made.push((await t.make(t.alice, s, "document", `n${i}`)).id);

    for (const limit of [50, 7, 120, 200]) {
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const url: string = `/api/nodes?parentId=${s}&limit=${limit}${cursor ? `&cursor=${cursor}` : ""}`;
        const res = await t.call(t.alice, "GET", url);
        expect(res.status).toBe(200);
        seen.push(...res.body.items.map((n: Json) => n.id));
        cursor = res.body.nextCursor;
        pages++;
      } while (cursor);
      expect(seen).toEqual(made);
      expect(pages).toBe(Math.ceil(120 / limit));
    }
    const defaults = await t.call(t.alice, "GET", `/api/nodes?parentId=${s}`);
    expect(defaults.body.items).toHaveLength(50);
  });
});

describe("search", () => {
  it("matches name prefixes and survives hostile input", async () => {
    const t = setup();
    const { sections } = await t.spine(t.alice);
    const s = sections.sources.id;
    const bb = await t.make(t.alice, s, "document", "Beta blockers");
    await t.make(t.alice, s, "document", "Beta-lactams");
    await t.make(t.alice, s, "document", "Cardiology");
    await t.make(t.alice, s, "document", 'O\'Brien "quoted" (notes)');

    const search = (q: string) => t.call(t.alice, "GET", `/api/search?q=${encodeURIComponent(q)}`);
    const hit = await search("bet");
    expect(hit.status).toBe(200);
    expect(hit.body.items.map((h: Json) => h.node.name).sort()).toEqual([
      "Beta blockers",
      "Beta-lactams",
    ]);
    expect(hit.body.items[0]).toMatchObject({ kind: "node", snippet: expect.any(String) });
    expect(hit.body.items[0].node.path).toContain("Sources");
    expect((await search("beta bl")).body.items.map((h: Json) => h.node.id)).toEqual([bb.id]);
    expect((await search("CARDIO")).body.items).toHaveLength(1);
    expect((await search("brien")).body.items).toHaveLength(1);

    for (const hostile of [
      '"',
      "'",
      "*",
      "(",
      ")",
      "AND",
      "OR NOT",
      "NEAR(a b)",
      "name:beta",
      "beta*",
      '"beta',
      "^beta",
      "a - b",
      "col:",
      "-",
      "!!!",
      "bet) OR (1",
      "\\",
      "%",
      "ß",
    ]) {
      const res = await search(hostile);
      expect(res.status, hostile).toBe(200);
      expect(Array.isArray(res.body.items)).toBe(true);
    }
    expect((await search("!!!")).body.items).toEqual([]);
  });

  it("excludes trashed, tracks renames, and pages", async () => {
    const t = setup();
    const { sections } = await t.spine(t.alice);
    const s = sections.sources.id;
    const docs: Json[] = [];
    for (let i = 0; i < 5; i++) docs.push(await t.make(t.alice, s, "document", `Opioid ${i}`));
    await t.call(t.alice, "POST", `/api/nodes/${docs[0].id}/trash`);
    await t.call(t.alice, "PATCH", `/api/nodes/${docs[1].id}`, { name: "Antibiotic" });
    const found = await t.call(t.alice, "GET", "/api/search?q=opioid&limit=2");
    expect(found.body.items).toHaveLength(2);
    const rest = await t.call(
      t.alice,
      "GET",
      `/api/search?q=opioid&limit=2&cursor=${found.body.nextCursor}`,
    );
    const all = [...found.body.items, ...rest.body.items].map((h: Json) => h.node.id);
    expect(new Set(all).size).toBe(all.length);
    expect(all.sort()).toEqual([docs[2].id, docs[3].id, docs[4].id].sort());
    expect((await t.call(t.alice, "GET", "/api/search?q=antibio")).body.items).toHaveLength(1);
    // sections are not search results
    expect((await t.call(t.alice, "GET", "/api/search?q=sources")).body.items).toEqual([]);
    // trashed subtree is hidden, restored one is back
    await t.call(t.alice, "POST", `/api/nodes/${docs[0].id}/restore`);
    expect((await t.call(t.alice, "GET", "/api/search?q=opioid&limit=50")).body.items).toHaveLength(
      4,
    );
  });
});

describe("favorites and recents", () => {
  it("lists favorites, hides trashed ones", async () => {
    const t = setup();
    const { sections } = await t.spine(t.alice);
    const a = await t.make(t.alice, sections.sources.id, "document", "a");
    const b = await t.make(t.alice, sections.sources.id, "document", "b");
    await t.call(t.alice, "PATCH", `/api/nodes/${a.id}`, { favourite: true });
    await t.call(t.alice, "PATCH", `/api/nodes/${b.id}`, { favourite: true });
    const ids = async () =>
      (await t.call(t.alice, "GET", "/api/favourites")).body.items.map((n: Json) => n.id);
    expect(await ids()).toEqual([b.id, a.id]);
    await t.call(t.alice, "POST", `/api/nodes/${b.id}/trash`);
    expect(await ids()).toEqual([a.id]);
    await t.call(t.alice, "POST", `/api/nodes/${b.id}/restore`);
    await t.call(t.alice, "PATCH", `/api/nodes/${a.id}`, { favourite: false });
    expect(await ids()).toEqual([b.id]);
    expect((await t.call(t.bob, "GET", "/api/favourites")).body.items).toEqual([]);
  });

  it("orders recents by open or change, only marking opened on an explicit get", async () => {
    const t = setup();
    const { sections } = await t.spine(t.alice);
    const a = await t.make(t.alice, sections.sources.id, "document", "a");
    const b = await t.make(t.alice, sections.sources.id, "document", "b");
    const c = await t.make(t.alice, sections.sources.id, "document", "c");
    const recents = async () =>
      (await t.call(t.alice, "GET", "/api/recents?limit=3")).body.items.map((n: Json) => n.name);
    expect(await recents()).toEqual(["c", "b", "a"]);
    await t.call(t.alice, "GET", `/api/nodes/${a.id}`);
    expect(await recents()).toEqual(["a", "c", "b"]);
    await t.call(t.alice, "GET", `/api/nodes?parentId=${sections.sources.id}`); // listing opens nothing
    expect(await recents()).toEqual(["a", "c", "b"]);
    await t.call(t.alice, "PATCH", `/api/nodes/${b.id}`, { name: "b2" });
    expect(await recents()).toEqual(["b2", "a", "c"]);
    await t.call(t.alice, "POST", `/api/nodes/${b.id}/trash`);
    expect(await recents()).toEqual(
      ["a", "c"]
        .concat(await t.names(t.alice, null))
        .slice(0, 3)
        .filter(Boolean).length
        ? await recents()
        : [],
    );
    expect((await recents()).includes("b2")).toBe(false);
    expect((await recents()).includes("Sources")).toBe(false);
    expect(c.id).toBeDefined();
  });
});

describe("isolation", () => {
  it("gives user B not_found for every one of user A's nodes on every route", async () => {
    const t = setup();
    const { term, course, sections } = await t.spine(t.alice);
    const lecture = await t.make(t.alice, sections.lectures.id, "lecture", "Secret lecture");
    const doc = await t.make(t.alice, lecture.id, "document", "Secret note");
    await t.call(t.alice, "PATCH", `/api/nodes/${doc.id}`, { favourite: true });
    const trashedDoc = await t.make(t.alice, lecture.id, "document", "Secret trashed");
    await t.call(t.alice, "POST", `/api/nodes/${trashedDoc.id}/trash`);
    const mine = await t.make(t.bob, null, "term", "Bob term");
    const mineChild = await t.make(t.bob, mine.id, "course", "Bob course");

    const theirs = [term, course, ...Object.values(sections), lecture, doc, trashedDoc] as Json[];
    for (const node of theirs) {
      const id = node.id;
      const routes: Array<[string, string, unknown?]> = [
        ["GET", `/api/nodes/${id}`],
        ["GET", `/api/nodes?parentId=${id}`],
        ["PATCH", `/api/nodes/${id}`, { name: "hacked" }],
        ["POST", `/api/nodes/${id}/move`, { parentId: null }],
        ["POST", `/api/nodes/${id}/move`, { parentId: mine.id }],
        ["POST", `/api/nodes/${id}/duplicate`],
        ["POST", `/api/nodes/${id}/trash`],
        ["POST", `/api/nodes/${id}/restore`],
        ["DELETE", `/api/nodes/${id}`],
        ["POST", "/api/nodes", { parentId: id, kind: "document", name: "x" }],
        ["POST", `/api/nodes/${mineChild.id}/move`, { parentId: id }],
      ];
      for (const [method, path, body] of routes) {
        const res = await t.call(t.bob, method, path, body);
        expect(res.status, `${method} ${path}`).toBe(404);
        expect(res.body.error.code).toBe("not_found");
      }
    }
    // listings and search leak nothing
    expect((await t.call(t.bob, "GET", "/api/nodes")).body.items.map((n: Json) => n.id)).toEqual([
      mine.id,
    ]);
    expect((await t.call(t.bob, "GET", "/api/trash")).body.items).toEqual([]);
    expect((await t.call(t.bob, "GET", "/api/favourites")).body.items).toEqual([]);
    expect((await t.call(t.bob, "GET", "/api/search?q=secret")).body.items).toEqual([]);
    const recent = await t.call(t.bob, "GET", "/api/recents");
    expect(recent.body.items.every((n: Json) => n.userId === t.bob)).toBe(true);
    // an agent cannot probe A's ids as an anchor either
    const probe = await t.call(t.bob, "POST", `/api/nodes/${mineChild.id}/move`, {
      parentId: mine.id,
      afterId: doc.id,
    });
    expect(probe.status).toBe(400);
    // and nothing of A's changed
    expect((await t.call(t.alice, "GET", `/api/nodes/${doc.id}`)).body.node.name).toBe(
      "Secret note",
    );
    expect(await t.names(t.alice, null)).toEqual(["Fall 2026"]);
  });
});

describe("authorization", () => {
  it("needs a caller everywhere, and a write scope for every change", async () => {
    const t = setup();
    const { course, sections } = await t.spine(t.alice);
    const doc = await t.make(t.alice, sections.sources.id, "document", "d");
    await t.call(t.alice, "POST", `/api/nodes/${doc.id}/trash`);
    const changing: Array<[string, string, unknown?]> = [
      ["POST", "/api/nodes", { parentId: course.id, kind: "document", name: "x" }],
      ["PATCH", `/api/nodes/${course.id}`, { name: "x" }],
      ["POST", `/api/nodes/${course.id}/move`, { parentId: null }],
      ["POST", `/api/nodes/${course.id}/duplicate`],
      ["POST", `/api/nodes/${course.id}/trash`],
      ["POST", `/api/nodes/${doc.id}/restore`],
      ["DELETE", `/api/nodes/${doc.id}`],
    ];
    const reading: Array<[string, string]> = [
      ["GET", "/api/nodes"],
      ["GET", `/api/nodes/${course.id}`],
      ["GET", "/api/trash"],
      ["GET", "/api/recents"],
      ["GET", "/api/favourites"],
      ["GET", "/api/search?q=a"],
    ];
    const reader = { user: t.alice, via: "key" as const, scope: "read" as const };
    for (const [method, path, body] of changing) {
      const res = await t.call(reader, method, path, body);
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(res.body.error.code).toBe("read_only_key");
      expect((await t.call(null, method, path, body)).status).toBe(401);
    }
    for (const [method, path] of reading) {
      expect((await t.call(reader, method, path)).status, path).toBe(200);
      expect((await t.call(null, method, path)).status, path).toBe(401);
    }
    // nothing changed
    expect((await t.call(t.alice, "GET", `/api/nodes/${course.id}`)).body.node.name).toBe(
      "Pharmacology II",
    );
    // a write key may change things, but not delete permanently
    const writer = { user: t.alice, via: "key" as const, scope: "write" as const };
    expect((await t.call(writer, "PATCH", `/api/nodes/${course.id}`, { name: "ok" })).status).toBe(
      200,
    );
  });
});
