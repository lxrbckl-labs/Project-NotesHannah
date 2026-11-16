import { SearchHit } from "@notes/schema";
import { describe, expect, it } from "vitest";
import { type Composed, composed } from "./composed.support.js";
import { para, thrown } from "./documents-helpers.js";
import { errorCode, makeTestApp } from "./helpers.js";

/** A lecture named for beta blockers, a transcribed file filed under it, a document citing nothing. */
async function dataset(t: Composed) {
  const { sections, lecture } = t.spine();
  const folder = t.services.library.create(t.alice, {
    parentId: sections.study_guides as string,
    kind: "folder",
    name: "Beta agents",
  });
  const { file, pages } = await t.convertedFile(t.she, { name: "beta.pdf", nodeId: lecture.id });
  const texts = ["Beta blockers reduce heart rate.", "Propranolol is a nonselective beta blocker."];
  for (const [i, page] of pages.entries()) {
    t.services.files.saveTranscript(t.bot, {
      pageId: page.id,
      text: texts[i] as string,
      flags: [],
    });
  }
  const doc = t.services.documents.createDocument(t.she, {
    nodeId: lecture.id,
    kind: "lecture_note",
    title: "Lecture 7 notes",
    blocks: [para("Metoprolol is a beta blocker."), para("Unrelated text about zebras.")],
  } as never);
  return { lecture, folder, file, pages, doc };
}

const run = (t: Composed, q: string, extra: Record<string, unknown> = {}, userId = t.alice) =>
  t.services.search.search(userId, { q, ...extra });

describe("unified search", () => {
  it("finds nodes, pages and blocks, each shaped as the schema says", async () => {
    const t = composed();
    const d = await dataset(t);
    const found = run(t, "beta");
    for (const hit of found.items) expect(() => SearchHit.parse(hit)).not.toThrow();
    const byKind = (kind: string) => found.items.filter((h) => h.kind === kind);
    expect(byKind("node")).toHaveLength(2); // the lecture's name and the folder's
    expect(byKind("page")).toHaveLength(2);
    expect(byKind("block")).toHaveLength(1);
    expect(byKind("page")[0]).toMatchObject({
      fileId: d.file.id,
      fileName: "beta.pdf",
      nodeId: d.lecture.id,
    });
    const page = byKind("page").find((h) => h.kind === "page" && h.pageIndex === 2);
    expect(page).toMatchObject({ pageId: d.pages[1]?.id });
    expect(page && "snippet" in page && page.snippet).toContain("beta");
    expect(byKind("block")[0]).toMatchObject({
      kind: "block",
      documentId: d.doc.documentId,
      documentTitle: "Lecture 7 notes",
      blockId: d.doc.blockIds[0],
      blockType: "paragraph",
    });
    expect(found.nextCursor).toBeNull();
  });

  it("puts a name match first, then blocks before raw pages", async () => {
    const t = composed();
    await dataset(t);
    const order = run(t, "beta").items.map((h) => h.kind);
    expect(order[0]).toBe("node");
    expect(order.indexOf("block")).toBeLessThan(order.indexOf("page"));
    // Merged, not grouped: the second name match comes after the first block.
    expect(order).toEqual(["node", "node", "block", "page", "page"]);
  });

  it("restricts to the kinds asked for", async () => {
    const t = composed();
    await dataset(t);
    expect(new Set(run(t, "beta", { kinds: ["page"] }).items.map((h) => h.kind))).toEqual(
      new Set(["page"]),
    );
    expect(run(t, "beta", { kinds: ["node", "block"] }).items.map((h) => h.kind)).toEqual([
      "node",
      "node",
      "block",
    ]);
    expect(run(t, "zebras", { kinds: ["node"] }).items).toEqual([]);
    expect(run(t, "zebras", { kinds: ["block"] }).items).toHaveLength(1);
  });

  it("pages through every kind with one cursor, without repeats or gaps", async () => {
    const t = composed();
    await dataset(t);
    const all = run(t, "beta").items;
    for (const size of [1, 2, 3, 4]) {
      const seen: unknown[] = [];
      let cursor: string | undefined;
      for (let guard = 0; guard < 20; guard++) {
        const page = run(t, "beta", { limit: size, ...(cursor ? { cursor } : {}) });
        expect(page.items.length).toBeLessThanOrEqual(size);
        seen.push(...page.items);
        if (page.nextCursor === null) break;
        cursor = page.nextCursor;
      }
      expect(seen, `limit ${size}`).toEqual(all);
    }
    expect(thrown(() => run(t, "beta", { cursor: "not-a-cursor" })).code).toBe("invalid_input");
  });

  it("leaves out anything in the trash, and brings it back on restore", async () => {
    const t = composed();
    const d = await dataset(t);
    const count = (kind: string, q = "beta") =>
      run(t, q).items.filter((h) => h.kind === kind).length;
    t.services.files.trash(t.she, d.file.id);
    expect(count("page")).toBe(0);
    expect(count("block")).toBe(1);
    t.services.files.restore(t.she, d.file.id);
    expect(count("page")).toBe(2);

    // Trashing the lecture hides its name and its document's blocks; the file is in the
    // inbox, so its pages are still searchable (they are not trashed).
    t.services.library.trash(t.alice, d.lecture.id, t.she.actor);
    expect(count("node")).toBe(1); // only the folder
    expect(count("block")).toBe(0);
    expect(count("page")).toBe(2);
    expect(run(t, "beta").items.find((h) => h.kind === "page")).toMatchObject({ nodeId: null });
    t.services.library.restore(t.alice, d.lecture.id, t.she.actor);
    expect(count("node")).toBe(2);
    expect(count("block")).toBe(1);
  });

  it("never shows another user's things", async () => {
    const t = composed();
    await dataset(t);
    expect(run(t, "beta", {}, t.bob).items).toEqual([]);
    expect(run(t, "zebras", {}, t.bob).items).toEqual([]);
  });

  it("ignores text with no searchable words", async () => {
    const t = composed();
    await dataset(t);
    expect(run(t, "???").items).toEqual([]);
  });
});

describe("GET /api/search", () => {
  it("validates kinds and the cursor with a hint and an example", async () => {
    const t = makeTestApp();
    await t.addUser("hannah", "correct horse battery");
    const { cookies } = await t.signIn("hannah", "correct horse battery");
    const bad = await t.request("/api/search?q=beta&kinds=node,banana", { cookies });
    expect(bad.status).toBe(400);
    expect(errorCode(bad.body)).toBe("invalid_input");
    expect(JSON.stringify(bad.body)).toContain("banana");
    expect(JSON.stringify(bad.body)).toContain("example");
    expect((await t.request("/api/search?q=beta&kinds=", { cookies })).status).toBe(400);
    expect((await t.request("/api/search?q=beta&limit=101", { cookies })).status).toBe(400);
    expect((await t.request("/api/search?q=beta&cursor=zzz", { cookies })).status).toBe(400);
    expect((await t.request("/api/search", { cookies })).status).toBe(400);
    expect((await t.request("/api/search?q=beta")).status).toBe(401);
    const ok = await t.request("/api/search?q=beta&kinds=page,%20block", { cookies });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ items: [], nextCursor: null });
  });
});
