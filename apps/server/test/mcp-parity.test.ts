import { describe, expect, test } from "vitest";
import { PDF, variant } from "./files.support.js";
import { realSetup } from "./mcp-harness.js";

/**
 * The agent layer keeps up with what she can do in the app (docs/mcp.md, "Parity with the app"):
 * the calendar, her saved instructions, renaming a file, and revision history for documents and
 * transcripts. Over the REAL composed services, each tool calling the same function as the route.
 */

const PW = "correct horse battery";
const PAGE1 = "Metoprolol is cardioselective.";

type Setup = Awaited<ReturnType<typeof realSetup>>;
type Agent = Awaited<ReturnType<Setup["agent"]>>;

/** Term, course, lecture, a converted one-page file and a lecture note. */
async function world(s: Setup, a: Agent) {
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
  const courseId = (course.structured.node as { id: string }).id;
  const sections = course.structured.sections as Array<{ id: string; name: string }>;
  const lecture = (
    await a.ok("edit_library", {
      action: "create",
      parentId: sections.find((x) => x.name === "Lectures")?.id,
      kind: "lecture",
      name: "Beta blockers",
      lecture: { number: 7, date: "2026-10-14" },
    })
  ).structured.node as { id: string };
  const links = await a.ok("source_files", {
    action: "upload_links",
    files: [{ name: "lecture-07.pdf" }],
  });
  const url = new URL((links.structured.tickets as Array<{ url: string }>)[0]?.url ?? "");
  const put = await s.app.request(url.pathname, {
    method: "PUT",
    body: variant(PDF, `p${Math.random()}`),
  });
  const fileId = ((await put.json()) as { file: { id: string } }).file.id;
  s.convertAll(1);
  const pageId = (
    (await a.ok("get_item", { id: fileId })).structured.pages as Array<{ id: string }>
  )[0]?.id as string;
  await a.ok("source_files", { action: "claim", fileId });
  return { courseId, lectureId: lecture.id, fileId, pageId };
}

describe("calendar (study_progress calendar)", () => {
  test("gives what GET /api/calendar gives, exams included; bad ranges are refused", async () => {
    const s = await realSetup();
    const a = await s.agent();
    const w = await world(s, a);
    await a.ok("exams", {
      action: "create",
      courseId: w.courseId,
      title: "Exam 2",
      date: "2026-11-20",
      nodeIds: [w.lectureId],
    });
    const r = await a.ok("study_progress", {
      action: "calendar",
      from: "2026-11-01",
      to: "2026-11-30",
      utcOffsetMinutes: -360,
    });
    expect(r.text).toContain('"Exam 2" on 2026-11-20');
    expect(r.text).toContain("study streak 0 day(s)");
    // Same function as the web route, read with the same key.
    const http = await s.app.request(
      "/api/calendar?from=2026-11-01&to=2026-11-30&utcOffsetMinutes=-360",
      { headers: { authorization: `Bearer ${a.key.secret}` } },
    );
    expect(r.structured.calendar).toEqual(await http.json());

    const long = await a.fail("study_progress", {
      action: "calendar",
      from: "2026-01-01",
      to: "2026-06-30",
    });
    expect(long.error.code).toBe("invalid_input");
    expect(long.error.message).toContain("62 days");
    const bad = await a.fail("study_progress", {
      action: "calendar",
      from: "Nov 1",
      to: "2026-11-30",
    });
    expect(bad.error.message).toContain("from");
    // Read only: a read key may ask.
    const reader = await s.agent("hannah", "read");
    await reader.ok("study_progress", { action: "calendar", from: "2026-11-01", to: "2026-11-30" });
  });
});

describe("saved instructions (requests instructions)", () => {
  test("lists what she saved in Settings; writing them stays hers", async () => {
    const s = await realSetup();
    const a = await s.agent();
    const empty = await a.ok("requests", { action: "instructions" });
    expect(empty.text).toContain("(none saved)");

    const { cookies } = await s.t.signIn("hannah", PW);
    const saved = await s.t.request("/api/me/preferences", {
      method: "PATCH",
      cookies,
      body: {
        instructions: [
          {
            id: "notes",
            title: "Lecture notes",
            body: "One section per slide. Bold every drug name.",
          },
        ],
      },
    });
    expect(saved.status).toBe(200);

    const r = await a.ok("requests", { action: "instructions" });
    expect(r.text).toContain('"Lecture notes": One section per slide.');
    expect(r.structured.items).toEqual([
      { id: "notes", title: "Lecture notes", body: "One section per slide. Bold every drug name." },
    ]);
    // A read key can list them too; no write is involved.
    const reader = await s.agent("hannah", "read");
    await reader.ok("requests", { action: "instructions" });
    // The preferences routes refuse an agent key, so an agent cannot rewrite her rules.
    const viaKey = await s.app.request("/api/me/preferences", {
      method: "PATCH",
      headers: { authorization: `Bearer ${a.key.secret}`, "content-type": "application/json" },
      body: JSON.stringify({ instructions: [] }),
    });
    expect(viaKey.status).toBeGreaterThanOrEqual(400);
    // Another user sees only their own.
    const other = await s.agent("someone");
    expect((await other.ok("requests", { action: "instructions" })).structured.items).toEqual([]);
  });
});

describe("files: rename and transcript history", () => {
  test("rename, list transcript revisions, restore one as a new revision", async () => {
    const s = await realSetup();
    const a = await s.agent();
    const w = await world(s, a);

    const renamed = await a.ok("source_files", {
      action: "rename",
      fileId: w.fileId,
      name: "Lecture 7 - Beta blockers.pdf",
    });
    expect(renamed.text).toContain("Renamed");
    const file = (await a.ok("get_item", { id: w.fileId })).text;
    expect(file).toContain("Lecture 7 - Beta blockers.pdf");

    await a.ok("save_transcript", { pageId: w.pageId, text: PAGE1, flags: [] });
    await a.ok("save_transcript", {
      pageId: w.pageId,
      text: "Metoprolol is selective.",
      flags: [],
    });
    const history = await a.ok("get_item", { id: w.pageId, history: true });
    expect(history.text).toContain("revision 2");
    expect(history.text).toContain("revision 1");
    const items = history.structured.items as Array<{ revision: number }>;
    expect(items.map((i) => i.revision)).toEqual([2, 1]);

    const restored = await a.ok("source_files", {
      action: "restore_transcript",
      pageId: w.pageId,
      revision: 1,
    });
    expect(restored.text).toContain("as revision 3");
    const page = await a.ok("get_page", { pageId: w.pageId, image: "none" });
    expect(page.text).toContain(PAGE1);

    // The domain's rules hold: an unknown revision, the current one, another agent's claim.
    const missing = await a.fail("source_files", {
      action: "restore_transcript",
      pageId: w.pageId,
      revision: 9,
    });
    expect(missing.error.code).toBe("not_found");
    expect(missing.error.hint).toContain('get_item {"id":"pag_…","history":true}');
    const current = await a.fail("source_files", {
      action: "restore_transcript",
      pageId: w.pageId,
      revision: 3,
    });
    expect(current.error.code).toBe("conflict");
    const b = await s.agent("hannah", "write");
    const blocked = await b.fail("source_files", {
      action: "restore_transcript",
      pageId: w.pageId,
      revision: 2,
    });
    expect(blocked.error.code).toBe("conflict");
    const reader = await s.agent("hannah", "read");
    const ro = await reader.fail("source_files", {
      action: "rename",
      fileId: w.fileId,
      name: "x.pdf",
    });
    expect(ro.error.code).toBe("read_only_key");
    // Trash stays hers: there is no such action.
    const trash = await a.fail("source_files", { action: "trash", fileId: w.fileId });
    expect(trash.error.message).toContain("not one of");
  });
});

describe("documents: revision history", () => {
  test("get_item history lists revisions; restore_revision takes one of them", async () => {
    const s = await realSetup();
    const a = await s.agent();
    const w = await world(s, a);
    const note = await a.ok("write_document", {
      nodeId: w.lectureId,
      kind: "lecture_note",
      title: "Beta blockers",
      blocks: [{ type: "heading", content: { level: 1, text: "Beta blockers" } }],
    });
    const documentId = note.structured.documentId as string;
    await a.ok("edit_blocks", {
      operation: "insert_blocks",
      documentId,
      blocks: [{ type: "heading", content: { level: 2, text: "Later" } }],
    });
    const history = await a.ok("get_item", { id: documentId, history: true });
    const numbers = (history.structured.items as Array<{ number: number }>).map((r) => r.number);
    expect(numbers[0]).toBeGreaterThan(numbers[numbers.length - 1] as number);
    expect(history.text).toContain('"operation":"restore_revision"');
    const first = numbers[numbers.length - 1] as number;
    await a.ok("edit_blocks", { operation: "restore_revision", documentId, revision: first });
    const after = await a.ok("get_item", { id: documentId });
    expect(after.text).not.toContain("Later");

    // history is only for documents and pages.
    const wrong = await a.fail("get_item", { id: w.lectureId, history: true });
    expect(wrong.error.message).toContain("history is only for");
  });
});
