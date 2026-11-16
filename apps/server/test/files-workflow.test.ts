import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { createFilesService } from "../src/domains/files/index.js";
import { harness, type Json, listDir, PDF, PPTX, variant, WEBP } from "./files.support.js";

type H = ReturnType<typeof harness>;

const save = (h: H, who: Json, pageId: string, text: string, flags: Json[] = []) =>
  h.call(who, "PUT", `/api/pages/${pageId}/transcript`, { text, flags });

async function transcribeAll(h: H, who: Json, pages: Json[]) {
  for (const p of pages) expect((await save(h, who, p.id, `text of ${p.index}`)).status).toBe(201);
}

describe("state machine", () => {
  test("uploaded → converting → converted → transcribed → filed, and back to transcribed when unfiled", async () => {
    const h = harness();
    const { file, pages } = await h.converted(h.alice, undefined, 2);
    expect(file.status).toBe("converted");
    const lecture = h.lecture(h.alice);

    // one transcript is not enough
    await save(h, h.alice, (pages[0] as Json).id, "first");
    expect((await h.call(h.alice, "GET", `/api/files/${file.id}`)).body.file.status).toBe(
      "converted",
    );
    await save(h, h.alice, (pages[1] as Json).id, "second");
    expect((await h.call(h.alice, "GET", `/api/files/${file.id}`)).body.file.status).toBe(
      "transcribed",
    );

    const filed = await h.call(h.alice, "POST", `/api/files/${file.id}/file`, { nodeId: lecture });
    expect(filed.body.file).toMatchObject({ status: "filed", nodeId: lecture });
    // filed files leave the inbox
    expect((await h.call(h.alice, "GET", "/api/files?inbox=true")).body.items).toHaveLength(0);
    expect((await h.call(h.alice, "GET", `/api/files?nodeId=${lecture}`)).body.items).toHaveLength(
      1,
    );

    const back = await h.call(h.alice, "POST", `/api/files/${file.id}/file`, { nodeId: null });
    expect(back.body.file).toMatchObject({ status: "transcribed", nodeId: null });
    expect((await h.call(h.alice, "GET", "/api/files?inbox=true")).body.items).toHaveLength(1);
  });

  test("filing before transcription records the node but the status stays converted until the work is done", async () => {
    const h = harness();
    const lecture = h.lecture(h.alice);
    const { file, pages } = await h.converted(h.alice, undefined, 1);
    const res = await h.call(h.alice, "POST", `/api/files/${file.id}/file`, { nodeId: lecture });
    expect(res.body.file).toMatchObject({ status: "converted", nodeId: lecture });
    await transcribeAll(h, h.alice, pages);
    expect((await h.call(h.alice, "GET", `/api/files/${file.id}`)).body.file.status).toBe("filed");
  });

  test("a file filed at upload that fails or is still converting keeps its node and its status", async () => {
    const h = harness();
    const lecture = h.lecture(h.alice);
    const up = await h.upload(h.alice, PDF, "a.pdf", [{ name: "nodeId", data: lecture }]);
    expect(up).toMatchObject({ status: "converting", nodeId: lecture });
    h.converter.fail(h.converter.pending()[0] as string, "corrupt_file");
    h.service.processQueue();
    expect((await h.call(h.alice, "GET", `/api/files/${up.id}`)).body.file).toMatchObject({
      status: "failed",
      nodeId: lecture,
    });
  });

  test("deleting the lecture in the library puts a filed file back in the inbox as transcribed", async () => {
    const h = harness();
    const lecture = h.lecture(h.alice);
    const { file, pages } = await h.converted(h.alice, undefined, 1);
    await transcribeAll(h, h.alice, pages);
    await h.call(h.alice, "POST", `/api/files/${file.id}/file`, { nodeId: lecture });
    h.library.trash(h.alice, lecture);
    h.library.permanentDelete(h.alice, lecture);
    expect((await h.call(h.alice, "GET", `/api/files/${file.id}`)).body.file).toMatchObject({
      status: "transcribed",
      nodeId: null,
    });
  });

  test("refusals: wrong states and wrong targets explain themselves", async () => {
    const h = harness();
    const up = await h.upload(h.alice, PDF);
    // not converted yet: no claim, no pages, no transcript
    const claim = await h.call(h.agent(h.alice), "POST", `/api/files/${up.id}/claim`);
    expect(claim.status).toBe(409);
    expect(claim.body.error.hint).toBeTruthy();
    expect((await h.call(h.alice, "GET", `/api/files/${up.id}/pages`)).body.items).toEqual([]);

    const { file } = await h.converted(h.alice);
    // a converted file cannot be retried
    expect((await h.call(h.alice, "POST", `/api/files/${file.id}/retry`)).body.error.code).toBe(
      "conflict",
    );
    // filing needs a real, live, suitable node
    h.lecture(h.alice, "L1");
    const term = h.library.list(h.alice, {}).items[0] as Json;
    expect(
      (await h.call(h.alice, "POST", `/api/files/${file.id}/file`, { nodeId: term.id })).body.error
        .code,
    ).toBe("invalid_input");
    expect(
      (await h.call(h.alice, "POST", `/api/files/${file.id}/file`, { nodeId: "nope" })).body.error
        .code,
    ).toBe("invalid_input");
    expect(
      (await h.call(h.alice, "POST", `/api/files/${file.id}/file`, {})).body.error.example,
    ).toBeTruthy();
    const lecture = h.lecture(h.alice, "L2");
    h.library.trash(h.alice, lecture);
    expect(
      (await h.call(h.alice, "POST", `/api/files/${file.id}/file`, { nodeId: lecture })).body.error
        .message,
    ).toMatch(/trash/);
    expect(
      (await h.call(h.alice, "POST", `/api/files/${file.id}/file`, { nodeId: h.lecture(h.bob) }))
        .body.error.code,
    ).toBe("not_found");
    // the Sources section of a course is a valid place
    const course = h.library.list(h.alice, { parentId: term.id }).items[0] as Json;
    const sources = h.library
      .list(h.alice, { parentId: course.id })
      .items.find((n: Json) => n.section === "sources") as Json;
    expect(
      (await h.call(h.alice, "POST", `/api/files/${file.id}/file`, { nodeId: sources.id })).status,
    ).toBe(200);
  });
});

describe("inbox listing", () => {
  test("filters, trash and paging", async () => {
    const h = harness();
    const a = (await h.converted(h.alice)).file;
    const b = (await h.converted(h.alice)).file;
    const c = await h.upload(h.alice, variant(PDF, "up"));
    const all = await h.call(h.alice, "GET", "/api/files");
    expect(all.body.items.map((f: Json) => f.id)).toEqual([c.id, b.id, a.id].sort().reverse());
    expect((await h.call(h.alice, "GET", "/api/files?status=converted")).body.items).toHaveLength(
      2,
    );
    expect((await h.call(h.alice, "GET", "/api/files?status=converting")).body.items).toHaveLength(
      1,
    );
    expect((await h.call(h.alice, "GET", "/api/files?status=bogus")).body.error.code).toBe(
      "invalid_input",
    );

    const page1 = await h.call(h.alice, "GET", "/api/files?limit=2");
    expect(page1.body.items).toHaveLength(2);
    const page2 = await h.call(
      h.alice,
      "GET",
      `/api/files?limit=2&cursor=${page1.body.nextCursor}`,
    );
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.nextCursor).toBeNull();
    expect((await h.call(h.alice, "GET", "/api/files?cursor=garbage")).body.error.code).toBe(
      "invalid_input",
    );

    await h.call(h.alice, "POST", `/api/files/${a.id}/trash`);
    expect((await h.call(h.alice, "GET", "/api/files")).body.items).toHaveLength(2);
    expect(
      (await h.call(h.alice, "GET", "/api/files?trashed=true")).body.items.map((f: Json) => f.id),
    ).toEqual([a.id]);
    // a trashed file refuses changes until restored
    expect((await h.call(h.alice, "POST", `/api/files/${a.id}/claim`)).body.error.code).toBe(
      "conflict",
    );
    expect(
      (await h.call(h.alice, "POST", `/api/files/${a.id}/file`, { nodeId: null })).body.error.code,
    ).toBe("conflict");
    expect(
      (await h.call(h.alice, "POST", `/api/files/${a.id}/restore`)).body.file.trashedAt,
    ).toBeNull();
    expect((await h.call(h.alice, "GET", "/api/files")).body.items).toHaveLength(3);
  });
});

describe("claims", () => {
  test("a claim records the actor, blocks other agents, expires, and can be released", async () => {
    const h = harness({ claimTtlMs: 10 * 60_000 });
    const { file, pages } = await h.converted(h.alice, undefined, 1);
    const one = h.agent(h.alice, "key_01HZX3K9Q2V7M4N8P6R5T0W1Y1");
    const two = h.agent(h.alice, "key_01HZX3K9Q2V7M4N8P6R5T0W1Y2");

    const claimed = await h.call(one, "POST", `/api/files/${file.id}/claim`);
    expect(claimed.status).toBe(200);
    expect(claimed.body.file.claimedBy).toMatchObject({
      type: "agent",
      keyId: "key_01HZX3K9Q2V7M4N8P6R5T0W1Y1",
    });
    expect(claimed.body.file.claimedAt).toBe(new Date(h.clock.now()).toISOString());

    const other = await h.call(two, "POST", `/api/files/${file.id}/claim`);
    expect(other.status).toBe(409);
    expect(other.body.error.hint).toMatch(/claim ends at/);
    // the other agent cannot write transcripts or release; the owner of the account can
    expect((await save(h, two, (pages[0] as Json).id, "x")).body.error.code).toBe("conflict");
    expect((await h.call(two, "POST", `/api/files/${file.id}/release`)).body.error.code).toBe(
      "conflict",
    );
    expect((await save(h, h.alice, (pages[0] as Json).id, "by her")).status).toBe(201);
    // the claimant renews
    h.clock.advance(5 * 60_000);
    await h.call(one, "POST", `/api/files/${file.id}/claim`);
    h.clock.advance(9 * 60_000);
    expect((await h.call(one, "GET", `/api/files/${file.id}`)).body.file.claimedBy).not.toBeNull();

    // a crashed agent does not block forever
    h.clock.advance(2 * 60_000);
    const after = await h.call(two, "GET", `/api/files/${file.id}`);
    expect(after.body.file).toMatchObject({ claimedBy: null, claimedAt: null });
    expect((await h.call(two, "POST", `/api/files/${file.id}/claim`)).status).toBe(200);

    // release by the holder, idempotent
    expect(
      (await h.call(two, "POST", `/api/files/${file.id}/release`)).body.file.claimedBy,
    ).toBeNull();
    expect((await h.call(two, "POST", `/api/files/${file.id}/release`)).status).toBe(200);
    // she can free a claim from the browser
    await h.call(one, "POST", `/api/files/${file.id}/claim`);
    expect(
      (await h.call(h.alice, "POST", `/api/files/${file.id}/release`)).body.file.claimedBy,
    ).toBeNull();
  });
});

describe("trash and permanent delete", () => {
  test("only a trashed file, only by the browser session; images, rows and the original go", async () => {
    const h = harness();
    const { file, pages } = await h.converted(h.alice, undefined, 2);
    await save(h, h.alice, (pages[0] as Json).id, "searchable zebra");
    const original = join(h.dir, "originals", h.alice, file.sha256);
    const images = join(h.dir, "pages", h.alice, file.id);
    expect(existsSync(original) && existsSync(images)).toBe(true);

    const live = await h.call(h.alice, "DELETE", `/api/files/${file.id}`);
    expect(live.status).toBe(409);
    expect(live.body.error.example).toEqual({
      method: "POST",
      path: `/api/files/${file.id}/trash`,
    });
    await h.call(h.alice, "POST", `/api/files/${file.id}/trash`);
    expect(
      (await h.call(h.agent(h.alice), "DELETE", `/api/files/${file.id}`)).body.error.code,
    ).toBe("forbidden");
    expect(existsSync(original)).toBe(true);

    expect((await h.call(h.alice, "DELETE", `/api/files/${file.id}`)).status).toBe(204);
    expect(existsSync(original)).toBe(false);
    expect(existsSync(images)).toBe(false);
    expect((await h.call(h.alice, "GET", `/api/files/${file.id}`)).status).toBe(404);
    for (const table of ["pages", "transcripts", "conversion_jobs", "transcripts_fts"]) {
      expect(h.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get(), table).toEqual({ n: 0 });
    }
  });

  test("the original is kept while another of the user's files uses the same bytes", async () => {
    const h = harness();
    const bytes = variant(PDF, "shared");
    const one = (await h.converted(h.alice, bytes)).file;
    const two = (await h.converted(h.alice, bytes)).file;
    const theirs = (await h.converted(h.bob, bytes)).file;
    const original = join(h.dir, "originals", h.alice, one.sha256);
    expect(two.sha256).toBe(one.sha256);

    await h.call(h.alice, "POST", `/api/files/${one.id}/trash`);
    await h.call(h.alice, "DELETE", `/api/files/${one.id}`);
    expect(existsSync(original)).toBe(true);
    expect(existsSync(join(h.dir, "pages", h.alice, one.id))).toBe(false);
    expect(existsSync(join(h.dir, "pages", h.alice, two.id))).toBe(true);
    // the second file still serves its original
    expect((await h.send(h.alice, "GET", `/api/files/${two.id}/original`, {})).status).toBe(200);

    await h.call(h.alice, "POST", `/api/files/${two.id}/trash`);
    await h.call(h.alice, "DELETE", `/api/files/${two.id}`);
    expect(existsSync(original)).toBe(false);
    // another user's copy is a different file
    expect(existsSync(join(h.dir, "originals", h.bob, theirs.sha256))).toBe(true);
  });

  test("deleting a file that is still converting withdraws its queue file", async () => {
    const h = harness();
    const up = await h.upload(h.alice, PDF);
    await h.call(h.alice, "POST", `/api/files/${up.id}/trash`);
    await h.call(h.alice, "DELETE", `/api/files/${up.id}`);
    expect(h.converter.pending()).toEqual([]);
    expect(listDir(join(h.dir, "originals", h.alice))).toEqual([]);
  });
});

describe("transcripts", () => {
  test("every save is a new unverified revision by its author; earlier ones are kept and restorable", async () => {
    const h = harness();
    const { file, pages } = await h.converted(h.alice, undefined, 1);
    const page = (pages[0] as Json).id as string;
    expect((await h.call(h.alice, "GET", `/api/pages/${page}/transcript`)).body).toEqual({
      transcript: null,
    });

    const agent = h.agent(h.alice, "key_01HZX3K9Q2V7M4N8P6R5T0W1Y1");
    const r1 = await save(h, agent, page, "Metoprolol 50 mg", [
      { kind: "dose", quote: "50 mg", note: "check" },
    ]);
    expect(r1.status).toBe(201);
    expect(r1.body.transcript).toMatchObject({
      pageId: page,
      revision: 1,
      reviewStatus: "unverified",
      reviewedAt: null,
      text: "Metoprolol 50 mg",
      flags: [{ kind: "dose", quote: "50 mg", note: "check" }],
      author: { type: "agent", keyId: "key_01HZX3K9Q2V7M4N8P6R5T0W1Y1" },
    });
    h.clock.advance(1000);
    const r2 = await save(h, h.alice, page, "Metoprolol 25 mg");
    expect(r2.body.transcript).toMatchObject({
      revision: 2,
      author: { type: "user", userId: h.alice },
    });
    expect(
      (await h.call(h.alice, "GET", `/api/files/${file.id}/pages`)).body.items[0].transcriptId,
    ).toBe(r2.body.transcript.id);
    expect(
      (await h.call(h.alice, "GET", `/api/pages/${page}/transcript`)).body.transcript.revision,
    ).toBe(2);

    const history = await h.call(h.alice, "GET", `/api/pages/${page}/transcript/revisions`);
    expect(history.body.items.map((t: Json) => [t.revision, t.text])).toEqual([
      [2, "Metoprolol 25 mg"],
      [1, "Metoprolol 50 mg"],
    ]);
    const paged = await h.call(h.alice, "GET", `/api/pages/${page}/transcript/revisions?limit=1`);
    expect(paged.body.items).toHaveLength(1);
    const rest = await h.call(
      h.alice,
      "GET",
      `/api/pages/${page}/transcript/revisions?limit=1&cursor=${paged.body.nextCursor}`,
    );
    expect(rest.body.items[0].revision).toBe(1);
    expect(rest.body.nextCursor).toBeNull();

    // restoring revision 1 makes a new revision 3 with its text, flags and fresh review state
    const restored = await h.call(
      agent,
      "POST",
      `/api/pages/${page}/transcript/revisions/1/restore`,
    );
    expect(restored.status).toBe(201);
    expect(restored.body.transcript).toMatchObject({
      revision: 3,
      text: "Metoprolol 50 mg",
      flags: [{ kind: "dose", quote: "50 mg", note: "check" }],
      reviewStatus: "unverified",
    });
    expect(
      (await h.call(agent, "POST", `/api/pages/${page}/transcript/revisions/3/restore`)).body.error
        .code,
    ).toBe("conflict");
    expect(
      (await h.call(agent, "POST", `/api/pages/${page}/transcript/revisions/9/restore`)).body.error
        .code,
    ).toBe("not_found");
    expect(
      (await h.call(agent, "POST", `/api/pages/${page}/transcript/revisions/zero/restore`)).body
        .error.code,
    ).toBe("invalid_input");
  });

  test("a flag's quote must occur in the text; the error shows how", async () => {
    const h = harness();
    const { pages } = await h.converted(h.alice, undefined, 1);
    const page = (pages[0] as Json).id as string;
    const res = await save(h, h.alice, page, "Take 5 mg daily", [
      { kind: "dose", quote: "5 mg" },
      { kind: "unit", quote: "50 mg" },
      { kind: "decimal", quote: "0.5" },
    ]);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_input");
    expect(res.body.error.message).toMatch(/2 flags/);
    expect(res.body.error.hint).toContain('"50 mg"');
    expect(res.body.error.hint).toContain('"0.5"');
    expect(res.body.error.hint).not.toContain('"5 mg"');
    expect(res.body.error.example).toBeTruthy();
    // nothing was saved
    expect(
      (await h.call(h.alice, "GET", `/api/pages/${page}/transcript`)).body.transcript,
    ).toBeNull();
    // body problems are explained too
    const bad = await h.call(h.alice, "PUT", `/api/pages/${page}/transcript`, { text: 5 });
    expect(bad.body.error.code).toBe("invalid_input");
    expect(bad.body.error.example).toBeTruthy();
    const mismatch = await h.call(h.alice, "PUT", `/api/pages/${page}/transcript`, {
      pageId: "pag_01HZX3K9Q2V7M4N8P6R5T0W1YB",
      text: "x",
    });
    expect(mismatch.body.error.code).toBe("invalid_input");
    // an empty page is a legitimate transcript
    expect((await save(h, h.alice, page, "")).status).toBe(201);
  });

  test("only a browser session can mark a transcript reviewed; a new revision is unverified again", async () => {
    const h = harness();
    const { pages } = await h.converted(h.alice, undefined, 1);
    const page = (pages[0] as Json).id as string;
    const review = (who: Json, body?: Json) =>
      h.call(who, "POST", `/api/pages/${page}/transcript/review`, body ?? {});

    expect((await review(h.alice)).body.error.code).toBe("conflict"); // nothing to review yet
    await save(h, h.agent(h.alice), page, "Digoxin 0.125 mg");
    expect((await review(h.agent(h.alice))).body.error.code).toBe("forbidden");
    expect((await review({ user: h.alice, via: "key", scope: "read" })).body.error.code).toBe(
      "read_only_key",
    );
    expect(
      (await h.call(h.alice, "GET", `/api/pages/${page}/transcript`)).body.transcript.reviewStatus,
    ).toBe("unverified");

    const ok = await review(h.alice);
    expect(ok.body.transcript).toMatchObject({ reviewStatus: "reviewed", revision: 1 });
    expect(ok.body.transcript.reviewedAt).toBe(new Date(h.clock.now()).toISOString());
    await save(h, h.agent(h.alice), page, "Digoxin 0.125 mg (re-read)");
    expect(
      (await h.call(h.alice, "GET", `/api/pages/${page}/transcript`)).body.transcript,
    ).toMatchObject({
      revision: 2,
      reviewStatus: "unverified",
    });
    expect((await review(h.alice, { reviewed: true })).body.transcript.reviewStatus).toBe(
      "reviewed",
    );
    expect((await review(h.alice, { reviewed: false })).body.transcript).toMatchObject({
      reviewStatus: "unverified",
      reviewedAt: null,
    });
    expect((await review(h.alice, { reviewed: "yes" })).body.error.code).toBe("invalid_input");
  });

  test("a trashed file's transcript cannot be changed", async () => {
    const h = harness();
    const { file, pages } = await h.converted(h.alice, undefined, 1);
    await h.call(h.alice, "POST", `/api/files/${file.id}/trash`);
    expect((await save(h, h.alice, (pages[0] as Json).id, "x")).body.error.code).toBe("conflict");
  });
});

describe("search over transcripts", () => {
  test("finds the current text only, with snippets, scoped to the user", async () => {
    const h = harness();
    const { file, pages } = await h.converted(h.alice, undefined, 2);
    const mine = await h.converted(h.bob, undefined, 1);
    await save(h, h.alice, (pages[0] as Json).id, "Beta blockers reduce heart rate and renin");
    await save(h, h.alice, (pages[1] as Json).id, "Calcium channel blockers");
    await save(h, h.bob, (mine.pages[0] as Json).id, "Beta agonists in asthma");

    const hit = h.service.searchTranscripts(h.alice, "blockers");
    expect(hit.items.map((i) => [i.pageIndex, i.fileId])).toEqual(
      expect.arrayContaining([
        [1, file.id],
        [2, file.id],
      ]),
    );
    expect(hit.items[0]).toMatchObject({
      kind: "transcript",
      fileName: "lecture.pdf",
      nodeId: null,
    });
    expect(hit.items.find((i) => i.pageIndex === 1)?.snippet).toMatch(/blockers/);
    // prefix on the last word, and several words
    expect(h.service.searchTranscripts(h.alice, "beta bloc").items).toHaveLength(1);
    // isolation
    expect(h.service.searchTranscripts(h.alice, "agonists").items).toHaveLength(0);
    expect(h.service.searchTranscripts(h.bob, "agonists").items).toHaveLength(1);
    // a new revision replaces the indexed text
    await save(h, h.alice, (pages[0] as Json).id, "Something else entirely");
    expect(h.service.searchTranscripts(h.alice, "renin").items).toHaveLength(0);
    expect(h.service.searchTranscripts(h.alice, "entirely").items).toHaveLength(1);
    // junk is harmless
    for (const q of ['"', "AND OR NOT (", "***", "   ", "a\u0000b", "NEAR(x"]) {
      expect(() => h.service.searchTranscripts(h.alice, q)).not.toThrow();
    }
    // trash hides, restore shows
    await h.call(h.alice, "POST", `/api/files/${file.id}/trash`);
    expect(h.service.searchTranscripts(h.alice, "blockers").items).toHaveLength(0);
    await h.call(h.alice, "POST", `/api/files/${file.id}/restore`);
    expect(h.service.searchTranscripts(h.alice, "blockers").items).toHaveLength(1);
    // paging
    const first = h.service.searchTranscripts(h.alice, "e", { limit: 1 });
    expect(first.items.length).toBeLessThanOrEqual(1);
  });
});

describe("serving images and originals", () => {
  test("page images: type, disposition, cache headers, ETag and 304", async () => {
    const h = harness();
    const { pages, file } = await h.converted(h.alice, undefined, 2, 'we"ird\\name é.pdf');
    const page = pages[1] as Json;
    const res = await h.send(h.alice, "GET", `/api/pages/${page.id}/image`, {});
    expect(res.status).toBe(200);
    expect(res.raw.equals(WEBP)).toBe(true);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("cache-control")).toMatch(/^private,/);
    expect(res.headers.get("etag")).toMatch(/^"[0-9a-f-]+"$/);
    const disposition = res.headers.get("content-disposition") as string;
    expect(disposition).toMatch(/^inline; filename="[\x20-\x7e]+"; filename\*=UTF-8''/);
    expect(disposition.split("filename=")[1]?.split(";")[0]).not.toMatch(/[\\]|"[^;]*"[^;]*"/);
    expect(disposition).toContain("page%202.webp");
    const thumb = await h.send(h.alice, "GET", `/api/pages/${page.id}/image?size=thumb`, {});
    expect(thumb.headers.get("content-disposition")).toContain("thumb%202.webp");

    const etag = res.headers.get("etag") as string;
    const cached = await h.send(h.alice, "GET", `/api/pages/${page.id}/image`, {
      headers: { "if-none-match": etag },
    });
    expect(cached.status).toBe(304);
    expect(cached.raw.length).toBe(0);
    expect(
      (
        await h.send(h.alice, "GET", `/api/pages/${page.id}/image`, {
          headers: { "if-none-match": '"other"' },
        })
      ).status,
    ).toBe(200);
    const head = await h.send(h.alice, "HEAD", `/api/pages/${page.id}/image`, {});
    expect(head.status).toBe(200);
    expect(head.raw.length).toBe(0);
    expect(
      (await h.call(h.alice, "GET", `/api/pages/${page.id}/image?size=huge`)).body.error.code,
    ).toBe("invalid_input");
    expect((await h.call(h.alice, "GET", `/api/pages/${page.id}`)).body.page).toMatchObject({
      index: 2,
      fileId: file.id,
    });
  });

  test("originals: type, safe disposition, ETag = content hash, ranges", async () => {
    const h = harness();
    const data = Buffer.concat([PDF, Buffer.alloc(1000, 65)]);
    const { file } = await h.converted(h.alice, data, 1, "../../we\u0007ird\u0000 name.pdf");
    const url = `/api/files/${file.id}/original`;
    const full = await h.send(h.alice, "GET", url, {});
    expect(full.status).toBe(200);
    expect(full.raw.equals(data)).toBe(true);
    expect(full.headers.get("content-type")).toBe("application/pdf");
    expect(full.headers.get("accept-ranges")).toBe("bytes");
    expect(full.headers.get("etag")).toBe(`"${file.sha256}"`);
    expect(full.headers.get("cache-control")).toMatch(/^private,/);
    const cd = full.headers.get("content-disposition") as string;
    expect(cd).toMatch(/^inline; filename="[\x20-\x7e]+"/);
    expect(cd).not.toMatch(/[\r\n\\/]/);
    expect(full.headers.get("x-content-type-options")).toBe("nosniff");

    const part = await h.send(h.alice, "GET", url, { headers: { range: "bytes=5-14" } });
    expect(part.status).toBe(206);
    expect(part.raw.equals(data.subarray(5, 15))).toBe(true);
    expect(part.headers.get("content-range")).toBe(`bytes 5-14/${data.length}`);
    expect(part.headers.get("content-length")).toBe("10");
    const tail = await h.send(h.alice, "GET", url, { headers: { range: "bytes=-20" } });
    expect(tail.raw.equals(data.subarray(data.length - 20))).toBe(true);
    const open = await h.send(h.alice, "GET", url, {
      headers: { range: `bytes=${data.length - 3}-` },
    });
    expect(open.raw.length).toBe(3);
    const clamp = await h.send(h.alice, "GET", url, {
      headers: { range: `bytes=${data.length - 3}-999999` },
    });
    expect(clamp.headers.get("content-range")).toBe(
      `bytes ${data.length - 3}-${data.length - 1}/${data.length}`,
    );
    const bad = await h.send(h.alice, "GET", url, {
      headers: { range: `bytes=${data.length + 5}-` },
    });
    expect(bad.status).toBe(416);
    expect(bad.headers.get("content-range")).toBe(`bytes */${data.length}`);
    // junk or multi-range headers are ignored, the whole file is sent
    expect(
      (await h.send(h.alice, "GET", url, { headers: { range: "bytes=0-1,5-6" } })).status,
    ).toBe(200);
    expect((await h.send(h.alice, "GET", url, { headers: { range: "items=1-2" } })).status).toBe(
      200,
    );
    expect(
      (await h.send(h.alice, "GET", url, { headers: { "if-none-match": `"${file.sha256}"` } }))
        .status,
    ).toBe(304);
  });

  test("a presentation downloads as an attachment; ?download=true forces it for a pdf", async () => {
    const h = harness();
    const pptx = (await h.converted(h.alice, PPTX, 1, "deck.pptx")).file;
    const res = await h.send(h.alice, "GET", `/api/files/${pptx.id}/original`, {});
    expect(res.headers.get("content-type")).toContain("presentationml.presentation");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment;/);
    const pdf = (await h.converted(h.alice)).file;
    const forced = await h.send(h.alice, "GET", `/api/files/${pdf.id}/original?download=true`, {});
    expect(forced.headers.get("content-disposition")).toMatch(/^attachment;/);
  });
});

describe("signed image links", () => {
  test("work without credentials for five minutes, for exactly one page and size", async () => {
    const h = harness();
    const { pages } = await h.converted(h.alice, undefined, 2);
    const [p1, p2] = pages as Json[];
    const got = await h.call(h.agent(h.alice), "GET", `/api/pages/${p1.id}/image-url?size=thumb`);
    expect(got.status).toBe(200);
    expect(got.body.url).toMatch(
      /^http:\/\/localhost:5173\/api\/pages\/pag_[0-9A-Z]{26}\/image\?size=thumb&exp=\d+&sig=[A-Za-z0-9_-]+$/,
    );
    expect(Date.parse(got.body.expiresAt) - h.clock.now()).toBe(300_000);
    const url = new URL(got.body.url);
    const path = `${url.pathname}${url.search}`;

    const ok = await h.send(null, "GET", path, {});
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/webp");
    expect(ok.raw.equals(WEBP)).toBe(true);

    const tamper = (from: string, to: string) => h.send(null, "GET", path.replace(from, to), {});
    expect((await tamper("size=thumb", "size=page")).status).toBe(403);
    expect((await tamper(p1.id, p2.id)).status).toBe(403);
    expect(
      (
        await tamper(
          /exp=(\d+)/.exec(path)?.[0] as string,
          `exp=${Number(/exp=(\d+)/.exec(path)?.[1]) + 60}`,
        )
      ).status,
    ).toBe(403);
    const sig = /sig=([^&]+)/.exec(path)?.[1] as string;
    expect((await tamper(sig, `${sig.slice(0, -2)}AA`)).status).toBe(403);
    expect((await tamper(sig, "short")).status).toBe(403);
    expect((await h.send(null, "GET", path.replace(/&sig=.*/, ""), {})).body.error.code).toBe(
      "invalid_input",
    );
    expect(
      (await h.send(null, "GET", `/api/pages/${p1.id}/image?size=thumb`, {})).body.error.code,
    ).toBe("unauthenticated");

    // a link made under another secret is refused
    const other = createFilesService(
      {
        config: { DATA_DIR: h.dir, APP_ORIGIN: "http://localhost:5173" },
        db: h.db,
        now: h.clock.now,
      },
      { storage: h.storage, signingSecret: "different", log: () => {} },
    );
    const foreign = new URL(other.signedImageUrl(h.alice, p1.id, "thumb").url);
    expect((await h.send(null, "GET", `${foreign.pathname}${foreign.search}`, {})).status).toBe(
      403,
    );

    h.clock.advance(299_000);
    expect((await h.send(null, "GET", path, {})).status).toBe(200);
    h.clock.advance(2_000);
    const late = await h.send(null, "GET", path, {});
    expect(late.status).toBe(403);
    expect(late.body.error.hint).toMatch(/image-url/);
  });

  test("without a configured secret one is created once and kept", async () => {
    const h = harness({ signingSecret: undefined as never });
    const { pages } = await h.converted(h.alice, undefined, 1);
    const url = (await h.call(h.alice, "GET", `/api/pages/${(pages[0] as Json).id}/image-url`)).body
      .url as string;
    const path = `${new URL(url).pathname}${new URL(url).search}`;
    expect((await h.send(null, "GET", path, {})).status).toBe(200);
    expect(
      h.db.prepare("SELECT COUNT(*) AS n FROM app_meta WHERE key = 'files_signing_secret'").get(),
    ).toEqual({ n: 1 });
  });
});

describe("isolation and read-only keys", () => {
  test("another user gets not_found everywhere", async () => {
    const h = harness();
    const { file, pages } = await h.converted(h.alice, undefined, 1);
    const page = (pages[0] as Json).id as string;
    await save(h, h.alice, page, "secret");
    const lecture = h.lecture(h.bob);
    const calls: Array<[string, string, Json?]> = [
      ["GET", `/api/files/${file.id}`],
      ["GET", `/api/files/${file.id}/pages`],
      ["GET", `/api/files/${file.id}/original`],
      ["POST", `/api/files/${file.id}/retry`],
      ["POST", `/api/files/${file.id}/file`, { nodeId: lecture }],
      ["POST", `/api/files/${file.id}/claim`],
      ["POST", `/api/files/${file.id}/release`],
      ["POST", `/api/files/${file.id}/trash`],
      ["POST", `/api/files/${file.id}/restore`],
      ["DELETE", `/api/files/${file.id}`],
      ["GET", `/api/pages/${page}`],
      ["GET", `/api/pages/${page}/image`],
      ["GET", `/api/pages/${page}/image-url`],
      ["GET", `/api/pages/${page}/transcript`],
      ["PUT", `/api/pages/${page}/transcript`, { text: "pwned" }],
      ["POST", `/api/pages/${page}/transcript/review`, {}],
      ["GET", `/api/pages/${page}/transcript/revisions`],
      ["POST", `/api/pages/${page}/transcript/revisions/1/restore`],
    ];
    for (const [method, path, body] of calls) {
      const res = await h.call(h.bob, method, path, body);
      expect(res.status, `${method} ${path}`).toBe(404);
      expect(res.body.error.code, `${method} ${path}`).toBe("not_found");
    }
    expect((await h.call(h.bob, "GET", "/api/files")).body.items).toEqual([]);
    expect((await h.call(h.bob, "GET", `/api/files?nodeId=${lecture}`)).body.items).toEqual([]);
    expect(h.service.searchTranscripts(h.bob, "secret").items).toEqual([]);
    // nothing of hers changed
    expect(
      (await h.call(h.alice, "GET", `/api/pages/${page}/transcript`)).body.transcript.text,
    ).toBe("secret");
    expect((await h.call(h.alice, "GET", `/api/files/${file.id}`)).body.file.status).toBe(
      "transcribed",
    );
    // service methods too
    expect(() => h.service.getFile(h.bob, file.id)).toThrow(/No such file/);
  });

  test("a read-only key can read but is refused on every changing route", async () => {
    const h = harness();
    const { file, pages } = await h.converted(h.alice, undefined, 1);
    const page = (pages[0] as Json).id as string;
    const ro = { user: h.alice, via: "key", scope: "read" } as const;
    const reads = [
      `/api/files`,
      `/api/files/${file.id}`,
      `/api/files/${file.id}/pages`,
      `/api/files/${file.id}/original`,
      `/api/pages/${page}`,
      `/api/pages/${page}/image`,
      `/api/pages/${page}/image-url`,
      `/api/pages/${page}/transcript`,
      `/api/pages/${page}/transcript/revisions`,
      `/api/converter/status`,
    ];
    for (const path of reads) expect((await h.call(ro, "GET", path)).status, path).toBe(200);
    const writes: Array<[string, string, Json?]> = [
      ["POST", "/api/uploads/tickets", { files: [{ name: "a.pdf", bytes: 5 }] }],
      ["POST", `/api/files/${file.id}/retry`],
      ["POST", `/api/files/${file.id}/file`, { nodeId: null }],
      ["POST", `/api/files/${file.id}/claim`],
      ["POST", `/api/files/${file.id}/release`],
      ["POST", `/api/files/${file.id}/trash`],
      ["POST", `/api/files/${file.id}/restore`],
      ["DELETE", `/api/files/${file.id}`],
      ["PUT", `/api/pages/${page}/transcript`, { text: "x" }],
      ["POST", `/api/pages/${page}/transcript/review`, {}],
      ["POST", `/api/pages/${page}/transcript/revisions/1/restore`],
    ];
    for (const [method, path, body] of writes) {
      const res = await h.call(ro, method, path, body ?? {});
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(res.body.error.code, `${method} ${path}`).toBe("read_only_key");
    }
    // the service refuses too, for callers that skip HTTP (the MCP layer)
    const auth = {
      userId: h.alice,
      actor: { type: "agent", keyId: "key_01HZX3K9Q2V7M4N8P6R5T0W1Y1" },
      via: "key",
      scope: "read",
    } as never;
    expect(() => h.service.trash(auth, file.id)).toThrow(/read-only/);
    expect(() => h.service.saveTranscript(auth, { pageId: page, text: "x", flags: [] })).toThrow(
      /read-only/,
    );
    expect(() => h.service.requestUploads(auth, { files: [{ name: "a", bytes: 1 }] })).toThrow(
      /read-only/,
    );
    expect((await h.call(h.alice, "GET", `/api/files/${file.id}`)).body.file.trashedAt).toBeNull();
  });
});
