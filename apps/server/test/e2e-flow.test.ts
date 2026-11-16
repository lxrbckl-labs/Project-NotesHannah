import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { blockPlainText, CreatedApiKey } from "@notes/schema";
import { describe, expect, it } from "vitest";
import { createServices } from "../src/services.js";
import { initStorage } from "../src/storage/storage.js";
import { FakeConverter, type Json, PDF, variant } from "./files.support.js";
import { makeTestApp, ORIGIN } from "./helpers.js";

const PW = "correct horse battery";

const SLIDE_1 = "Beta blockers end in -olol. Atenolol and metoprolol are cardioselective.";
const SLIDE_2 = "Propranolol is nonselective and crosses the blood-brain barrier.";
const SLIDE_3 = "Never stop a beta blocker abruptly: rebound tachycardia.";

/**
 * One whole working day through the real composed app: the HTTP routes, the services wired
 * as `index.ts` wires them, a temporary storage directory and a fake converter that plays
 * the queue protocol. Nothing is mocked inside the server.
 */
describe("end to end: from upload to study guide and back through the trash", () => {
  it("the whole flow", async () => {
    const dir = mkdtempSync(join(tmpdir(), "notes-e2e-"));
    const { storage } = initStorage(dir);
    const t = makeTestApp({
      env: { DATA_DIR: dir, APP_ORIGIN: ORIGIN },
      services: (deps) =>
        createServices(deps, {
          files: { storage, signingSecret: "e2e-secret", partialGraceMs: 0, log: () => {} },
        }),
    });
    const services = t.services;
    if (!services) throw new Error("services");
    const converter = new FakeConverter(storage.root);

    const hannah = await t.addUser("hannah", PW);
    await t.addUser("sam", PW);
    const she = (await t.signIn("hannah", PW)).cookies;
    const sam = (await t.signIn("sam", PW)).cookies;

    const as = {
      user: (
        method: string,
        path: string,
        body?: unknown,
        cookies: Record<string, string> = she,
      ): Promise<{ status: number; body: Json }> =>
        t.request(path, { method, cookies, ...(body === undefined ? {} : { body }) }),
      agent: (method: string, path: string, body?: unknown) =>
        t.request(path, {
          method,
          bearer: agentKey,
          origin: null,
          ...(body === undefined ? {} : { body }),
        }),
    };
    const ok = async (res: Promise<{ status: number; body: Json }>, status = 200) => {
      const got = await res;
      expect(got.status, JSON.stringify(got.body)).toBe(status);
      return got.body;
    };

    // ---- she builds the spine: term, course, lecture ----------------------------------
    const { node: term } = await ok(
      as.user("POST", "/api/nodes", { parentId: null, kind: "term", name: "Fall 2026" }),
      201,
    );
    const { node: course } = await ok(
      as.user("POST", "/api/nodes", {
        parentId: term.id,
        kind: "course",
        name: "Pharmacology II",
        course: { code: "PHAR 7340" },
      }),
      201,
    );
    const sections = (await ok(as.user("GET", `/api/nodes?parentId=${course.id}`))).items;
    const lecturesSection = sections.find((s: Json) => s.section === "lectures");
    const { node: lecture } = await ok(
      as.user("POST", "/api/nodes", {
        parentId: lecturesSection.id,
        kind: "lecture",
        name: "Beta blockers",
        lecture: { number: 7, date: "2026-10-14" },
      }),
      201,
    );

    // ---- she gives the agent a write key; the agent uploads through a ticket -----------
    const created = CreatedApiKey.parse(
      await ok(as.user("POST", "/api/keys", { name: "Claude Code", scope: "write" }), 201),
    );
    const agentKey = created.secret;
    const bytes = variant(PDF, "e2e");
    const { items: tickets } = await ok(
      as.agent("POST", "/api/uploads/tickets", {
        files: [{ name: "beta-blockers.pdf", bytes: bytes.length }],
      }),
      201,
    );
    const putPath = new URL(tickets[0].url).pathname;
    const put = await t.app.request(putPath, {
      method: "PUT",
      body: bytes,
      duplex: "half",
    } as RequestInit);
    expect(put.status).toBe(201);
    const uploaded = ((await put.json()) as Json).file;
    expect(uploaded).toMatchObject({ status: "converting", nodeId: null });
    // The upload link works once.
    expect(
      (await t.app.request(putPath, { method: "PUT", body: bytes, duplex: "half" } as RequestInit))
        .status,
    ).toBe(409);

    // ---- the fake converter plays the queue protocol ----------------------------------
    const [jobId] = converter.pending();
    expect(jobId).toBeDefined();
    converter.succeed(jobId as string, { pages: 3, type: "pdf" });
    services.files.processQueue();
    const file = (await ok(as.agent("GET", `/api/files/${uploaded.id}`))).file;
    expect(file).toMatchObject({ status: "converted", pageCount: 3 });
    const pages = (await ok(as.agent("GET", `/api/files/${file.id}/pages`))).items;
    expect(pages.map((p: Json) => p.index)).toEqual([1, 2, 3]);
    // It is in the inbox, waiting.
    const inbox = await ok(as.user("GET", "/api/files?inbox=true"));
    expect(inbox.items.map((f: Json) => f.id)).toEqual([file.id]);

    // ---- the agent transcribes, then files the source under the lecture ----------------
    for (const [i, text] of [SLIDE_1, SLIDE_2, SLIDE_3].entries()) {
      await ok(as.agent("PUT", `/api/pages/${pages[i].id}/transcript`, { text, flags: [] }), 201);
    }
    expect((await ok(as.agent("GET", `/api/files/${file.id}`))).file.status).toBe("transcribed");
    const filed = (await ok(as.agent("POST", `/api/files/${file.id}/file`, { nodeId: lecture.id })))
      .file;
    expect(filed).toMatchObject({ status: "filed", nodeId: lecture.id });

    // ---- the agent writes the document on the lecture, citing real quotes --------------
    const cite = (page: number, quote: string) => ({
      fileId: file.id,
      pageId: pages[page - 1].id,
      quote,
      label: `Slide ${page}`,
    });
    const para = (text: string, citations: unknown[]) => ({
      type: "paragraph",
      content: { text },
      citations,
    });
    const made = await ok(
      as.agent("POST", "/api/documents", {
        nodeId: lecture.id,
        kind: "lecture_note",
        title: "Beta blockers",
        blocks: [
          { type: "heading", content: { level: 1, text: "Beta blockers" } },
          para("Atenolol and metoprolol are cardioselective.", [
            cite(1, "Atenolol and metoprolol are cardioselective."),
          ]),
          para("Propranolol is nonselective.", [cite(2, "Propranolol is nonselective")]),
          para("Never stop one abruptly.", [cite(3, "rebound tachycardia")]),
        ],
      }),
      201,
    );
    const documentId = made.documentId as string;
    const [, selective, nonselective, abruptly] = made.blockIds as string[];

    // A citation with a quote that is not on the page is refused, and nothing is written.
    const invented = await as.agent("POST", `/api/documents/${documentId}/blocks`, {
      blocks: [para("Invented.", [cite(1, "Metoprolol cures everything")])],
    });
    expect(invented.status).toBe(400);
    expect(JSON.stringify(invented.body)).toContain("does not occur");

    // ---- references resolve to file names and page numbers -----------------------------
    const refs = (await ok(as.user("GET", `/api/documents/${documentId}/references`))).items;
    expect(refs).toHaveLength(3);
    expect(refs.map((r: Json) => [r.fileName, r.pageIndex, r.status, r.quoteStillPresent])).toEqual(
      [
        ["beta-blockers.pdf", 1, "available", true],
        ["beta-blockers.pdf", 2, "available", true],
        ["beta-blockers.pdf", 3, "available", true],
      ],
    );

    // ---- reverse lookup from the page lists the citing block ---------------------------
    const back = await ok(as.user("GET", `/api/pages/${pages[0].id}/citations`));
    expect(back.items).toHaveLength(1);
    expect(back.items[0]).toMatchObject({
      documentId,
      blockId: selective,
      title: "Beta blockers",
      nodeId: lecture.id,
      trashed: false,
    });
    expect((await ok(as.user("GET", `/api/files/${file.id}/citations`))).items).toHaveLength(3);

    // ---- search finds the node, the transcript page and the block ----------------------
    const hits = (await ok(as.user("GET", "/api/search?q=beta"))).items as Json[];
    expect(hits.map((h) => h.kind)).toEqual(expect.arrayContaining(["node", "page", "block"]));
    expect(hits.find((h) => h.kind === "node")).toMatchObject({
      node: { id: lecture.id, name: "Beta blockers" },
    });
    const pageHit = hits.find((h) => h.kind === "page" && h.pageIndex === 1);
    expect(pageHit).toMatchObject({
      pageId: pages[0].id,
      fileName: "beta-blockers.pdf",
      nodeId: lecture.id,
    });
    const cardio = (await ok(as.user("GET", "/api/search?q=cardioselective"))).items as Json[];
    expect(cardio.map((h) => h.kind).sort()).toEqual(["block", "page"]);
    expect(cardio.find((h) => h.kind === "block")).toMatchObject({
      documentId,
      blockId: selective,
      documentTitle: "Beta blockers",
    });
    const onlyPages = (await ok(as.user("GET", "/api/search?q=beta&kinds=page"))).items as Json[];
    expect(onlyPages.every((h) => h.kind === "page")).toBe(true);

    // ---- she edits one block and reviews another ---------------------------------------
    const light = await ok(as.user("GET", `/api/documents/${documentId}`));
    await ok(
      as.user("PATCH", `/api/documents/${documentId}/blocks/${nonselective}`, {
        patch: { content: { text: "Propranolol is nonselective (hers)." } },
        expectedRevision: light.document.revision,
      }),
    );
    const afterEdit = await ok(as.user("GET", `/api/documents/${documentId}`));
    await ok(
      as.user("POST", `/api/documents/${documentId}/review`, {
        status: "reviewed",
        blockIds: [abruptly],
        expectedRevision: afterEdit.document.revision,
      }),
    );

    // ---- the agent regenerates; her blocks survive --------------------------------------
    const regenerated = await ok(
      as.agent("POST", `/api/documents/${documentId}/regenerate`, {
        blocks: [
          { type: "heading", content: { level: 1, text: "Beta blockers, again" } },
          para("Regenerated cardioselective summary.", [
            cite(1, "Atenolol and metoprolol are cardioselective."),
          ]),
        ],
      }),
    );
    expect(regenerated.skipped.map((s: Json) => [s.blockId, s.reason]).sort()).toEqual(
      [
        [nonselective, "user_edited"],
        [abruptly, "reviewed"],
      ].sort(),
    );
    expect(regenerated.removed).toEqual(expect.arrayContaining([selective]));
    const content = await ok(as.user("GET", `/api/documents/${documentId}/content`));
    const byId = new Map(content.blocks.map((b: Json) => [b.id, b]));
    expect(byId.get(nonselective)).toMatchObject({ origin: "user" });
    expect(blockPlainText(byId.get(nonselective) as never)).toBe(
      "Propranolol is nonselective (hers).",
    );
    expect(byId.get(abruptly)).toMatchObject({ review: { status: "reviewed" } });
    expect(byId.has(selective)).toBe(false);
    expect(content.blocks.map((b: Json) => blockPlainText(b))).toEqual(
      expect.arrayContaining(["Regenerated cardioselective summary."]),
    );
    // An agent cannot simply overwrite one of hers.
    const refused = await as.agent("DELETE", `/api/documents/${documentId}/blocks/${nonselective}`);
    expect([404, 405]).toContain(refused.status);
    const refusedDelete = await as.agent("POST", `/api/documents/${documentId}/blocks/delete`, {
      blockIds: [nonselective],
    });
    expect(refusedDelete.status).toBe(403);

    // ---- the source file goes to the trash: the citation reads unavailable --------------
    await ok(as.user("POST", `/api/files/${file.id}/trash`));
    const trashedRefs = (await ok(as.user("GET", `/api/documents/${documentId}/references`)))
      .items as Json[];
    expect(trashedRefs.length).toBeGreaterThan(0);
    for (const ref of trashedRefs) {
      expect(ref).toMatchObject({ status: "source_trashed", unavailable: true });
      expect(ref.fileName).toBe("beta-blockers.pdf");
    }
    // The document still loads, and her blocks are all there.
    expect((await as.user("GET", `/api/documents/${documentId}`)).status).toBe(200);
    expect((await as.user("GET", `/api/documents/${documentId}/content`)).status).toBe(200);
    // A trashed page is out of the search.
    const withoutPages = (await ok(as.user("GET", "/api/search?q=cardioselective")))
      .items as Json[];
    expect(withoutPages.map((h) => h.kind)).toEqual(["block"]);
    await ok(as.user("POST", `/api/files/${file.id}/restore`));
    expect(
      ((await ok(as.user("GET", `/api/documents/${documentId}/references`))).items as Json[]).every(
        (r) => r.status === "available",
      ),
    ).toBe(true);

    // ---- the lecture goes to the trash: document gone from search, file back in the inbox
    await ok(as.user("POST", `/api/nodes/${lecture.id}/trash`));
    expect((await as.user("GET", `/api/documents/${documentId}`)).status).toBe(404);
    expect((await as.user("GET", `/api/nodes/${lecture.id}/document`)).status).toBe(404);
    const afterTrash = (await ok(as.user("GET", "/api/search?q=cardioselective"))).items as Json[];
    expect(afterTrash.map((h) => h.kind)).toEqual(["page"]);
    expect(afterTrash[0]).toMatchObject({ nodeId: null });
    expect((await ok(as.user("GET", "/api/search?q=beta&kinds=node,block"))).items).toEqual([]);
    const unfiled = (await ok(as.user("GET", `/api/files/${file.id}`))).file;
    expect(unfiled).toMatchObject({ nodeId: null, status: "transcribed", trashedAt: null });
    const inboxNow = await ok(as.user("GET", "/api/files?inbox=true"));
    expect(inboxNow.items.map((f: Json) => f.id)).toEqual([file.id]);
    // Nothing was deleted: the original still downloads, the transcripts are there.
    const original = await t.request(`/api/files/${file.id}/original`, { cookies: she });
    expect(original.status).toBe(200);
    expect((await ok(as.user("GET", `/api/pages/${pages[0].id}/transcript`))).transcript.text).toBe(
      SLIDE_1,
    );
    // The page's reverse lookup now says the citing document is in the trash.
    const trashedBack = await ok(as.user("GET", `/api/pages/${pages[0].id}/citations`));
    expect(trashedBack.items.every((i: Json) => i.trashed)).toBe(true);

    // ---- restore: it all comes back ----------------------------------------------------
    await ok(as.user("POST", `/api/nodes/${lecture.id}/restore`));
    const back2 = await ok(as.user("GET", `/api/documents/${documentId}/content`));
    expect(back2.blocks.map((b: Json) => b.id)).toEqual(content.blocks.map((b: Json) => b.id));
    expect(
      ((await ok(as.user("GET", "/api/search?q=cardioselective"))).items as Json[])
        .map((h) => h.kind)
        .sort(),
    ).toEqual(["block", "page"]);
    expect(
      ((await ok(as.user("GET", "/api/search?q=beta&kinds=node"))).items as Json[]).map(
        (h) => h.node.id,
      ),
    ).toEqual([lecture.id]);
    const refiled = (await ok(as.user("GET", `/api/files/${file.id}`))).file;
    expect(refiled).toMatchObject({ nodeId: lecture.id, status: "filed" });
    expect((await ok(as.user("GET", "/api/files?inbox=true"))).items).toEqual([]);
    const backlinks = await ok(as.user("GET", `/api/pages/${pages[0].id}/citations`));
    expect(backlinks.items.some((i: Json) => i.trashed)).toBe(false);

    // ---- the activity log lists the agent's actions, and none of hers ------------------
    const activity = (await ok(as.user("GET", "/api/activity?limit=200"))).items as Json[];
    const words = activity.map((a) => a.summary as string);
    expect(words).toContain("Uploaded beta-blockers.pdf");
    expect(words).toContain("Transcribed page 1 of beta-blockers.pdf");
    expect(words).toContain("Transcribed page 3 of beta-blockers.pdf");
    expect(words).toContain("Filed beta-blockers.pdf under lecture 07 · Beta blockers");
    expect(words.some((w) => w.startsWith("Beta blockers: Created"))).toBe(true);
    expect(words.some((w) => w.includes("Regenerated"))).toBe(true);
    for (const entry of activity) {
      expect(entry.keyId).toBe(created.key.id);
    }
    // None of hers: no term or course, no edit, no review, no trashing.
    const everything = words.join("\n");
    for (const hers of ["Fall 2026", "Pharmacology II", "trash", "Restored", "reviewed"]) {
      expect(everything, hers).not.toContain(hers);
    }
    // The change feed, by contrast, has both of them, and hers carry her as the actor.
    const feed = (await ok(as.user("GET", "/api/changes?limit=500"))).items as Json[];
    const actions = new Set(feed.map((c) => c.action));
    for (const action of [
      "node.created",
      "node.trashed",
      "node.restored",
      "file.uploaded",
      "file.converted",
      "file.filed",
      "file.unfiled",
      "transcript.saved",
      "document.created",
      "document.updated",
      "document.reviewed",
      "document.trashed",
      "document.restored_from_trash",
    ]) {
      expect(actions, action).toContain(action);
    }
    expect(feed.find((c) => c.action === "node.trashed")?.actor).toEqual({
      type: "user",
      userId: hannah.id,
    });
    expect(feed.find((c) => c.action === "transcript.saved")?.actor).toMatchObject({
      type: "agent",
      keyId: created.key.id,
    });

    // ---- a second user sees none of it --------------------------------------------------
    const bob = (path: string) => as.user("GET", path, undefined, sam);
    expect((await ok(bob("/api/nodes"))).items).toEqual([]);
    expect((await ok(bob("/api/search?q=beta"))).items).toEqual([]);
    expect((await ok(bob("/api/activity"))).items).toEqual([]);
    expect((await ok(bob("/api/changes"))).items).toEqual([]);
    expect((await ok(bob("/api/files"))).items).toEqual([]);
    expect((await ok(bob("/api/trash"))).items).toEqual([]);
    for (const path of [
      `/api/documents/${documentId}`,
      `/api/documents/${documentId}/references`,
      `/api/pages/${pages[0].id}/citations`,
      `/api/pages/${pages[0].id}/transcript`,
      `/api/files/${file.id}`,
      `/api/files/${file.id}/pages`,
      `/api/nodes/${lecture.id}`,
    ]) {
      expect((await bob(path)).status, path).toBe(404);
    }
  });
});
