import { copyFileSync, mkdirSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newId } from "@notes/schema";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { migrate, openDatabase } from "../src/db/client.js";
import { nameCheckerFromConfig } from "../src/domains/concepts/index.js";
import { agentAuth, type Composed, composed, type Json } from "./composed.support.js";
import { heading, para, thrown } from "./documents-helpers.js";
import { fx } from "./practice-helpers.js";

const QUOTE_ONE = "Metoprolol is cardioselective.";
const QUOTE_TWO = "Never stop a beta blocker abruptly.";

/** A lecture with a converted, transcribed file filed under it, and a course around it. */
async function lectureWithSource(t: Composed) {
  const { course, lecture, sections } = t.spine();
  const { file, pages } = await t.convertedFile(t.she, { nodeId: lecture.id, name: "beta.pdf" });
  const texts = [`Slide one. ${QUOTE_ONE} Atenolol too.`, `Slide two. ${QUOTE_TWO}`];
  for (const [i, page] of pages.entries()) {
    t.services.files.saveTranscript(t.bot, {
      pageId: page.id,
      text: texts[i] as string,
      flags: [],
    });
  }
  const cite = (page: number, quote: string) => ({
    fileId: file.id,
    pageId: pages[page - 1]?.id as string,
    quote,
  });
  return { course, lecture, sections, file, pages, cite };
}

const count = (t: Composed, table: string, where = "1=1") =>
  (t.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get() as { n: number }).n;

describe("questions, exams and attempts follow the library", () => {
  it("a trashed lecture hides its questions and exam coverage; her attempts are never deleted", async () => {
    const t = composed();
    const { course, lecture, cite } = await lectureWithSource(t);
    const made = t.services.practice.createQuestions(t.bot, {
      nodeIds: [lecture.id],
      questions: [
        fx.mc(cite(1, QUOTE_ONE), { prompt: "Which agent is cardioselective? (unique-zebra)" }),
        fx.flash(cite(2, QUOTE_TWO)),
      ],
    });
    expect(made.stored).toBe(2);
    const exam = t.services.exams.createExam(t.she, {
      courseId: course.id,
      title: "Exam 1",
      date: "2026-12-14",
      nodeIds: [lecture.id],
    });
    // She answers both, one wrongly.
    const started = t.services.practice.startSession(t.she, {
      scope: { kind: "nodes", nodeIds: [lecture.id] },
      length: 5,
    });
    let attempts = 0;
    for (let i = 0; i < started.session.items.length; i++) {
      const next = t.services.practice.nextQuestion(t.she, started.session.id).next;
      if (!next) break;
      const view = next.view as Json;
      const answer =
        view.type === "flashcard"
          ? { type: "flashcard", rating: "again" }
          : { type: "multiple_choice", optionId: view.options[0].id };
      t.services.practice.submitAnswer(t.she, started.session.id, { answer: answer as never });
      attempts++;
    }
    expect(attempts).toBe(2);
    expect(count(t, "attempts")).toBe(2);
    const progress = () => t.services.exams.getExam(t.she, exam.id).progress;
    expect(progress()).toMatchObject({ questions: 2, attempts: 2 });
    const visible = () => t.services.practice.listQuestions(t.she, {}).items.length;
    expect(visible()).toBe(2);

    t.services.library.trash(t.alice, lecture.id, t.she.actor);
    expect(visible()).toBe(0);
    const id = made.created[0]?.id as string;
    expect(thrown(() => t.services.practice.getQuestion(t.she, id)).code).toBe("not_found");
    expect(progress().questions).toBe(0);
    expect(
      thrown(() =>
        t.services.practice.startSession(t.she, {
          scope: { kind: "nodes", nodeIds: [lecture.id] },
          length: 5,
        }),
      ).code,
    ).toBe("invalid_input");
    expect(t.services.practice.notebook(t.she, {}).items).toEqual([]);
    expect(
      t.services.search.search(t.alice, { q: "unique-zebra", kinds: ["question"] }).items,
    ).toEqual([]);
    // Her history is untouched.
    expect(count(t, "attempts")).toBe(2);

    t.services.library.restore(t.alice, lecture.id, t.she.actor);
    expect(visible()).toBe(2);
    expect(progress()).toMatchObject({ questions: 2, attempts: 2 });
    expect(
      t.services.search.search(t.alice, { q: "unique-zebra", kinds: ["question"] }).items,
    ).toHaveLength(1);

    // The whole course in the trash hides the exam; it comes back with the course.
    t.services.library.trash(t.alice, course.id, t.she.actor);
    expect(thrown(() => t.services.exams.getExam(t.she, exam.id)).code).toBe("not_found");
    expect(t.services.exams.listExams(t.she, {}).items).toEqual([]);
    t.services.library.restore(t.alice, course.id, t.she.actor);
    expect(t.services.exams.getExam(t.she, exam.id).title).toBe("Exam 1");

    // Deleted for good: the questions go, her attempts stay as history.
    t.services.library.trash(t.alice, lecture.id, t.she.actor);
    t.services.library.permanentDelete(t.alice, lecture.id, t.she.actor);
    expect(count(t, "questions")).toBe(0);
    expect(count(t, "attempts")).toBe(2);
    expect(count(t, "exam_coverage")).toBe(0);
    expect(t.services.exams.getExam(t.she, exam.id).progress.questions).toBe(0);
  });

  it("duplicating a course copies its questions (fresh history) and its exam onto the copy", async () => {
    const t = composed();
    const { course, lecture } = await lectureWithSource(t);
    t.services.practice.createQuestions(t.bot, {
      nodeIds: [lecture.id],
      questions: [
        fx.mc({ fileId: "", pageId: "", quote: "" }, { sources: [], generalKnowledge: true }),
      ],
    });
    t.services.exams.createExam(t.she, {
      courseId: course.id,
      title: "Exam 1",
      date: "2026-12-14",
      nodeIds: [lecture.id],
    });
    const copy = t.services.library.duplicate(t.alice, course.id, t.she.actor);
    const copied = t.services.exams.listExams(t.she, { courseId: copy.id }).items;
    expect(copied).toHaveLength(1);
    const exam = t.services.exams.getExam(t.she, copied[0]?.id as string);
    expect(exam.nodeIds).toHaveLength(1);
    expect(exam.nodeIds[0]).not.toBe(lecture.id);
    expect(exam.progress.questions).toBe(1);
    expect(exam.progress.attempts).toBe(0);
    expect(t.services.practice.listQuestions(t.she, {}).items).toHaveLength(2);
    expect(count(t, "exams")).toBe(2);
  });
});

describe("requests follow what they are about", () => {
  it("are hidden with a trashed node, file or question, and closed with a note when it is deleted", async () => {
    const t = composed();
    const { lecture, file, pages, cite } = await lectureWithSource(t);
    const doc = t.services.documents.createDocument(t.bot, {
      nodeId: lecture.id,
      kind: "lecture_note",
      title: "Beta blockers",
      blocks: [para("Metoprolol is cardioselective.", [{ ...cite(1, QUOTE_ONE), label: "s1" }])],
    } as never);
    const made = t.services.practice.createQuestions(t.bot, {
      nodeIds: [lecture.id],
      questions: [fx.mc(cite(1, QUOTE_ONE))],
    });
    const questionId = made.created[0]?.id as string;
    const open = () =>
      t.services.requests
        .list(t.she, {})
        .items.map((r) => r.target.type)
        .sort();
    const block = t.services.requests.create(t.she, {
      target: { type: "block", documentId: doc.documentId, blockId: doc.blockIds[0] as string },
      kind: "wrong",
      message: "check this",
    });
    t.services.requests.create(t.she, {
      target: { type: "question", questionId },
      kind: "unclear",
      message: "",
    });
    t.services.requests.create(t.she, {
      target: { type: "source", fileId: file.id, pageId: pages[0]?.id as string },
      kind: "summarise",
      message: "",
    });
    expect(open()).toEqual(["block", "question", "source"]);

    // The source file: out of sight in the trash, back on restore.
    t.services.files.trash(t.she, file.id);
    expect(open()).toEqual(["block", "question"]);
    t.services.files.restore(t.she, file.id);
    expect(open()).toEqual(["block", "question", "source"]);

    // The lecture: its block and question requests hide with it.
    t.services.library.trash(t.alice, lecture.id, t.she.actor);
    expect(open()).toEqual(["source"]);
    t.services.library.restore(t.alice, lecture.id, t.she.actor);
    expect(open()).toEqual(["block", "question", "source"]);

    // Deleted for good: open requests are declined with a reason, history stays.
    t.services.library.trash(t.alice, lecture.id, t.she.actor);
    t.services.library.permanentDelete(t.alice, lecture.id, t.she.actor);
    t.services.files.trash(t.she, file.id);
    t.services.files.permanentDelete(t.she, file.id);
    const all = t.services.requests.list(t.she, { status: ["declined"] }).items;
    expect(all).toHaveLength(3);
    for (const r of all) expect(r.reply?.text).toMatch(/deleted for good/);
    expect(t.services.requests.get(t.she, block.id).status).toBe("declined");
    expect(count(t, "requests")).toBe(3);
  });

  it("a question deleted for good closes its requests (the hook runs from the practice service)", async () => {
    const t = composed();
    const { lecture } = t.spine();
    const made = t.services.practice.createQuestions(t.bot, {
      nodeIds: [lecture.id],
      questions: [
        fx.mc({ fileId: "", pageId: "", quote: "" }, { sources: [], generalKnowledge: true }),
      ],
    });
    const id = made.created[0]?.id as string;
    const request = t.services.requests.create(t.she, {
      target: { type: "question", questionId: id },
      kind: "wrong",
      message: "",
    });
    t.services.practice.trashQuestion(t.she, id);
    t.services.practice.deleteQuestion(t.she, id);
    expect(t.services.requests.get(t.she, request.id)).toMatchObject({
      status: "declined",
      reply: { text: expect.stringContaining("The question was deleted") },
    });
  });

  it("describe every kind of target from the real tables", async () => {
    const t = composed();
    const { lecture, file, pages, cite } = await lectureWithSource(t);
    const doc = t.services.documents.createDocument(t.bot, {
      nodeId: lecture.id,
      kind: "lecture_note",
      title: "Beta blockers",
      blocks: [
        para("Metoprolol is cardioselective and used after infarction.", [
          { ...cite(1, QUOTE_ONE), label: "s1" },
        ]),
      ],
    } as never);
    const made = t.services.practice.createQuestions(t.bot, {
      nodeIds: [lecture.id],
      questions: [fx.mc(cite(1, QUOTE_ONE), { prompt: "Which agent is cardioselective?" })],
    });
    const ctx = (target: Json) =>
      t.services.requests.create(t.she, { target, kind: "other", message: "x" }).context;
    expect(ctx({ type: "library" })).toMatchObject({ name: "Library" });
    expect(ctx({ type: "node", nodeId: lecture.id })).toMatchObject({
      name: "Beta blockers",
      path: "Fall 2026 / Pharmacology II / Lectures / Beta blockers",
      nodeId: lecture.id,
    });
    expect(ctx({ type: "document", documentId: doc.documentId })).toMatchObject({
      name: "Beta blockers",
      preview: expect.stringContaining("Metoprolol is cardioselective"),
      nodeId: lecture.id,
    });
    expect(
      ctx({ type: "block", documentId: doc.documentId, blockId: doc.blockIds[0] }),
    ).toMatchObject({ preview: expect.stringContaining("used after infarction") });
    expect(ctx({ type: "source", fileId: file.id })).toMatchObject({
      name: "beta.pdf",
      path: expect.stringContaining("Beta blockers"),
    });
    expect(ctx({ type: "source", fileId: file.id, pageId: pages[0]?.id })).toMatchObject({
      name: "beta.pdf, page 1",
      preview: expect.stringContaining("Slide one."),
    });
    expect(ctx({ type: "question", questionId: made.created[0]?.id })).toMatchObject({
      name: expect.stringContaining("Which agent is cardioselective?"),
      path: expect.stringContaining("Beta blockers"),
      nodeId: lecture.id,
      note: null,
    });
    // Someone else's question does not exist for her.
    const theirs = t.spine(t.bob, "Theirs");
    const bobQuestion = t.services.practice.createQuestions(agentAuth(t.bob), {
      nodeIds: [theirs.lecture.id],
      questions: [
        fx.mc({ fileId: "", pageId: "", quote: "" }, { sources: [], generalKnowledge: true }),
      ],
    });
    expect(
      thrown(() =>
        t.services.requests.create(t.she, {
          target: { type: "question", questionId: bobQuestion.created[0]?.id as string },
          kind: "other",
          message: "x",
        }),
      ).code,
    ).toBe("not_found");
  });
});

describe("a request id lifts protection only when it is verified", () => {
  async function protectedDocument() {
    const t = composed();
    const { lecture, cite } = await lectureWithSource(t);
    const doc = t.services.documents.createDocument(t.bot, {
      nodeId: lecture.id,
      kind: "lecture_note",
      title: "Beta blockers",
      blocks: [
        heading("Beta blockers", 1),
        para("Hers, edited.", [{ ...cite(1, QUOTE_ONE), label: "s1" }]),
        para("Hers, reviewed.", [{ ...cite(2, QUOTE_TWO), label: "s2" }]),
      ],
    } as never);
    const [, edited, reviewed] = doc.blockIds as string[];
    t.services.documents.updateBlock(t.she, {
      documentId: doc.documentId,
      blockId: edited as string,
      mode: "patch",
      patch: { content: { text: "Hers, edited by her." } },
    } as never);
    t.services.documents.setReview(t.she, {
      documentId: doc.documentId,
      status: "reviewed",
      blockIds: [reviewed as string],
    });
    const keyA = newId("apiKey");
    const keyB = newId("apiKey");
    const a = agentAuth(t.alice, keyA, "write", "Agent A");
    const b = agentAuth(t.alice, keyB, "write", "Agent B");
    const ask = (blockId: string | null) =>
      t.services.requests.create(t.she, {
        target: blockId
          ? { type: "block", documentId: doc.documentId, blockId }
          : { type: "document", documentId: doc.documentId },
        kind: "wrong",
        message: "this is wrong",
      });
    const patch = (who: typeof a, blockId: string, requestId?: string) =>
      t.services.documents.updateBlock(who, {
        documentId: doc.documentId,
        blockId,
        mode: "patch",
        patch: { content: { text: "Fixed by an agent." } },
        ...(requestId ? { requestId } : {}),
      } as never);
    return { t, doc, edited: edited as string, reviewed: reviewed as string, a, b, ask, patch };
  }

  it("refuses an unknown, unclaimed, someone else's or wrong-target request, and teaches why", async () => {
    const { t, edited, reviewed, a, b, ask, patch } = await protectedDocument();
    // No request at all, and one that does not exist.
    expect(thrown(() => patch(a, edited)).code).toBe("forbidden");
    const unknown = thrown(() => patch(a, edited, "req_01HZX3K9Q2V7M4N8P6R5T0W1YB"));
    expect(unknown.code).toBe("forbidden");
    expect(unknown.message).toMatch(/does not let you change block/);
    expect(unknown.message).toMatch(/claimed with this very API key/);

    const request = ask(edited);
    // Waiting (nobody claimed it): refused.
    expect(thrown(() => patch(a, edited, request.id)).message).toMatch(/does not let you/);
    // Claimed by B: A is refused, B is allowed.
    t.services.requests.claim(b, request.id);
    expect(thrown(() => patch(a, edited, request.id)).code).toBe("forbidden");
    // A request on one block never covers another block.
    expect(thrown(() => patch(b, reviewed, request.id)).code).toBe("forbidden");
    const done = patch(b, edited, request.id);
    expect(done.block).toBeDefined();
    // The change is attributed to the agent and says which request it answered.
    const feed = t.changes().filter((c) => c.requestId === request.id);
    expect(feed.some((c) => c.action === "block.edited")).toBe(true);
    // Once a request is completed it lifts nothing.
    const second = ask(reviewed);
    t.services.requests.claim(b, second.id);
    t.services.requests.complete(b, second.id, { reply: "Looked, nothing to change.", links: [] });
    expect(thrown(() => patch(b, reviewed, second.id)).code).toBe("forbidden");
  });

  it("a document-wide request covers every block of it, and a lapsed claim covers none", async () => {
    const { t, edited, reviewed, b, ask, patch } = await protectedDocument();
    const wide = ask(null);
    t.services.requests.claim(b, wide.id, { ttlSeconds: 60 });
    expect(() => patch(b, reviewed, wide.id)).not.toThrow();
    t.clock.advance(61_000);
    expect(thrown(() => patch(b, edited, wide.id)).message).toMatch(/does not let you/);
  });

  it("regeneration with a block request replaces only that block and holds the others back", async () => {
    const { t, doc, edited, reviewed, b, ask } = await protectedDocument();
    const request = ask(edited);
    t.services.requests.claim(b, request.id);
    const out = t.services.documents.replaceGenerated(b, {
      documentId: doc.documentId,
      requestId: request.id,
      blocks: [para("Replacement text.", [])].map((x) => ({ ...x, generalKnowledge: true })),
    } as never);
    expect(out.removed).toContain(edited);
    expect(out.skipped.map((s) => s.blockId)).toEqual([reviewed]);
    // With no valid request at all, the same call is refused outright.
    const none = thrown(() =>
      t.services.documents.replaceGenerated(b, {
        documentId: doc.documentId,
        requestId: "req_01HZX3K9Q2V7M4N8P6R5T0W1YB",
        blocks: [{ ...para("x", []), generalKnowledge: true }],
      } as never),
    );
    expect(none.code).toBe("forbidden");
  });
});

describe("what concepts and questions see of the documents and practice tables", () => {
  it("finds mentions through the block index as blocks change and documents go", async () => {
    const t = composed();
    const { lecture } = t.spine();
    const made = t.services.concepts.bulkUpsert(t.bot, {
      concepts: [{ type: "drug", name: "metoprolol", generalKnowledge: true }],
    });
    const conceptId = made.concepts[0]?.id as string;
    const doc = t.services.documents.createDocument(t.bot, {
      nodeId: lecture.id,
      kind: "lecture_note",
      title: "Beta blockers",
      blocks: [
        {
          type: "paragraph",
          content: {
            text: [{ text: "Use " }, { concept: conceptId, text: "metoprolol" }, { text: "." }],
          },
          generalKnowledge: true,
        },
        { ...para("No mention here."), generalKnowledge: true },
      ],
    } as never);
    const mentions = () => t.services.concepts.page(t.she, conceptId).mentions;
    expect(mentions()).toHaveLength(1);
    expect(mentions()[0]).toMatchObject({
      documentId: doc.documentId,
      blockId: doc.blockIds[0],
      title: "Beta blockers",
      nodeId: lecture.id,
      trashed: false,
    });
    // Rewriting the block without the mention drops it; adding one to the other adds it.
    t.services.documents.updateBlock(t.bot, {
      documentId: doc.documentId,
      blockId: doc.blockIds[1],
      mode: "patch",
      patch: { content: { text: [{ concept: conceptId, text: "metoprolol" }] } },
    } as never);
    expect(
      mentions()
        .map((m) => m.blockId)
        .sort(),
    ).toEqual([...doc.blockIds].sort());
    t.services.documents.updateBlock(t.bot, {
      documentId: doc.documentId,
      blockId: doc.blockIds[0],
      mode: "patch",
      patch: { content: { text: "Plain now." } },
    } as never);
    expect(mentions().map((m) => m.blockId)).toEqual([doc.blockIds[1]]);
    // Trashed with its lecture: still listed, marked trashed. Deleted for good: gone.
    t.services.library.trash(t.alice, lecture.id, t.she.actor);
    expect(mentions()[0]?.trashed).toBe(true);
    t.services.library.permanentDelete(t.alice, lecture.id, t.she.actor);
    expect(mentions()).toEqual([]);
    expect(count(t, "block_concepts")).toBe(0);
  });

  it("backfills the index for blocks that existed before the migration", () => {
    const dir = mkdtempSync(join(tmpdir(), "notes-mig-"));
    const all = readdirSync(join(import.meta.dirname, "../src/db/migrations")).sort();
    const src = join(import.meta.dirname, "../src/db/migrations");
    const before = join(dir, "migrations");
    mkdirSync(before);
    for (const f of all.filter((n) => n < "0611")) copyFileSync(join(src, f), join(before, f));
    const db = openDatabase(":memory:");
    migrate(db, before);
    const user = newId("user");
    const conceptId = newId("concept");
    db.prepare(
      `INSERT INTO documents (id, user_id, node_id, kind, title, review_status, revision, created_by,
         created_at, last_edited_by, updated_at) VALUES ('doc_x', ?, 'nod_x', 'free', 'T', 'unverified', 1, '{}', 'now', '{}', 'now')`,
    ).run(user);
    db.prepare(
      `INSERT INTO blocks (id, document_id, user_id, position, type, origin, review_status, last_edited_by, plain_text, data)
       VALUES ('blk_x', 'doc_x', ?, 0, 'paragraph', 'agent', 'unverified', '{}', 'x', ?)`,
    ).run(user, JSON.stringify({ content: { text: [{ concept: conceptId, text: "x" }] } }));
    for (const f of all.filter((n) => n >= "0611")) copyFileSync(join(src, f), join(before, f));
    migrate(db, before);
    expect(db.prepare("SELECT concept_id FROM block_concepts").all()).toEqual([
      { concept_id: conceptId },
    ]);
  });

  it("lists the questions tagged with a concept, hiding trashed ones, and checks citations like blocks", async () => {
    const t = composed();
    const { lecture, file, cite } = await lectureWithSource(t);
    const concept = t.services.concepts.bulkUpsert(t.bot, {
      concepts: [
        { type: "drug", name: "metoprolol", citations: [{ ...cite(1, QUOTE_ONE), label: "s1" }] },
      ],
    });
    const conceptId = concept.concepts[0]?.id as string;
    expect(concept.concepts[0]?.action).toBe("created");
    const made = t.services.practice.createQuestions(t.bot, {
      nodeIds: [lecture.id],
      questions: [fx.mc(cite(1, QUOTE_ONE), { conceptIds: [conceptId] })],
    });
    const questions = () => t.services.concepts.page(t.she, conceptId).questions;
    expect(questions()).toEqual([
      expect.objectContaining({ questionId: made.created[0]?.id, nodeId: lecture.id }),
    ]);
    t.services.library.trash(t.alice, lecture.id, t.she.actor);
    expect(questions()).toEqual([]);
    t.services.library.restore(t.alice, lecture.id, t.she.actor);
    expect(questions()).toHaveLength(1);

    // The concept page reports its source with the file name and page.
    expect(t.services.concepts.page(t.she, conceptId).sources[0]).toMatchObject({
      status: "available",
      fileName: "beta.pdf",
      pageIndex: 1,
    });

    // A wrong quote, an unknown page and a trashed file are refused for questions and concepts alike.
    const wrong = { ...cite(1, "Metoprolol cures everything") };
    expect(
      thrown(() =>
        t.services.practice.createQuestions(t.bot, {
          nodeIds: [lecture.id],
          questions: [fx.mc(wrong)],
        }),
      ).message,
    ).toMatch(/does not occur character for character/);
    const bad = t.services.concepts.bulkUpsert(t.bot, {
      concepts: [{ type: "drug", name: "atenolol", citations: [wrong] }],
      partial: true,
    });
    expect(bad.problems[0]?.message).toMatch(/not in the current transcript/);
    t.services.files.trash(t.she, file.id);
    expect(
      thrown(() =>
        t.services.practice.createQuestions(t.bot, {
          nodeIds: [lecture.id],
          questions: [fx.mc(cite(1, QUOTE_ONE))],
        }),
      ).message,
    ).toMatch(/in the trash/);
    const trashed = t.services.concepts.bulkUpsert(t.bot, {
      concepts: [{ type: "drug", name: "nadolol", citations: [cite(1, QUOTE_ONE)] }],
      partial: true,
    });
    expect(trashed.problems[0]?.message).toMatch(/in the trash/);
    expect(t.services.concepts.page(t.she, conceptId).sources[0]?.status).toBe("source_trashed");
  });
});

describe("plain-words traces for questions, concepts, requests and exams", () => {
  it("agent work reads as sentences in the log; hers is in the feed only; a bulk upsert is one entry", async () => {
    const t = composed();
    const { course, lecture, cite } = await lectureWithSource(t);
    const before = t.activity().length;
    const feedBefore = t.changes().length;

    t.services.practice.createQuestions(t.bot, {
      nodeIds: [lecture.id],
      questions: [fx.mc(cite(1, QUOTE_ONE)), fx.flash(cite(2, QUOTE_TWO))],
    });
    t.services.concepts.bulkUpsert(t.bot, {
      concepts: [
        { type: "drug", name: "metoprolol", generalKnowledge: true },
        { type: "adverse_effect", name: "bradycardia", generalKnowledge: true },
      ],
      relations: [
        {
          from: { type: "drug", name: "metoprolol" },
          to: { type: "adverse_effect", name: "bradycardia" },
          type: "causes_adverse_effect",
          generalKnowledge: true,
        },
      ],
    });
    t.services.exams.createExam(t.bot, {
      courseId: course.id,
      title: "Exam 2",
      date: "2026-12-14",
      nodeIds: [lecture.id],
    });
    // Hers: a question of her own, a request, an exam change.
    t.services.requests.create(t.she, {
      target: { type: "node", nodeId: lecture.id },
      kind: "summarise",
      message: "",
    });

    const words = t.activity().map((a) => a.summary);
    expect(words).toContain(
      "Wrote 2 practice questions (1 multiple choice, 1 flashcard) for lecture 07 · Beta blockers",
    );
    expect(words).toContain(
      "Updated the concept map: 2 concepts added, 0 updated, 1 relation added, 0 updated",
    );
    expect(words).toContain(
      'Added the exam "Exam 2" on 2026-12-14 for course Pharmacology II, covering 1 item',
    );
    expect(t.activity().length - before).toBe(3);
    // One feed entry for the whole bulk call.
    const bulk = t.changes().filter((c) => c.action === "concept.upserted");
    expect(bulk).toHaveLength(1);
    expect(bulk[0]?.objectIds).toHaveLength(3);
    // Her request is in the feed, not in the log.
    expect(t.changes().some((c) => c.action === "request.created")).toBe(true);
    expect(words.join("\n")).not.toContain("Left a summarize request");
    expect(t.changes().length - feedBefore).toBe(4);
  });

  it("requests: claimed, answered with the reply, declined and handed back", async () => {
    const t = composed();
    const { lecture } = t.spine();
    const a = t.bot;
    const make = () =>
      t.services.requests.create(t.she, {
        target: { type: "node", nodeId: lecture.id },
        kind: "expand",
        message: "",
      });
    const first = make();
    t.services.requests.claim(a, first.id);
    t.services.requests.complete(a, first.id, { reply: "Added two slides of detail.", links: [] });
    const second = make();
    t.services.requests.claim(a, second.id);
    t.services.requests.release(a, second.id);
    t.services.requests.claim(a, second.id);
    t.services.requests.decline(a, second.id, { reason: "The slides do not say." });
    const words = t.activity().map((x) => x.summary);
    expect(words).toContain('Claimed an expand request on "Beta blockers"');
    expect(words).toContain(
      'Answered an expand request on "Beta blockers": Added two slides of detail.',
    );
    expect(words).toContain('Handed an expand request on "Beta blockers" back');
    expect(words).toContain(
      'Declined an expand request on "Beta blockers": The slides do not say.',
    );
    const actions = t.changes().map((c) => c.action);
    for (const wanted of [
      "request.created",
      "request.claimed",
      "request.completed",
      "request.released",
      "request.declined",
    ]) {
      expect(actions, wanted).toContain(wanted);
    }
    expect(t.activity().every((x) => x.keyLabel === "Claude Code")).toBe(true);
  });
});

describe("search finds questions and concepts", () => {
  it("all five kinds, ranked, paged with one cursor, restricted by kinds, never trashed ones", async () => {
    const t = composed();
    const { lecture, cite } = await lectureWithSource(t);
    t.services.concepts.bulkUpsert(t.bot, {
      concepts: [
        {
          type: "drug",
          name: "Cardioselective agent",
          aliases: ["beta-1 blocker"],
          generalKnowledge: true,
        },
      ],
    });
    t.services.practice.createQuestions(t.bot, {
      nodeIds: [lecture.id],
      questions: [fx.mc(cite(1, QUOTE_ONE), { prompt: "Which cardioselective agent is it?" })],
    });
    t.services.documents.createDocument(t.bot, {
      nodeId: lecture.id,
      kind: "lecture_note",
      title: "Notes",
      blocks: [{ ...para("A cardioselective block."), generalKnowledge: true }],
    } as never);
    t.services.library.update(
      t.alice,
      lecture.id,
      { name: "Cardioselective lecture" },
      t.she.actor,
    );

    const kinds = (q: Json) => t.services.search.search(t.alice, q).items.map((h) => h.kind);
    const all = t.services.search.search(t.alice, { q: "cardioselective" });
    expect(new Set(all.items.map((h) => h.kind))).toEqual(
      new Set(["node", "concept", "block", "question", "page"]),
    );
    // Name matches first, then the concept, then block, question and raw page.
    expect(all.items.map((h) => h.kind)).toEqual(["node", "concept", "block", "question", "page"]);
    expect(all.items.find((h) => h.kind === "concept")).toMatchObject({
      name: "Cardioselective agent",
      conceptType: "drug",
    });
    expect(all.items.find((h) => h.kind === "question")).toMatchObject({
      questionType: "multiple_choice",
      nodeId: lecture.id,
    });
    // Only the kinds asked for.
    expect(kinds({ q: "cardioselective", kinds: ["question", "concept"] })).toEqual([
      "concept",
      "question",
    ]);
    // Alias match.
    expect(kinds({ q: "beta-1", kinds: ["concept"] })).toEqual(["concept"]);
    // One cursor over every kind, no repeats, no gaps.
    for (const size of [1, 2, 3]) {
      const seen: unknown[] = [];
      let cursor: string | undefined;
      for (let guard = 0; guard < 10; guard++) {
        const page = t.services.search.search(t.alice, {
          q: "cardioselective",
          limit: size,
          ...(cursor ? { cursor } : {}),
        });
        seen.push(...page.items);
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      expect(seen, `limit ${size}`).toEqual(all.items);
    }
    // A cursor from before questions and concepts were searched still works.
    const old = Buffer.from(JSON.stringify({ n: 0, b: 0, p: 0 })).toString("base64url");
    expect(() =>
      t.services.search.search(t.alice, { q: "cardioselective", cursor: old }),
    ).not.toThrow();
    // Trashed lecture: the question and the document's block are gone, and come back.
    t.services.library.trash(t.alice, lecture.id, t.she.actor);
    expect(new Set(kinds({ q: "cardioselective" }))).toEqual(new Set(["concept", "page"]));
    t.services.library.restore(t.alice, lecture.id, t.she.actor);
    expect(kinds({ q: "cardioselective" })).toContain("question");
    // Another user finds none of it.
    expect(t.services.search.search(t.bob, { q: "cardioselective" }).items).toEqual([]);
  });
});

describe("configuration", () => {
  it("RXNORM_CHECK is validated and off unless it is exactly 1", () => {
    expect(loadConfig({ NODE_ENV: "test" }).RXNORM_CHECK).toBe(false);
    expect(loadConfig({ NODE_ENV: "test", RXNORM_CHECK: "0" }).RXNORM_CHECK).toBe(false);
    expect(loadConfig({ NODE_ENV: "test", RXNORM_CHECK: "" }).RXNORM_CHECK).toBe(false);
    expect(loadConfig({ NODE_ENV: "test", RXNORM_CHECK: "1" }).RXNORM_CHECK).toBe(true);
    expect(() => loadConfig({ NODE_ENV: "test", RXNORM_CHECK: "yes" })).toThrow(/RXNORM_CHECK/);
    const t = composed();
    expect(nameCheckerFromConfig(t.db, { RXNORM_CHECK: false })).toBeUndefined();
    expect(nameCheckerFromConfig(t.db, {})).toBeUndefined();
    expect(nameCheckerFromConfig(t.db, { RXNORM_CHECK: true })).toBeDefined();
  });
});
