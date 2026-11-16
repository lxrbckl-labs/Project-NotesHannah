import { MARGIN_NOTE_LIMITS, MarginNote, newId, SearchHit } from "@notes/schema";
import { describe, expect, it } from "vitest";
import type { AuthContext } from "../src/http/auth-context.js";
import { AppError } from "../src/http/errors.js";
import type { Services } from "../src/services.js";
import { composed } from "./composed.support.js";
import { agentAuth, userAuth } from "./documents-helpers.js";
import { errorCode } from "./helpers.js";
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

const para = (text: string) => ({ type: "paragraph", content: { text }, generalKnowledge: true });

/** A lecture with an agent-written guide of four blocks: a heading and three paragraphs. */
function guide(services: Services, userId: string, title = "Beta blockers") {
  const term = services.library.create(userId, { parentId: null, kind: "term", name: "Fall 2026" });
  const course = services.library.create(userId, {
    parentId: term.id,
    kind: "course",
    name: "Pharmacology II",
  });
  const lectures = services.library
    .list(userId, { parentId: course.id })
    .items.find((s) => s.section === "lectures")?.id as string;
  const lecture = services.library.create(userId, {
    parentId: lectures,
    kind: "lecture",
    name: title,
    lecture: { number: 7, date: "2026-10-14" },
  });
  const doc = services.documents.createDocument(agentAuth(userId), {
    nodeId: lecture.id,
    kind: "lecture_note",
    title,
    blocks: [
      { type: "heading", content: { level: 2, text: "Mechanism" } },
      para("Metoprolol is cardioselective at low doses."),
      para("Labetalol blocks alpha 1 and beta receptors."),
      para("Avoid non-selective agents in asthma."),
    ],
  } as never);
  return { lecture, documentId: doc.documentId, blocks: doc.blockIds };
}

function setup() {
  const t = composed();
  const g = guide(t.services, t.alice);
  const m = t.services.marginNotes;
  const add = (over: Record<string, unknown> = {}, auth: AuthContext = t.she) =>
    m.create(auth, g.documentId, { blockId: g.blocks[2], text: "Ask in OH", ...over });
  const row = (id: string) => m.list(t.she, g.documentId).find((n) => n.id === id) as MarginNote;
  const docState = () => {
    const d = t.services.documents.getDocument(t.she, g.documentId).document;
    return { revision: d.revision, reviewStatus: d.reviewStatus, updatedAt: d.updatedAt };
  };
  return { t, g, m, add, row, docState };
}

describe("writing side notes", () => {
  it("adds a note beside a block, with the block's text as its snippet", () => {
    const { t, g, add } = setup();
    const n = add({
      quote: " labetalol ",
      colour: "yellow",
      text: "I mix this up\nwith carvedilol",
    });
    expect(MarginNote.parse(n)).toBeTruthy();
    expect(n).toMatchObject({
      documentId: g.documentId,
      blockId: g.blocks[2],
      quote: "labetalol",
      text: "I mix this up\nwith carvedilol",
      colour: "yellow",
      resolved: false,
      resolvedAt: null,
      detached: false,
      detachedAt: null,
      snippet: "Labetalol blocks alpha 1 and beta receptors.",
    });
    expect(n.id.startsWith("mgn_")).toBe(true);
    const plain = add({ quote: "  " });
    expect(plain.quote).toBeNull();
    expect(plain.colour).toBeNull();
    expect(t.services.marginNotes.list(t.she, g.documentId).map((x) => x.id)).toEqual([
      n.id,
      plain.id,
    ]);
  });

  it("refuses empty or long text, a bad colour, unknown blocks and fields", () => {
    const { t, g, add } = setup();
    expect(code(() => add({ text: "   " }))).toBe("invalid_input");
    expect(code(() => add({ text: "x".repeat(MARGIN_NOTE_LIMITS.textChars + 1) }))).toBe(
      "invalid_input",
    );
    expect(code(() => add({ quote: "q".repeat(MARGIN_NOTE_LIMITS.quoteChars + 1) }))).toBe(
      "invalid_input",
    );
    expect(code(() => add({ colour: "#ff0000" }))).toBe("invalid_input");
    expect(code(() => add({ blockId: "nope" }))).toBe("invalid_input");
    expect(code(() => add({ extra: 1 }))).toBe("invalid_input");
    expect(code(() => add({ blockId: newId("block") }))).toBe("not_found");
    // A block of another document of hers is not a block of this one.
    const other = guide(t.services, t.alice, "Hypertension");
    expect(code(() => add({ blockId: other.blocks[1] }))).toBe("not_found");
    expect(code(() => t.services.marginNotes.list(t.she, newId("document")))).toBe("not_found");
    expect(
      code(() =>
        t.services.marginNotes.update(t.she, g.documentId, newId("marginNote"), { resolved: true }),
      ),
    ).toBe("not_found");
  });

  it("changes text and colour, resolves and reopens", () => {
    const { t, g, m, add } = setup();
    const n = add({ colour: "pink" });
    expect(code(() => m.update(t.she, g.documentId, n.id, {}))).toBe("invalid_input");
    t.clock.advance(60_000);
    const done = m.update(t.she, g.documentId, n.id, { resolved: true });
    expect(done.resolved).toBe(true);
    expect(done.resolvedAt).toBe(done.updatedAt);
    expect(done.text).toBe("Ask in OH");
    expect(done.colour).toBe("pink");
    const recoloured = m.update(t.she, g.documentId, n.id, { colour: null, text: "Asked: fine" });
    expect(recoloured).toMatchObject({ colour: null, text: "Asked: fine", resolved: true });
    expect(recoloured.resolvedAt).toBe(done.resolvedAt);
    const open = m.update(t.she, g.documentId, n.id, { resolved: false });
    expect(open).toMatchObject({ resolved: false, resolvedAt: null });
    expect(
      t
        .changes()
        .filter((c) => c.objectType === "margin_note")
        .map((c) => c.action),
    ).toEqual([
      "margin_note.added",
      "margin_note.changed",
      "margin_note.changed",
      "margin_note.changed",
    ]);
    // The feed names the document, never her words.
    const entry = t.changes().find((c) => c.action === "margin_note.added");
    expect(entry).toMatchObject({
      summary: 'Added a side note on "Beta blockers"',
      documentId: g.documentId,
      objectIds: [n.id],
    });
    expect(JSON.stringify(t.changes())).not.toContain("Asked: fine");
  });

  it("deletes a note", () => {
    const { t, g, m, add } = setup();
    const n = add();
    m.delete(t.she, g.documentId, n.id);
    expect(m.list(t.she, g.documentId)).toEqual([]);
    expect(code(() => m.delete(t.she, g.documentId, n.id))).toBe("not_found");
    expect(t.changes().at(-1)?.action).toBe("margin_note.deleted");
  });

  it("never touches the document: same revision, review state and update time", () => {
    const { t, g, m, add, docState } = setup();
    const before = docState();
    const n = add();
    m.update(t.she, g.documentId, n.id, { text: "Changed", resolved: true });
    m.reattach(t.she, g.documentId, n.id, { blockId: g.blocks[1] });
    m.delete(t.she, g.documentId, n.id);
    expect(docState()).toEqual(before);
    expect(t.services.documents.listRevisions(t.she, g.documentId).items).toHaveLength(1);
  });

  it("keeps at most the per-document limit", () => {
    const { t, g, add } = setup();
    const insert = t.db.prepare(
      `INSERT INTO margin_notes (id, user_id, document_id, block_id, text, created_at, updated_at) VALUES (?, ?, ?, ?, 'x', '', '')`,
    );
    for (let i = 0; i < MARGIN_NOTE_LIMITS.perDocument; i++) {
      insert.run(newId("marginNote"), t.alice, g.documentId, g.blocks[1]);
    }
    expect(code(() => add())).toBe("invalid_input");
    // The limit is per document: another guide still takes notes.
    const other = guide(t.services, t.alice, "Hypertension");
    expect(
      t.services.marginNotes.create(t.she, other.documentId, {
        blockId: other.blocks[1],
        text: "ok",
      }).text,
    ).toBe("ok");
  });
});

describe("only she writes them", () => {
  it("an agent reads; with any key it cannot add, change, move or delete", () => {
    const { t, g, m, add } = setup();
    const n = add();
    expect(m.list(t.bot, g.documentId)).toHaveLength(1);
    const body = { blockId: g.blocks[1], text: "From the agent" };
    expect(code(() => m.create(t.bot, g.documentId, body))).toBe("forbidden");
    expect(code(() => m.update(t.bot, g.documentId, n.id, { resolved: true }))).toBe("forbidden");
    expect(code(() => m.reattach(t.bot, g.documentId, n.id, { blockId: g.blocks[1] }))).toBe(
      "forbidden",
    );
    expect(code(() => m.delete(t.bot, g.documentId, n.id))).toBe("forbidden");
    const reader = agentAuth(t.alice, newId("apiKey"), "read");
    expect(code(() => m.create(reader, g.documentId, body))).toBe("read_only_key");
    expect(m.list(reader, g.documentId)).toHaveLength(1);
  });

  it("is hers: another person finds nothing and touches nothing", () => {
    const { t, g, m, add } = setup();
    const n = add({ text: "propranolol crosses the blood brain barrier" });
    const bob = t.bobUser;
    expect(code(() => m.list(bob, g.documentId))).toBe("not_found");
    expect(code(() => m.create(bob, g.documentId, { blockId: g.blocks[1], text: "x" }))).toBe(
      "not_found",
    );
    expect(code(() => m.update(bob, g.documentId, n.id, { text: "x" }))).toBe("not_found");
    expect(code(() => m.delete(bob, g.documentId, n.id))).toBe("not_found");
    expect(code(() => m.reattach(bob, g.documentId, n.id, { blockId: g.blocks[1] }))).toBe(
      "not_found",
    );
    // Bob's own note id used on her document is missing too.
    const bobs = guide(t.services, t.bob);
    const his = m.create(bob, bobs.documentId, { blockId: bobs.blocks[1], text: "his" });
    expect(code(() => m.update(t.she, g.documentId, his.id, { text: "x" }))).toBe("not_found");
    expect(code(() => m.delete(t.she, bobs.documentId, his.id))).toBe("not_found");
    expect(m.recent(bob).map((x) => x.id)).toEqual([his.id]);
    expect(t.services.search.search(t.bob, { q: "blood brain" }).items).toEqual([]);
  });

  it("a document in the trash hides its notes; deleting it for good removes them", () => {
    const { t, g, m, add } = setup();
    add();
    t.services.library.trash(t.alice, g.lecture.id);
    expect(code(() => m.list(t.she, g.documentId))).toBe("not_found");
    expect(code(() => add())).toBe("not_found");
    expect(m.recent(t.she)).toEqual([]);
    t.services.library.restore(t.alice, g.lecture.id);
    expect(m.list(t.she, g.documentId)).toHaveLength(1);
    t.services.library.trash(t.alice, g.lecture.id);
    t.services.library.permanentDelete(t.alice, g.lecture.id);
    expect((t.db.prepare("SELECT COUNT(*) AS n FROM margin_notes").get() as { n: number }).n).toBe(
      0,
    );
  });

  it("duplicating the lecture copies the document but none of her notes", () => {
    const { t, g, m, add } = setup();
    add();
    const copy = t.services.library.duplicate(t.alice, g.lecture.id);
    const copyDoc = t.services.documents.getDocumentByNode(t.she, copy.id).document.id;
    expect(m.list(t.she, copyDoc)).toEqual([]);
    expect(m.list(t.she, g.documentId)).toHaveLength(1);
  });
});

describe("notes follow the blocks", () => {
  it("deleting a block detaches its note and keeps the last known text", () => {
    const { t, g, add, row } = setup();
    const n = add();
    const other = add({ blockId: g.blocks[1] });
    t.clock.advance(1000);
    t.services.documents.deleteBlocks(t.she, {
      documentId: g.documentId,
      blockIds: [g.blocks[2]],
    } as never);
    const gone = row(n.id);
    expect(gone.detached).toBe(true);
    expect(gone.detachedAt).toBe(new Date(t.clock.now()).toISOString());
    expect(gone.blockId).toBe(g.blocks[2]);
    expect(gone.snippet).toBe("Labetalol blocks alpha 1 and beta receptors.");
    expect(gone.updatedAt).toBe(n.updatedAt);
    expect(row(other.id).detached).toBe(false);
    // A later write keeps the first time it went missing.
    t.clock.advance(1000);
    t.services.documents.insertBlocks(t.she, {
      documentId: g.documentId,
      blocks: [{ type: "paragraph", content: { text: "More." } }],
      position: "end",
    } as never);
    expect(row(n.id).detachedAt).toBe(gone.detachedAt);
  });

  it("an edit refreshes the snippet; the snippet is trimmed to the limit", () => {
    const { t, g, add, row } = setup();
    const n = add();
    t.services.documents.updateBlock(t.she, {
      documentId: g.documentId,
      blockId: g.blocks[2],
      mode: "patch",
      patch: { content: { text: `Labetalol ${"is safe in pregnancy ".repeat(20)}` } },
    } as never);
    const s = row(n.id).snippet;
    expect(s.startsWith("Labetalol is safe in pregnancy")).toBe(true);
    expect(s.length).toBe(MARGIN_NOTE_LIMITS.snippetChars);
    expect(s.endsWith("…")).toBe(true);
    expect(row(n.id).detached).toBe(false);
  });

  it("replace_generated detaches notes on replaced blocks, not on kept ones", () => {
    const { t, g, add, row } = setup();
    const onReplaced = add();
    const onKept = add({ blockId: g.blocks[1] });
    const out = t.services.documents.replaceGenerated(t.bot, {
      documentId: g.documentId,
      scope: [g.blocks[2], g.blocks[3]],
      blocks: [para("Labetalol: alpha and beta, rewritten."), para("Asthma: avoid propranolol.")],
    } as never);
    expect(out.removed).toContain(g.blocks[2]);
    expect(row(onReplaced.id)).toMatchObject({
      detached: true,
      snippet: "Labetalol blocks alpha 1 and beta receptors.",
      text: "Ask in OH",
    });
    expect(row(onKept.id).detached).toBe(false);
  });

  it("moving blocks keeps notes attached", () => {
    const { t, g, add, row } = setup();
    const n = add();
    t.services.documents.moveBlocks(t.she, {
      documentId: g.documentId,
      blockIds: [g.blocks[2]],
      position: "start",
    } as never);
    expect(row(n.id)).toMatchObject({ detached: false, blockId: g.blocks[2] });
  });

  it("restoring a revision that brings the block back re-attaches the note", () => {
    const { t, g, add, row } = setup();
    const n = add();
    t.services.documents.deleteBlocks(t.she, {
      documentId: g.documentId,
      blockIds: [g.blocks[2]],
    } as never);
    expect(row(n.id).detached).toBe(true);
    t.services.documents.restoreRevision(t.she, { documentId: g.documentId, revision: 1 } as never);
    expect(row(n.id)).toMatchObject({ detached: false, detachedAt: null, blockId: g.blocks[2] });
  });

  it("reattach moves a note to another block, clears detached and refreshes the snippet", () => {
    const { t, g, m, add, row } = setup();
    const n = add({ quote: "labetalol" });
    t.services.documents.deleteBlocks(t.she, {
      documentId: g.documentId,
      blockIds: [g.blocks[2]],
    } as never);
    expect(code(() => m.reattach(t.she, g.documentId, n.id, { blockId: g.blocks[2] }))).toBe(
      "not_found",
    );
    const moved = m.reattach(t.she, g.documentId, n.id, { blockId: g.blocks[3] });
    expect(moved).toMatchObject({
      blockId: g.blocks[3],
      quote: null,
      detached: false,
      detachedAt: null,
      snippet: "Avoid non-selective agents in asthma.",
    });
    expect(row(n.id)).toEqual(moved);
    const quoted = m.reattach(t.she, g.documentId, n.id, { blockId: g.blocks[3], quote: "asthma" });
    expect(quoted.quote).toBe("asthma");
    expect(t.changes().at(-1)?.action).toBe("margin_note.reattached");
  });
});

describe("search", () => {
  it("finds her notes by every word of their text or quote, as kind margin_note", () => {
    const { t, g, m, add } = setup();
    const a = add({ text: "Quiz question: which one is cardioselective?" });
    const b = add({
      text: "Dose reminder",
      quote: "cardioselective at low doses",
      blockId: g.blocks[1],
    });
    m.update(t.she, g.documentId, b.id, { resolved: true });
    const hits = t.services.search.search(t.alice, {
      q: "cardioselective",
      kinds: ["margin_note"],
    }).items;
    // Open notes first.
    expect(hits.map((h) => h.kind === "margin_note" && h.noteId)).toEqual([a.id, b.id]);
    for (const h of hits) expect(SearchHit.parse(h)).toBeTruthy();
    expect(hits[0]).toMatchObject({
      kind: "margin_note",
      documentId: g.documentId,
      nodeId: g.lecture.id,
      documentTitle: "Beta blockers",
      blockId: g.blocks[2],
      resolved: false,
      detached: false,
      snippet: "Quiz question: which one is cardioselective?",
    });
    expect(hits[1]).toMatchObject({ resolved: true });
    expect(
      t.services.search.search(t.alice, { q: "quiz cardio", kinds: ["margin_note"] }).items,
    ).toHaveLength(1);
    expect(t.services.search.search(t.alice, { q: "100%", kinds: ["margin_note"] }).items).toEqual(
      [],
    );
    // In the unified list too, with a cursor that carries them.
    const all = t.services.search.search(t.alice, { q: "quiz" });
    expect(all.items.some((h) => h.kind === "margin_note")).toBe(true);
    const one = t.services.search.search(t.alice, { q: "cardioselective", limit: 1 });
    const two = t.services.search.search(t.alice, {
      q: "cardioselective",
      limit: 10,
      cursor: one.nextCursor ?? undefined,
    });
    const seen = [...one.items, ...two.items].filter((h) => h.kind === "margin_note");
    expect(seen).toHaveLength(2);
    // Out of sight with the document in the trash.
    t.services.library.trash(t.alice, g.lecture.id);
    expect(t.services.search.search(t.alice, { q: "quiz", kinds: ["margin_note"] }).items).toEqual(
      [],
    );
  });
});

describe("HTTP routes", () => {
  it("list, add, change, move and delete with her session; any key may only read", async () => {
    const s = await realSetup();
    const u = await s.user("hannah");
    const g = guide(s.services, u.id);
    const { cookies } = await s.t.signIn("hannah", "correct horse battery");
    const base = `/api/documents/${g.documentId}/margin-notes`;
    expect((await s.t.request(base)).status).toBe(401);
    const made = await s.t.request(base, {
      cookies,
      body: { blockId: g.blocks[1], text: "Was on the quiz", colour: "blue" },
    });
    expect(made.status).toBe(201);
    const n = (made.body as { note: MarginNote }).note;
    expect(n).toMatchObject({ colour: "blue", detached: false });
    const bad = await s.t.request(base, { cookies, body: { blockId: g.blocks[1], text: "" } });
    expect(bad.status).toBe(400);
    expect(errorCode(bad.body)).toBe("invalid_input");
    const unknown = await s.t.request(base, {
      cookies,
      body: { blockId: newId("block"), text: "x" },
    });
    expect(unknown.status).toBe(404);
    expect((await s.t.request(base, { cookies, body: "not json" })).status).toBe(400);
    expect((await s.t.request("/api/documents/nope/margin-notes", { cookies })).status).toBe(404);
    expect((await s.t.request(`${base}/mgn_nope`, { cookies, method: "DELETE" })).status).toBe(404);

    const listed = await s.t.request(base, { cookies });
    expect((listed.body as { items: MarginNote[] }).items.map((x) => x.id)).toEqual([n.id]);
    const patched = await s.t.request(`${base}/${n.id}`, {
      cookies,
      method: "PATCH",
      body: { resolved: true },
    });
    expect(patched.status).toBe(200);
    expect((patched.body as { note: MarginNote }).note.resolved).toBe(true);
    const moved = await s.t.request(`${base}/${n.id}/reattach`, {
      cookies,
      body: { blockId: g.blocks[3] },
    });
    expect((moved.body as { note: MarginNote }).note.blockId).toBe(g.blocks[3]);

    // A read-write key reads, and is told in plain words that it cannot write.
    const key = s.key(u.id, "write").secret;
    expect(
      ((await s.t.request(base, { bearer: key })).body as { items: unknown[] }).items,
    ).toHaveLength(1);
    const refused = await s.t.request(base, {
      bearer: key,
      body: { blockId: g.blocks[1], text: "From an agent" },
    });
    expect(refused.status).toBe(403);
    expect(JSON.stringify(refused.body)).toContain("an agent can read them, not write them");
    for (const [path, method, body] of [
      [`${base}/${n.id}`, "PATCH", { resolved: false }],
      [`${base}/${n.id}`, "DELETE", undefined],
      [`${base}/${n.id}/reattach`, "POST", { blockId: g.blocks[1] }],
    ] as const) {
      const r = await s.t.request(path, { bearer: key, method, ...(body ? { body } : {}) });
      expect(errorCode(r.body), `${method} ${path}`).toBe("forbidden");
    }
    const reader = s.key(u.id, "read").secret;
    expect(
      errorCode(
        (await s.t.request(base, { bearer: reader, body: { blockId: g.blocks[1], text: "x" } }))
          .body,
      ),
    ).toBe("read_only_key");

    // Another person's session sees no such document.
    await s.user("bob");
    const bob = await s.t.signIn("bob", "correct horse battery");
    expect((await s.t.request(base, { cookies: bob.cookies })).status).toBe(404);
    expect(
      (await s.t.request(`${base}/${n.id}`, { cookies: bob.cookies, method: "DELETE" })).status,
    ).toBe(404);

    const del = await s.t.request(`${base}/${n.id}`, { cookies, method: "DELETE" });
    expect(del.status).toBe(204);
    expect(((await s.t.request(base, { cookies })).body as { items: unknown[] }).items).toEqual([]);
  });
});

describe("MCP side_notes tool", () => {
  it("lists a document's notes and her open ones across documents; it offers no write", async () => {
    const s = await realSetup();
    const a = await s.agent();
    const she = userAuth(a.user.id);
    const g = guide(s.services, a.user.id);
    const h = guide(s.services, a.user.id, "Hypertension");
    const m = s.services.marginNotes;
    const late = m.create(she, g.documentId, {
      blockId: g.blocks[3],
      text: "Why not in asthma?\nAsk the professor",
      colour: "pink",
    });
    const early = m.create(she, g.documentId, {
      blockId: g.blocks[1],
      text: "On the quiz",
      quote: "low doses",
    });
    const done = m.create(she, g.documentId, { blockId: g.blocks[1], text: "Got it" });
    m.update(she, g.documentId, done.id, { resolved: true });
    const elsewhere = m.create(she, h.documentId, {
      blockId: h.blocks[2],
      text: "Lisinopril cough?",
    });

    const listed = await a.ok("side_notes", { action: "list", documentId: g.documentId });
    const items = listed.structured.items as Array<{ id: string; blockType: string | null }>;
    // Open first, in block order; the resolved one last.
    expect(items.map((x) => x.id)).toEqual([early.id, late.id, done.id]);
    expect(items[0]?.blockType).toBe("paragraph");
    expect(listed.text).toContain("2 open");
    expect(listed.text).toContain('about the words "low doses"');
    expect(listed.text).toContain("Why not in asthma? / Ask the professor");

    const recent = await a.ok("side_notes", { action: "recent" });
    expect((recent.structured.items as Array<{ id: string }>).map((x) => x.id)).toEqual([
      elsewhere.id,
      early.id,
      late.id,
    ]);
    expect(recent.text).toContain('in "Hypertension"');

    const nope = await a.fail("side_notes", { action: "add", documentId: g.documentId, text: "x" });
    expect(nope.error.code).toBe("invalid_input");
    expect(
      (await a.fail("side_notes", { action: "list", documentId: newId("document") })).error.code,
    ).toBe("not_found");
    const found = await a.ok("search_notes", { query: "lisinopril", kinds: ["margin_note"] });
    expect(found.text).toContain("side note");

    const { tools } = await a.client.listTools();
    const tool = tools.find((x) => x.name === "side_notes");
    expect(tool?.annotations?.readOnlyHint).toBe(true);
    expect(tool?.description).toMatch(/cannot create, edit or delete them/);
    const reader = await s.agent("hannah", "read");
    expect((await reader.ok("side_notes", { action: "recent" })).structured.items).toHaveLength(3);
  });
});
