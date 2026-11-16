import { findQuote } from "@notes/schema";
import { describe, expect, test } from "vitest";
import { PDF, variant } from "./files.support.js";
import { connect, realSetup } from "./mcp-harness.js";

/**
 * Every tool against the REAL composed services (createApp + createServices,
 * as index.ts wires them), a temporary storage directory and a fake converter
 * playing the queue protocol. Only the converter is played.
 */

const SLIDE = "Beta blockers end in -olol.\nAtenolol and metoprolol are cardioselective (β1).";
const NOTES = "Start metoprolol 25 mg PO BID\nHold if HR < 55";

type Agent = Awaited<ReturnType<Awaited<ReturnType<typeof realSetup>>["agent"]>>;

/** Upload through request_upload_links and a PUT, the way an agent does with curl. */
async function uploadViaTicket(
  s: Awaited<ReturnType<typeof realSetup>>,
  a: Agent,
  name: string,
  data: Buffer,
): Promise<string> {
  const links = await a.ok("request_upload_links", { files: [{ name, bytes: data.length }] });
  const [ticket] = links.structured.tickets as Array<{ url: string }>;
  const url = new URL(ticket?.url ?? "");
  const res = await s.app.request(url.pathname, { method: "PUT", body: data });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { file: { id: string } };
  return body.file.id;
}

describe("MCP over the real services", () => {
  test("upload, wait, claim, read, transcribe, place, file, write cited, search, changes, activity", async () => {
    const s = await realSetup();
    const a = await s.agent("hannah", "write", { "user-agent": "claude-code/2.1.283 (test)" });
    const userId = a.user.id;

    // ---- orientation and the true workflow
    const start = await a.ok("start_here", { topic: "inbox" });
    expect(start.text).toContain('source_files {"action":"wait"');
    expect(start.text).toContain('get_item {"id":"fil_…","text":true}');

    // ---- get two files in through upload links; they wait for the converter
    const deckId = await uploadViaTicket(s, a, "lecture-07.pdf", variant(PDF, "deck"));
    const notesId = await uploadViaTicket(s, a, "notes.pdf", variant(PDF, "notes"));
    const waiting = await a.ok("source_files", {
      action: "wait",
      fileIds: [deckId, notesId],
      timeoutSeconds: 1,
    });
    expect(waiting.text).toContain("2 still converting");
    // Nothing converted yet: a claim says so and points at the right tool, not a web route.
    const early = await a.fail("source_files", { action: "claim", fileId: deckId });
    expect(early.error.code).toBe("conflict");
    expect(JSON.stringify(early.error)).not.toContain("/api/");

    // ---- the converter does its work (slide text on page 1 of each file)
    s.convertAll(2, (result) => {
      const pages = result.pages as Array<{ nativeText: string | null; hasTextLayer: boolean }>;
      for (const p of pages) {
        p.nativeText = null;
        p.hasTextLayer = false;
      }
    });
    const done = await a.ok("source_files", { action: "wait", fileIds: [deckId, notesId] });
    expect(done.text).toContain("All converted");
    const inbox = await a.ok("source_files", { action: "list" });
    expect(inbox.text).toContain("0 of 2 pages transcribed");

    // ---- claim and read
    await a.ok("source_files", { action: "claim", fileId: deckId });
    await a.ok("source_files", { action: "claim", fileId: notesId });
    const deck = await a.ok("get_item", { id: deckId });
    const deckPages = (deck.structured.pages as Array<{ id: string }>).map((p) => p.id);
    expect(deckPages).toHaveLength(2);
    const page = await a.ok("get_page", { pageId: deckPages[0] });
    expect(page.images[0]?.mimeType).toBe("image/webp");
    expect(page.text).toContain("Not transcribed yet");
    const link = await a.ok("get_page", { pageId: deckPages[0], image: "link" });
    const signed = new URL((link.structured.imageLink as { url: string }).url);
    const image = await s.app.request(`${signed.pathname}${signed.search}`);
    expect(image.status).toBe(200);

    // ---- transcribe (the flag rule first)
    const refused = await a.fail("save_transcript", { pageId: deckPages[1], text: NOTES });
    expect(refused.error.message).toContain('"25 mg"');
    await a.ok("save_transcript", { pageId: deckPages[0], text: SLIDE });
    const second = await a.ok("save_transcript", {
      pageId: deckPages[1],
      text: NOTES,
      flags: [{ kind: "dose", quote: "25 mg" }],
    });
    expect(second.text).toContain("Every page of this file is transcribed.");
    const notesPages = (
      (await a.ok("get_item", { id: notesId })).structured.pages as Array<{ id: string }>
    ).map((p) => p.id);
    await a.ok("save_transcript", { pageId: notesPages[0], text: "Propranolol is nonselective." });

    // ---- place: term, course, lecture
    const term = (
      await a.ok("edit_library", {
        action: "create",
        parentId: null,
        kind: "term",
        name: "Fall 2026",
      })
    ).structured.node as { id: string };
    const course = await a.ok("edit_library", {
      action: "create",
      parentId: term.id,
      kind: "course",
      name: "Pharmacology II",
    });
    const sections = course.structured.sections as Array<{ id: string; name: string }>;
    const lecturesId = sections.find((x) => x.name === "Lectures")?.id as string;
    const sourcesId = sections.find((x) => x.name === "Sources")?.id as string;
    const guidesId = sections.find((x) => x.name === "Study guides")?.id as string;
    const lecture = (
      await a.ok("edit_library", {
        action: "create",
        parentId: lecturesId,
        kind: "lecture",
        name: "Beta blockers",
        lecture: { number: 7, date: "2026-10-14" },
      })
    ).structured.node as { id: string };

    // ---- file: complete deck quietly, half-transcribed notes with a warning; bad place refused
    const filedDeck = await a.ok("source_files", {
      action: "file",
      fileId: deckId,
      nodeId: lecture.id,
    });
    expect(filedDeck.text).not.toContain("Warning");
    const filedNotes = await a.ok("source_files", {
      action: "file",
      fileId: notesId,
      nodeId: lecture.id,
    });
    expect(filedNotes.text).toContain("Warning: 1 of 2 page(s) have no transcript yet");
    const badPlace = await a.fail("source_files", {
      action: "move",
      fileId: notesId,
      nodeId: term.id,
    });
    expect(badPlace.error.message).toBe("A source file cannot be filed under a term.");
    expect(badPlace.error.hint).toContain("lecture, a folder, or the Sources section");
    await a.ok("source_files", { action: "move", fileId: notesId, nodeId: sourcesId });
    const lectureView = await a.ok("get_item", { id: lecture.id });
    expect(lectureView.text).toContain("Source files filed here:");
    expect(lectureView.text).toContain("No document yet.");

    // ---- write the study guide; a made-up quote is refused at its path
    const cite = (pageId: string, fileId: string, quote: string) => [{ fileId, pageId, quote }];
    const badQuote = await a.fail("write_document", {
      parentId: guidesId,
      kind: "study_guide",
      title: "Beta blockers",
      blocks: [
        {
          type: "paragraph",
          content: { text: "Atenolol is renally cleared." },
          citations: cite(deckPages[0] as string, deckId, "Atenolol is renally cleared."),
        },
      ],
    });
    expect(badQuote.error.message).toContain("$.blocks[0].citations[0]");
    expect(badQuote.error.message).toContain("does not occur, character for character");
    expect(badQuote.error.message).toContain(`get_page {"pageId":"${deckPages[0]}"}`);
    const written = await a.ok("write_document", {
      parentId: guidesId,
      kind: "study_guide",
      title: "Beta blockers",
      blocks: [
        { type: "heading", content: { level: 1, text: "Beta blockers" } },
        {
          type: "callout",
          content: { kind: "exam_tip", text: "Names end in -olol." },
          citations: cite(deckPages[0] as string, deckId, "Beta blockers end in -olol."),
        },
        {
          type: "table",
          content: {
            rows: [
              ["Drug", "Dose"],
              ["Metoprolol", "25 mg PO BID"],
            ],
          },
          citations: cite(deckPages[1] as string, deckId, "Start metoprolol 25 mg PO BID"),
          flags: [{ kind: "dose", quote: "25 mg" }],
        },
      ],
    });
    const documentId = written.structured.documentId as string;
    const doc = await a.ok("get_item", { id: documentId });
    expect(doc.text).toContain("Blocks 0-3 of 3");
    const refs = doc.structured.references as Array<{ status: string; quoteStillPresent: boolean }>;
    expect(refs).toHaveLength(2);
    expect(refs.every((r) => r.status === "available" && r.quoteStillPresent === true)).toBe(true);
    // Verified independently: every quote occurs in its page's transcript.
    for (const b of doc.structured.blocks as Array<{
      citations: Array<{ pageId: string; quote: string }>;
    }>) {
      for (const c of b.citations) {
        const t = s.services.files.getTranscript(userId, c.pageId);
        expect(findQuote(t?.text ?? "", c.quote)).toBeGreaterThanOrEqual(0);
      }
    }
    const cited = await a.ok("get_page", { pageId: deckPages[0], image: "none" });
    expect(cited.text).toContain("Cited by 1 block(s).");

    // ---- unified search: a node, a page and a block
    const found = await a.ok("search_notes", { query: "olol" });
    const kinds = new Set((found.structured.hits as Array<{ kind: string }>).map((h) => h.kind));
    expect([...kinds].sort()).toEqual(["block", "page"]);
    const named = await a.ok("search_notes", { query: "beta", kinds: ["node"] });
    expect(named.text).toContain("Beta blockers");

    // ---- release, then the feed and the activity log
    await a.ok("source_files", { action: "release", fileId: deckId });
    await a.ok("source_files", { action: "release", fileId: notesId });
    const changes = await a.ok("changes", { limit: 200 });
    expect(changes.text).toContain("document.created by an agent");
    const activity = s.services.activity.list(userId, { limit: 200 }).items;
    const actions = activity.map((e) => e.action).reverse();
    for (const action of [
      "file.uploaded",
      "file.claimed",
      "transcript.saved",
      "library.created",
      "file.filed",
      "create_document",
      "file.released",
    ]) {
      expect(actions, action).toContain(action);
    }
    expect(new Set(activity.map((e) => e.keyLabel))).toEqual(new Set(["Claude Code"]));
    expect(new Set(activity.map((e) => e.keyId))).toEqual(new Set([a.key.key.id]));
  });

  test("an MCP action and the same HTTP action leave the same activity entry", async () => {
    const s = await realSetup();
    const a = await s.agent("hannah", "write", { "x-agent-label": "Codex" });
    const viaMcp = (
      await a.ok("edit_library", {
        action: "create",
        parentId: null,
        kind: "term",
        name: "Fall 2026",
      })
    ).structured.node as { id: string };
    const res = await s.t.request("/api/nodes", {
      bearer: a.key.secret,
      origin: null,
      headers: { "x-agent-label": "Codex" },
      body: { parentId: null, kind: "term", name: "Spring 2027" },
    });
    expect(res.status).toBe(201);
    const [http, mcp] = s.services.activity.list(a.user.id).items;
    expect(mcp?.links[0]?.id).toBe(viaMcp.id);
    expect({ ...http, id: 0, at: "", summary: "", links: [] }).toEqual({
      ...mcp,
      id: 0,
      at: "",
      summary: "",
      links: [],
    });
    expect(http?.summary.replace("Spring 2027", "X")).toBe(mcp?.summary.replace("Fall 2026", "X"));
  });

  test("read-only keys, isolation and a failed conversion", async () => {
    const s = await realSetup();
    const a = await s.agent("hannah");
    const fileId = await uploadViaTicket(s, a, "broken.pdf", variant(PDF, "broken"));
    for (const jobId of s.converter.pending()) s.converter.fail(jobId, "corrupt_file", "Not a PDF");
    s.services.files.processQueue();
    const waited = await a.ok("source_files", { action: "wait", fileIds: [fileId] });
    expect(waited.text).toContain("1 failed");
    expect(waited.text).toContain("conversion failed (corrupt_file: Not a PDF)");
    const retried = await a.ok("source_files", { action: "retry", fileId });
    expect(retried.text).toContain("Queued for conversion again");

    const reader = await connect(s.app, s.key(a.user.id, "read", "reader").secret);
    expect((await reader.ok("source_files", { action: "list" })).text).toContain(fileId);
    expect((await reader.fail("source_files", { action: "claim", fileId })).error.code).toBe(
      "read_only_key",
    );
    const other = await s.agent("mallory");
    const hidden = await other.fail("get_item", { id: fileId });
    expect(hidden.error.code).toBe("not_found");
    expect((await other.ok("source_files", { action: "list" })).text).not.toContain(fileId);
  });
});
