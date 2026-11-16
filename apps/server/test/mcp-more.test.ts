import { practice } from "@notes/schema";
import { describe, expect, test } from "vitest";
import { PDF, variant } from "./files.support.js";
import { connect, realSetup } from "./mcp-harness.js";

/**
 * Requests, practice, exams, concepts and writing claims over the REAL composed
 * services (createApp + createServices), with a fake converter for the pages.
 */

const PAGE1 = "Metoprolol 25 mg twice daily.\nBeta blockers cause bradycardia.";
const PAGE2 = "Dose = weight (kg) x 2 mg/kg.\nPropranolol is nonselective.";
const PW = "correct horse battery";

type Setup = Awaited<ReturnType<typeof realSetup>>;
type Agent = Awaited<ReturnType<Setup["agent"]>>;

/** Spine, a converted and transcribed two-page file, and an agent lecture note. */
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
  const sections = course.structured.sections as Array<{ id: string; name: string }>;
  const courseId = (course.structured.node as { id: string }).id;
  const lecturesId = sections.find((x) => x.name === "Lectures")?.id as string;
  const lecture = (
    await a.ok("edit_library", {
      action: "create",
      parentId: lecturesId,
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
    body: variant(PDF, `w${Math.random()}`),
  });
  const fileId = ((await put.json()) as { file: { id: string } }).file.id;
  s.convertAll(2);
  const pages = (
    (await a.ok("get_item", { id: fileId })).structured.pages as Array<{ id: string }>
  ).map((p) => p.id) as [string, string];
  await a.ok("source_files", { action: "claim", fileId });
  await a.ok("save_transcript", {
    pageId: pages[0],
    text: PAGE1,
    flags: [{ kind: "dose", quote: "25 mg" }],
  });
  await a.ok("save_transcript", {
    pageId: pages[1],
    text: PAGE2,
    flags: [{ kind: "dose", quote: "2 mg/kg" }],
  });
  await a.ok("source_files", { action: "file", fileId, nodeId: lecture.id });
  await a.ok("source_files", { action: "release", fileId });
  const cite = (page: 0 | 1, quote: string) => [{ fileId, pageId: pages[page], quote }];
  const note = await a.ok("write_document", {
    nodeId: lecture.id,
    kind: "lecture_note",
    title: "Beta blockers",
    blocks: [
      { type: "heading", content: { level: 1, text: "Beta blockers" } },
      {
        type: "paragraph",
        content: { text: "Metoprolol 25 mg twice daily." },
        citations: cite(0, "Metoprolol 25 mg twice daily."),
      },
    ],
  });
  const documentId = note.structured.documentId as string;
  const blockId = (note.structured.written as string[])[1] as string;
  return { term, courseId, lecturesId, lecture, fileId, pages, cite, documentId, blockId };
}

async function her(s: Setup) {
  await s.user("hannah");
  return (await s.t.signIn("hannah", PW)).cookies;
}

describe("requests over MCP", () => {
  test("list waiting first, claim, edit her block only through the request, complete, decline", async () => {
    const s = await realSetup();
    const a = await s.agent("hannah", "write", { "x-agent-label": "Claude Code" });
    const w = await world(s, a);
    const cookies = await her(s);
    // She corrects the paragraph herself: it becomes hers, protected from agents.
    const edited = await s.t.request(`/api/documents/${w.documentId}/blocks/${w.blockId}`, {
      method: "PATCH",
      cookies,
      body: { patch: { content: { text: "Metoprolol 50 mg twice daily." } } },
    });
    expect(edited.status).toBe(200);
    const onBlock = await s.t.request("/api/requests", {
      cookies,
      body: {
        target: { type: "block", documentId: w.documentId, blockId: w.blockId },
        kind: "wrong",
        message: "this is wrong: fix the dose",
      },
    });
    const onLecture = await s.t.request("/api/requests", {
      cookies,
      body: {
        target: { type: "node", nodeId: w.lecture.id },
        kind: "quiz_me",
        message: "make me a quiz on beta blockers",
      },
    });
    const blockReq = (onBlock.body as { request: { id: string } }).request.id;
    const lectureReq = (onLecture.body as { request: { id: string } }).request.id;

    const list = await a.ok("requests", { action: "list" });
    expect(list.text).toContain("Requests: 2 waiting");
    expect(list.text).toContain(`${blockReq} [waiting] wrong`);
    expect(list.text).toContain('She wrote: "this is wrong: fix the dose"');
    expect(list.text).toContain("Fall 2026 / Pharmacology II / Lectures / Beta blockers");

    const patch = {
      operation: "update_block",
      documentId: w.documentId,
      blockId: w.blockId,
      // no mode: inferred from "patch"
      patch: {
        content: { text: "Metoprolol 25 mg twice daily." },
        citations: w.cite(0, "Metoprolol 25 mg twice daily."),
      },
    };
    const protectedBlock = await a.fail("edit_blocks", patch);
    expect(protectedBlock.error.code).toBe("forbidden");
    expect(protectedBlock.error.message).toContain("is protected");
    const unclaimed = await a.fail("edit_blocks", { ...patch, requestId: blockReq });
    expect(unclaimed.error.code).toBe("forbidden");
    expect(unclaimed.error.message).toContain(
      `requests {"action":"claim","requestId":"${blockReq}"}`,
    );
    expect(JSON.stringify(unclaimed.error)).not.toContain("/api/");

    const claimed = await a.ok("requests", { action: "claim", requestId: blockReq });
    expect(claimed.text).toContain(`"requestId":"${blockReq}"`);
    // Another key cannot use the request this key holds, nor claim it.
    const other = await connect(s.app, s.key(a.user.id, "write", "codex").secret);
    expect(
      (await other.fail("requests", { action: "claim", requestId: blockReq })).error.code,
    ).toBe("conflict");
    const wrongKey = await other.fail("edit_blocks", { ...patch, requestId: blockReq });
    expect(wrongKey.error.code).toBe("forbidden");
    expect(wrongKey.error.message).toContain("claimed with this very API key");

    await a.ok("edit_blocks", { ...patch, requestId: blockReq });
    const done = await a.ok("requests", {
      action: "complete",
      requestId: blockReq,
      reply: "Corrected the dose back to 25 mg twice daily, as on the slide.",
      links: [{ type: "block", documentId: w.documentId, blockId: w.blockId, label: "Dose" }],
    });
    expect(done.text).toContain("Completed");
    const seen = await s.t.request(`/api/requests/${blockReq}`, { cookies });
    const req = (seen.body as { request: { status: string; reply: { text: string } } }).request;
    expect(req.status).toBe("done");
    expect(req.reply.text).toContain("25 mg");

    const declined = await a.ok("requests", {
      action: "decline",
      requestId: lectureReq,
      reason: "Testing the decline path.",
    });
    expect(declined.text).toContain("Declined");
    expect((await a.ok("get_item", { id: lectureReq })).text).toContain(
      "Testing the decline path.",
    );

    const reader = await connect(s.app, s.key(a.user.id, "read", "reader").secret);
    expect((await reader.ok("requests", { action: "list", status: ["done"] })).text).toContain(
      blockReq,
    );
    expect(
      (await reader.fail("requests", { action: "claim", requestId: lectureReq })).error.code,
    ).toBe("read_only_key");
    const mallory = await s.agent("mallory");
    expect(
      (await mallory.fail("requests", { action: "claim", requestId: blockReq })).error.code,
    ).toBe("not_found");
    expect((await mallory.fail("get_item", { id: blockReq })).error.code).toBe("not_found");

    const actions = s.services.activity.list(a.user.id, { limit: 200 }).items.map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining(["request.claim", "request.complete", "request.decline"]),
    );
  });
});

describe("practice over MCP", () => {
  test("validate, create with citations, list, get, update, trash, restore; refusals teach", async () => {
    const s = await realSetup();
    const a = await s.agent();
    const w = await world(s, a);
    const mc = {
      type: "multiple_choice",
      prompt: "Which adverse effect do beta blockers cause?",
      options: [{ text: "Bradycardia", correct: true }, { text: "Tachycardia" }],
      explanation: "Beta blockers slow the heart.",
      sources: w.cite(0, "Beta blockers cause bradycardia."),
    };
    const calc = {
      type: "calculation",
      prompt: "A 70 kg patient gets 2 mg/kg. How many mg?",
      answer: { kind: "fixed", value: 140 },
      units: ["mg"],
      explanation: "70 x 2 = 140 mg.",
      sources: w.cite(1, "Dose = weight (kg) x 2 mg/kg."),
    };
    const card = {
      type: "flashcard",
      front: "Is propranolol selective?",
      back: "No, nonselective.",
      sources: w.cite(1, "Propranolol is nonselective."),
    };
    const twoCorrect = {
      ...mc,
      options: [
        { text: "A", correct: true },
        { text: "B", correct: true },
      ],
    };

    const checked = await a.ok("practice_questions", {
      action: "create",
      nodeIds: [w.lecture.id],
      questions: [mc, twoCorrect],
      validateOnly: true,
    });
    expect(checked.text).toContain("1 of 2 question(s) are valid; nothing was stored.");
    expect(checked.text).toMatch(/questions\[1\] \$\.options/);
    expect(checked.text).toContain("Example:");

    const refused = await a.fail("practice_questions", {
      action: "create",
      nodeIds: [w.lecture.id],
      questions: [mc, twoCorrect],
    });
    expect(refused.error.code).toBe("invalid_input");
    expect(refused.error.example).toMatchObject({ type: "multiple_choice" });

    const madeUp = await a.fail("practice_questions", {
      action: "create",
      nodeIds: [w.lecture.id],
      questions: [{ ...card, sources: w.cite(1, "Propranolol is cardioselective.") }],
    });
    expect(madeUp.error.message).toContain("$.questions[0].sources[0].quote");
    expect(madeUp.error.message).toContain(
      'the closest passage there is "Propranolol is nonselective."',
    );

    const created = await a.ok("practice_questions", {
      action: "create",
      nodeIds: [w.lecture.id],
      questions: [mc, calc, card],
    });
    const ids = created.structured.created as string[];
    expect(ids).toHaveLength(3);
    const got = await a.ok("get_item", { id: ids[1] });
    const stored = (got.structured.question as { question: practice.Question }).question;
    const expected = practice.correctAnswerOf(stored, 0);
    const graded = practice.grade(stored, { type: "calculation", response: "140", unit: "mg" });
    expect(graded.correct, JSON.stringify(expected)).toBe(true);

    const listed = await a.ok("practice_questions", { action: "list", nodeId: w.lecture.id });
    expect(listed.text).toContain("3 question(s).");
    await a.ok("practice_questions", {
      action: "update",
      questionId: ids[2],
      question: { ...card, back: "No: it blocks beta-1 and beta-2." },
    });
    await a.ok("practice_questions", { action: "trash", questionId: ids[0] });
    expect((await a.ok("practice_questions", { action: "list", trashed: true })).text).toContain(
      ids[0],
    );
    await a.ok("practice_questions", { action: "restore", questionId: ids[0] });

    const progress = await a.ok("study_progress", { action: "due" });
    expect(progress.text).toMatch(/Due now: \d+, new: \d+/);
    expect((await a.ok("study_progress", { action: "weak_areas" })).text).toContain("Weak areas");
    expect((await a.ok("study_progress", { action: "notebook" })).text).toContain("notebook: 0");
    const mallory = await s.agent("mallory");
    expect((await mallory.fail("get_item", { id: ids[0] })).error.code).toBe("not_found");
    expect(
      (await mallory.fail("practice_questions", { action: "trash", questionId: ids[0] })).error
        .code,
    ).toBe("not_found");
  });
});

describe("exams over MCP", () => {
  test("create for a course, list with progress, update; coverage must be inside the course", async () => {
    const s = await realSetup();
    const a = await s.agent();
    const w = await world(s, a);
    const created = await a.ok("exams", {
      action: "create",
      courseId: w.courseId,
      title: "Exam 2",
      date: "2099-12-14",
      nodeIds: [w.lecture.id],
    });
    const examId = (created.structured.exam as { id: string }).id;
    expect(created.text).toContain("Beta blockers");
    const list = await a.ok("exams", { action: "list" });
    expect(list.text).toContain(examId);
    expect(list.text).toContain("Progress:");
    await a.ok("exams", { action: "update", examId, date: "2099-12-16" });
    expect((await a.ok("get_item", { id: examId })).text).toContain("2099-12-16");
    const outside = await a.fail("exams", {
      action: "create",
      courseId: w.courseId,
      title: "Bad",
      date: "2099-12-14",
      nodeIds: [w.term.id],
    });
    expect(outside.error.code).toBe("invalid_input");
  });
});

describe("concepts over MCP", () => {
  test("upsert with citations, refuse a relation between the wrong types, read every way, merge only by request", async () => {
    const s = await realSetup();
    const a = await s.agent();
    const w = await world(s, a);
    const up = await a.ok("concepts", {
      action: "upsert",
      concepts: [
        { type: "drug", name: "metoprolol", citations: w.cite(0, "Metoprolol 25 mg twice daily.") },
        { type: "drug", name: "propranolol", citations: w.cite(1, "Propranolol is nonselective.") },
        {
          type: "drug_class",
          name: "beta blockers",
          citations: w.cite(0, "Beta blockers cause bradycardia."),
        },
        {
          type: "adverse_effect",
          name: "bradycardia",
          citations: w.cite(0, "Beta blockers cause bradycardia."),
        },
      ],
      relations: [
        {
          from: { type: "drug", name: "metoprolol" },
          to: { type: "drug_class", name: "beta blockers" },
          type: "belongs_to_class",
          citations: w.cite(0, "Metoprolol 25 mg twice daily."),
        },
        {
          from: { type: "drug_class", name: "beta blockers" },
          to: { type: "adverse_effect", name: "bradycardia" },
          type: "causes_adverse_effect",
          citations: w.cite(0, "Beta blockers cause bradycardia."),
        },
      ],
    });
    expect(up.text).toContain("Applied: 6 created");
    const bad = await a.fail("concepts", {
      action: "upsert",
      relations: [
        {
          from: { type: "adverse_effect", name: "bradycardia" },
          to: { type: "drug", name: "metoprolol" },
          type: "treats",
          generalKnowledge: true,
        },
      ],
    });
    expect(bad.error.message).toContain("Nothing was written");
    expect(bad.error.message).toMatch(/\$\.relations\[0\]\.type: "treats" links a drug/);
    expect(bad.error.example).toMatchObject({ type: "treats" });

    const found = await a.ok("concepts", { action: "search", query: "meto" });
    const metoprolol = (found.structured.items as Array<{ id: string; name: string }>)[0];
    expect(metoprolol?.name).toBe("metoprolol");
    const page = await a.ok("get_item", { id: metoprolol?.id });
    expect(page.text).toContain("beta blockers");
    expect(
      (await a.ok("concepts", { action: "neighbourhood", conceptId: metoprolol?.id, hops: 2 }))
        .text,
    ).toContain("bradycardia");
    const filter = await a.ok("concepts", {
      action: "filter",
      filter: {
        kind: "with_relation",
        relation: "causes_adverse_effect",
        target: { type: "adverse_effect", name: "bradycardia" },
      },
    });
    expect(filter.text).toContain("metoprolol");
    expect(filter.text).toContain("via class beta blockers");
    const propranolol = (await a.ok("concepts", { action: "search", query: "propranolol" }))
      .structured.items as Array<{ id: string }>;
    const compare = await a.ok("concepts", {
      action: "compare",
      conceptIds: [metoprolol?.id, propranolol[0]?.id],
      attributes: ["belongs_to_class"],
    });
    expect(compare.text).toContain("- metoprolol: beta blockers");
    await a.ok("concepts", { action: "suggestions", conceptId: metoprolol?.id });
    const merge = await a.fail("concepts", {
      action: "merge",
      keepId: metoprolol?.id,
      mergeId: propranolol[0]?.id,
      requestId: "req_01J9Z8Y7X6W5V4T3S2R1Q0P9N8",
    });
    expect(merge.error.code).toBe("not_found");
    expect(merge.error.hint).toContain('requests {"action":"list"}');
    // With her request, claimed by this key, the merge goes through.
    await a.ok("concepts", {
      action: "upsert",
      concepts: [{ type: "drug", name: "metoprolol tartrate", generalKnowledge: true }],
    });
    const dup = (await a.ok("concepts", { action: "search", query: "tartrate" })).structured
      .items as Array<{ id: string }>;
    const cookies = await her(s);
    const asked = await s.t.request("/api/requests", {
      cookies,
      body: {
        target: { type: "library" },
        kind: "other",
        message: "merge metoprolol tartrate into metoprolol",
      },
    });
    const mergeReq = (asked.body as { request: { id: string } }).request.id;
    const unclaimedMerge = await a.fail("concepts", {
      action: "merge",
      keepId: metoprolol?.id,
      mergeId: dup[0]?.id,
      requestId: mergeReq,
    });
    expect(unclaimedMerge.error.code).toBe("forbidden");
    await a.ok("requests", { action: "claim", requestId: mergeReq });
    const merged = await a.ok("concepts", {
      action: "merge",
      keepId: metoprolol?.id,
      mergeId: dup[0]?.id,
      requestId: mergeReq,
    });
    expect(merged.text).toContain("Merged");
    const reader = await connect(s.app, s.key(a.user.id, "read", "reader").secret);
    expect((await reader.ok("concepts", { action: "search", query: "beta" })).isError).toBe(false);
    expect((await reader.fail("concepts", { action: "upsert", concepts: [] })).error.code).toBe(
      "read_only_key",
    );
  });
});

describe("writing claims", () => {
  test("a second agent is refused while the first writes for a lecture, and sees who holds it", async () => {
    const s = await realSetup();
    const a = await s.agent("hannah", "write", { "x-agent-label": "Claude Code" });
    const w = await world(s, a);
    const claimed = await a.ok("edit_library", {
      action: "claim",
      id: w.lecture.id,
      note: "study guide",
    });
    expect(claimed.text).toContain("You hold the writing claim");
    const b = await connect(s.app, s.key(a.user.id, "write", "codex").secret, {
      "x-agent-label": "Codex",
    });
    const view = await b.ok("get_item", { id: w.lecture.id });
    expect(view.text).toContain("Being written for by Claude Code");
    expect(view.text).toContain('("study guide")');
    const refused = await b.fail("edit_blocks", {
      operation: "insert_blocks",
      documentId: w.documentId,
      blocks: [{ type: "heading", content: { level: 2, text: "More" } }],
    });
    expect(refused.error.code).toBe("conflict");
    expect(refused.error.message).toContain("Claude Code");
    expect((await b.fail("edit_library", { action: "claim", id: w.lecture.id })).error.code).toBe(
      "conflict",
    );
    expect(
      (
        await b.fail("practice_questions", {
          action: "create",
          nodeIds: [w.lecture.id],
          questions: [practice.exampleFor("flashcard")],
        })
      ).error.code,
    ).toBe("conflict");
    await a.ok("edit_blocks", {
      operation: "insert_blocks",
      documentId: w.documentId,
      blocks: [{ type: "heading", content: { level: 2, text: "Doses" } }],
    });
    await a.ok("edit_library", { action: "release", id: w.lecture.id });
    await b.ok("edit_blocks", {
      operation: "insert_blocks",
      documentId: w.documentId,
      blocks: [{ type: "heading", content: { level: 2, text: "More" } }],
    });
    // The claim lapses on its own.
    await b.ok("edit_library", { action: "claim", id: w.lecture.id });
    s.t.clock.advance(31 * 60 * 1000);
    await a.ok("edit_blocks", {
      operation: "insert_blocks",
      documentId: w.documentId,
      blocks: [{ type: "heading", content: { level: 2, text: "Later" } }],
    });
  });
});

describe("the full surface", () => {
  test("sixteen tools, each described field by field, small and valid; start_here within budget", async () => {
    const { AjvJsonSchemaValidator } = await import("@modelcontextprotocol/sdk/validation/ajv");
    const { undescribed } = await import("../src/mcp/schema.js");
    const s = await realSetup();
    const a = await s.agent();
    const { tools } = await a.client.listTools();
    expect(tools.map((t) => t.name)).toEqual([
      "start_here",
      "browse_library",
      "get_item",
      "search_notes",
      "edit_library",
      "changes",
      "requests",
      "source_files",
      "get_page",
      "save_transcript",
      "write_document",
      "edit_blocks",
      "concepts",
      "practice_questions",
      "study_progress",
      "exams",
    ]);
    const ajv = new AjvJsonSchemaValidator();
    for (const tool of tools) {
      expect(undescribed(tool.inputSchema as never), tool.name).toEqual([]);
      expect(JSON.stringify(tool.inputSchema).length, tool.name).toBeLessThan(9000);
      expect(() => ajv.getValidator(tool.inputSchema as never), tool.name).not.toThrow();
      for (const key of ["oneOf", "anyOf", "allOf", "$ref"]) {
        expect(tool.inputSchema, `${tool.name} ${key}`).not.toHaveProperty(key);
      }
    }
    // The whole listing an agent loads, and the default start_here.
    expect(JSON.stringify(tools).length).toBeLessThan(80_000);
    const start = await a.ok("start_here");
    expect(start.text.length).toBeLessThan(12_000);
    expect(start.text).toContain("Check her requests FIRST");
  });
});
