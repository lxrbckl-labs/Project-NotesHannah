import { newId, referenceSourceOf, SavedReference, SearchHit, WebAddress } from "@notes/schema";
import { describe, expect, it } from "vitest";
import { AppError } from "../src/http/errors.js";
import { createServices } from "../src/services.js";
import { type Composed, composed } from "./composed.support.js";
import { errorCode, makeTestApp } from "./helpers.js";
import { realSetup } from "./mcp-harness.js";

const code = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
  return undefined;
};

/** A course with a lecture and a folder of study guides, and one more lecture in a second course. */
function places(t: Composed) {
  const { course, sections, lecture } = t.spine();
  const folder = t.services.library.create(t.alice, {
    parentId: sections.study_guides as string,
    kind: "folder",
    name: "Exam 3 review",
  });
  const other = t.spine(t.alice, "Hypertension");
  return { course, sections, lecture, folder, other };
}

const save = (t: Composed, over: Record<string, unknown> = {}) =>
  t.services.references.create(t.she, {
    title: "High blood pressure guideline",
    url: "https://doi.org/10.1161/HYP.0000000000000065",
    ...over,
  });

describe("the web address", () => {
  it("takes http and https only, without a user name or password", () => {
    expect(WebAddress.parse(" https://example.org/a b ")).toBe("https://example.org/a%20b");
    expect(WebAddress.parse("http://example.org")).toBe("http://example.org/");
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,hi",
      "file:///etc/passwd",
      "ftp://example.org/x",
      "https://user:pw@example.org/",
      "https://intranet/",
      "example.org",
      "",
      `https://example.org/${"x".repeat(2000)}`,
    ]) {
      expect(WebAddress.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("knows a PharmGuides address by its host, and only by its host", () => {
    expect(referenceSourceOf("https://www.pharmguides.com/dosedex/")).toBe("pharmguides");
    expect(referenceSourceOf("https://pharmguides.com/")).toBe("pharmguides");
    expect(referenceSourceOf("https://pharmguides.com.example.org/")).toBeNull();
    expect(referenceSourceOf("https://example.org/?u=pharmguides.com")).toBeNull();
  });
});

describe("saving and changing references", () => {
  it("saves a reference tied to places, with the course of each place resolved", () => {
    const t = composed();
    const p = places(t);
    const r = save(t, {
      note: "BP targets",
      kind: "guideline",
      nodeIds: [p.lecture.id, p.folder.id, p.lecture.id],
    });
    expect(SavedReference.parse(r)).toBeTruthy();
    expect(r).toMatchObject({ title: "High blood pressure guideline", kind: "guideline" });
    expect(r.source).toBeNull();
    expect(r.places.map((x) => x.nodeId)).toEqual([p.lecture.id, p.folder.id]);
    expect(r.places[0]).toMatchObject({
      courseId: p.course.id,
      courseName: "Pharmacology II",
      trashed: false,
      path: "Fall 2026 / Pharmacology II / Lectures / Beta blockers",
    });
    expect(r.createdBy.type).toBe("user");
    const pg = save(t, { url: "https://www.pharmguides.com/antibioticdex/" });
    expect(pg.source).toBe("pharmguides");
  });

  it("refuses bad input, sections and terms, the trash, and other people's places", () => {
    const t = composed();
    const p = places(t);
    expect(code(() => save(t, { url: "javascript:alert(1)" }))).toBe("invalid_input");
    expect(code(() => save(t, { title: " " }))).toBe("invalid_input");
    expect(code(() => save(t, { kind: "poem" }))).toBe("invalid_input");
    expect(code(() => save(t, { extra: 1 }))).toBe("invalid_input");
    expect(code(() => save(t, { nodeIds: [p.sections.lectures] }))).toBe("invalid_input");
    expect(code(() => save(t, { nodeIds: [newId("node")] }))).toBe("not_found");
    expect(code(() => save(t, { nodeIds: [t.spine(t.bob).lecture.id] }))).toBe("not_found");
    expect(code(() => save(t, { nodeIds: Array.from({ length: 21 }, () => newId("node")) }))).toBe(
      "invalid_input",
    );
    t.services.library.trash(t.alice, p.folder.id);
    expect(code(() => save(t, { nodeIds: [p.folder.id] }))).toBe("invalid_input");
  });

  it("updates only what is sent, pins, and re-ties", () => {
    const t = composed();
    const p = places(t);
    const r = save(t, { nodeIds: [p.lecture.id] });
    expect(code(() => t.services.references.update(t.she, r.id, {}))).toBe("invalid_input");
    const u = t.services.references.update(t.she, r.id, {
      favourite: true,
      nodeIds: [p.folder.id],
      kind: "chart",
    });
    expect(u).toMatchObject({ title: r.title, url: r.url, favourite: true, kind: "chart" });
    expect(u.places.map((x) => x.nodeId)).toEqual([p.folder.id]);
    expect(t.services.references.update(t.she, r.id, { kind: null }).kind).toBeNull();
  });

  it("caps how many one person keeps", () => {
    const t = composed();
    const insert = t.db.prepare(
      `INSERT INTO "references" (id, user_id, title, url, created_by, created_at, updated_at) VALUES (?, ?, 'x', 'https://e.org/', '{}', '', '')`,
    );
    for (let i = 0; i < 500; i++) insert.run(newId("reference"), t.alice);
    expect(code(() => save(t))).toBe("invalid_input");
  });

  it("an agent can add and read; only her session deletes", () => {
    const t = composed();
    const r = t.services.references.create(t.bot, {
      title: "DailyMed",
      url: "https://dailymed.nlm.nih.gov/dailymed/",
    });
    expect(r.createdBy.type).toBe("agent");
    expect(code(() => t.services.references.delete(t.bot, r.id))).toBe("forbidden");
    t.services.references.delete(t.she, r.id);
    expect(code(() => t.services.references.get(t.she, r.id))).toBe("not_found");
    expect(t.changes().map((c) => c.action)).toEqual(["reference.created", "reference.deleted"]);
    expect(t.activity().some((a) => a.summary.includes('Saved the reference "DailyMed"'))).toBe(
      true,
    );
  });

  it("is hers: another user sees nothing and cannot touch it", () => {
    const t = composed();
    const r = save(t);
    expect(code(() => t.services.references.get(t.bobUser, r.id))).toBe("not_found");
    expect(code(() => t.services.references.update(t.bobUser, r.id, { title: "x" }))).toBe(
      "not_found",
    );
    expect(code(() => t.services.references.delete(t.bobUser, r.id))).toBe("not_found");
    expect(t.services.references.list(t.bobUser).items).toEqual([]);
    expect(t.services.search.search(t.bob, { q: "pressure" }).items).toEqual([]);
  });
});

describe("listing", () => {
  it("filters by kind, words, pin, place (with what is inside) and course; pinned first", () => {
    const t = composed();
    const p = places(t);
    const a = save(t, { title: "Beta blocker chart", kind: "chart", nodeIds: [p.lecture.id] });
    const b = save(t, { title: "Exam folder guide", kind: "guideline", nodeIds: [p.folder.id] });
    const c = save(t, { title: "Other course", nodeIds: [p.other.lecture.id], favourite: true });
    const d = save(t, { title: "Loose", note: "nothing tied" });
    const ids = (o: Record<string, unknown>) =>
      t.services.references.list(t.she, o).items.map((r) => r.id);
    expect(ids({})).toEqual([c.id, d.id, b.id, a.id]);
    expect(ids({ kind: "chart" })).toEqual([a.id]);
    expect(ids({ q: "TIED  noth" })).toEqual([d.id]);
    expect(ids({ q: "100%" })).toEqual([]);
    expect(ids({ favourite: true })).toEqual([c.id]);
    expect(ids({ nodeId: p.lecture.id })).toEqual([a.id]);
    expect(ids({ nodeId: p.course.id })).toEqual([b.id, a.id]);
    expect(ids({ nodeId: p.course.id, within: false })).toEqual([]);
    expect(ids({ courseId: p.other.course.id })).toEqual([c.id]);
    const page1 = t.services.references.list(t.she, { limit: 3 });
    expect(page1.items).toHaveLength(3);
    const page2 = t.services.references.list(t.she, {
      limit: 3,
      cursor: page1.nextCursor ?? undefined,
    });
    expect(page2.items.map((r) => r.id)).toEqual([a.id]);
    expect(page2.nextCursor).toBeNull();
    expect(code(() => t.services.references.list(t.she, { cursor: "zzz" }))).toBe("invalid_input");
  });
});

describe("node links follow the library", () => {
  it("trash hides the tie and keeps it; restore brings it back; delete for good drops it only", () => {
    const t = composed();
    const p = places(t);
    const r = save(t, { nodeIds: [p.lecture.id, p.folder.id] });
    t.services.library.trash(t.alice, p.lecture.id);
    let got = t.services.references.get(t.she, r.id);
    expect(got.places.find((x) => x.nodeId === p.lecture.id)?.trashed).toBe(true);
    expect(t.services.references.list(t.she, { nodeId: p.course.id }).items).toHaveLength(1);
    expect(t.services.references.list(t.she, { nodeId: p.lecture.id }).items).toEqual([]);
    t.services.library.restore(t.alice, p.lecture.id);
    got = t.services.references.get(t.she, r.id);
    expect(got.places.every((x) => !x.trashed)).toBe(true);
    expect(t.services.references.list(t.she, { nodeId: p.lecture.id }).items).toHaveLength(1);
    // A trashed course hides ties to everything inside it too.
    t.services.library.trash(t.alice, p.course.id);
    expect(t.services.references.get(t.she, r.id).places.every((x) => x.trashed)).toBe(true);
    t.services.library.permanentDelete(t.alice, p.course.id);
    got = t.services.references.get(t.she, r.id);
    expect(got.places).toEqual([]);
    expect(
      (t.db.prepare("SELECT COUNT(*) AS n FROM reference_nodes").get() as { n: number }).n,
    ).toBe(0);
  });

  it("a duplicated lecture is tied to the same references as the original", () => {
    const t = composed();
    const p = places(t);
    const r = save(t, { nodeIds: [p.lecture.id] });
    const copy = t.services.library.duplicate(t.alice, p.lecture.id);
    expect(t.services.references.get(t.she, r.id).places.map((x) => x.nodeId)).toEqual([
      p.lecture.id,
      copy.id,
    ]);
  });
});

describe("search", () => {
  it("her references are a kind of hit, title matches first, and cursors carry them", () => {
    const t = composed();
    const p = places(t);
    save(t, { title: "Antibiotic spectrum chart", kind: "chart" });
    save(t, { title: "Dosing sheet", note: "For antibiotic doses in sepsis" });
    const hits = t.services.search.search(t.alice, { q: "antibiotic" }).items;
    expect(hits.map((h) => (h.kind === "reference" ? h.title : h.kind))).toEqual([
      "Antibiotic spectrum chart",
      "Dosing sheet",
    ]);
    for (const h of hits) expect(SearchHit.parse(h)).toBeTruthy();
    const one = t.services.search.search(t.alice, { q: "antibiotic", limit: 1 });
    expect(one.nextCursor).not.toBeNull();
    const two = t.services.search.search(t.alice, {
      q: "antibiotic",
      limit: 1,
      cursor: one.nextCursor ?? undefined,
    });
    expect(two.items.map((h) => h.kind === "reference" && h.title)).toEqual(["Dosing sheet"]);
    expect(t.services.search.search(t.alice, { q: "beta", kinds: ["reference"] }).items).toEqual(
      [],
    );
    expect(p.lecture.id).toBeTruthy();
  });
});

describe("outside references on study material", () => {
  it("a block may name a reference instead of citing her slides; it is checked and back-linked", () => {
    const t = composed();
    const p = places(t);
    const saved = save(t, { url: "https://www.pharmguides.com/dosedex/", title: "DoseDex" });
    const block = (refs: unknown, extra: Record<string, unknown> = {}) => ({
      type: "paragraph",
      content: { text: "Checked against an emergency dosing chart." },
      references: refs,
      ...extra,
    });
    // An agent's block with neither a citation, a reference nor generalKnowledge is refused.
    expect(
      code(() =>
        t.services.documents.createDocument(t.bot, {
          nodeId: p.lecture.id,
          kind: "lecture_note",
          title: "Beta blockers",
          blocks: [{ type: "paragraph", content: { text: "Unsourced." } }],
        } as never),
      ),
    ).toBe("invalid_input");
    // A bad address on a reference is refused too.
    expect(
      code(() =>
        t.services.documents.createDocument(t.bot, {
          nodeId: p.lecture.id,
          kind: "lecture_note",
          title: "Beta blockers",
          blocks: [block([{ title: "x", url: "javascript:alert(1)" }])],
        } as never),
      ),
    ).toBe("invalid_input");
    const made = t.services.documents.createDocument(t.bot, {
      nodeId: p.lecture.id,
      kind: "lecture_note",
      title: "Beta blockers",
      blocks: [
        block([
          { title: "DoseDex", url: "https://www.pharmguides.com/dosedex/", referenceId: saved.id },
        ]),
        block([{ title: "Other", url: "https://doi.org/10.1/x" }]),
      ],
    } as never);
    const used = t.services.references.usedIn(t.she, saved.id);
    expect(used).toHaveLength(1);
    expect(used[0]).toMatchObject({ documentId: made.documentId, nodeId: p.lecture.id });
    // Stored blocks without the field still read; the field round-trips on those that have it.
    const full = t.services.documents.getFull(t.she, made.documentId, { from: 0, limit: 10 });
    expect(full.blocks[0]?.references?.[0]?.title).toBe("DoseDex");
  });
});

describe("HTTP routes", () => {
  it("list, create, update and delete over /api/references, with her session", async () => {
    const t = makeTestApp({ services: (deps) => createServices(deps) });
    const u = await t.addUser("hannah", "correct horse battery");
    const { cookies } = await t.signIn("hannah", "correct horse battery");
    const term = t.services?.library.create(u.id, { parentId: null, kind: "term", name: "T" });
    const course = t.services?.library.create(u.id, {
      parentId: term?.id as string,
      kind: "course",
      name: "C",
    });
    expect((await t.request("/api/references")).status).toBe(401);
    const made = await t.request("/api/references", {
      cookies,
      body: {
        title: "AntibioticDex",
        url: "https://www.pharmguides.com/antibioticdex/",
        nodeIds: [course?.id],
      },
    });
    expect(made.status).toBe(201);
    const ref = (made.body as { reference: { id: string; source: string } }).reference;
    expect(ref.source).toBe("pharmguides");
    const bad = await t.request("/api/references", {
      cookies,
      body: { title: "x", url: "javascript:alert(1)" },
    });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).toContain("Only web addresses");
    const listed = await t.request(`/api/references?courseId=${course?.id}&kind=chart`, {
      cookies,
    });
    expect(listed.body).toEqual({ items: [], nextCursor: null });
    expect(
      (
        (await t.request(`/api/references?nodeId=${course?.id}`, { cookies })).body as {
          items: unknown[];
        }
      ).items,
    ).toHaveLength(1);
    expect((await t.request("/api/references?kind=poem", { cookies })).status).toBe(400);
    const patched = await t.request(`/api/references/${ref.id}`, {
      cookies,
      method: "PATCH",
      body: { kind: "chart" },
    });
    expect(patched.status).toBe(200);
    expect((await t.request("/api/references/ref_nope", { cookies })).status).toBe(404);
    const del = await t.request(`/api/references/${ref.id}`, { cookies, method: "DELETE" });
    expect(del.status).toBe(204);
    expect(errorCode((await t.request(`/api/references/${ref.id}`, { cookies })).body)).toBe(
      "not_found",
    );
  });
});

describe("MCP references tool", () => {
  it("lists for a place and adds; it has no change or delete; read-only keys only read", async () => {
    const s = await realSetup();
    const a = await s.agent();
    const lib = s.services.library;
    const term = lib.create(a.user.id, { parentId: null, kind: "term", name: "Fall 2026" });
    const course = lib.create(a.user.id, { parentId: term.id, kind: "course", name: "Pharm" });
    const added = await a.ok("references", {
      action: "add",
      title: "Beers Criteria",
      url: "https://doi.org/10.1111/jgs.18372",
      kind: "guideline",
      nodeIds: [course.id],
    });
    expect(added.text).toContain("Beers Criteria");
    const listed = await a.ok("references", { action: "list", nodeId: course.id });
    expect((listed.structured.items as unknown[]).length).toBe(1);
    expect(listed.text).toContain("do not copy");
    const nope = await a.fail("references", { action: "delete" });
    expect(nope.error.code).toBe("invalid_input");
    const found = await a.ok("search_notes", { query: "beers", kinds: ["reference"] });
    expect(found.text).toContain("saved reference");
    const reader = await s.agent("hannah", "read");
    expect((await reader.ok("references", { action: "list" })).structured.items).toHaveLength(1);
    expect(
      (await reader.fail("references", { action: "add", title: "x", url: "https://e.org/" })).error
        .code,
    ).toBe("read_only_key");
    const { tools } = await a.client.listTools();
    const desc = tools.find((x) => x.name === "references")?.description ?? "";
    expect(desc).toMatch(/never paste long passages/);
    expect(listed.text).toContain("DoseDex <https://www.pharmguides.com/dosedex/>");
    expect((listed.structured.builtIn as Array<{ trusted: boolean }>)[0]?.trusted).toBe(true);
  });
});
