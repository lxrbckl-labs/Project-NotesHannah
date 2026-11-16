import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { blockPlainText, CreatedApiKey } from "@notes/schema";
import { describe, expect, it } from "vitest";
import { createServices } from "../src/services.js";
import { initStorage } from "../src/storage/storage.js";
import { FakeConverter, type Json, PDF, variant } from "./files.support.js";
import { makeTestApp, ORIGIN } from "./helpers.js";
import { fx } from "./practice-helpers.js";

const PW = "correct horse battery";
const SLIDE_1 = "Beta blockers end in -olol. Metoprolol and atenolol are cardioselective.";
const SLIDE_2 = "Propranolol is nonselective and causes bronchospasm in asthma.";
const SLIDE_3 = "Never stop a beta blocker abruptly: rebound tachycardia.";

/**
 * The second part of the day: after the guide is written, the agent builds the concept map and a
 * question set, she practises, leaves a request, an agent answers it, an exam tracks progress, search
 * finds everything, and the lecture goes through the trash and back. All over HTTP on the composed app.
 */
describe("end to end: concepts, questions, practice, requests and exams", () => {
  it("the whole story", async () => {
    const dir = mkdtempSync(join(tmpdir(), "notes-e2e2-"));
    const { storage } = initStorage(dir);
    const t = makeTestApp({
      env: { DATA_DIR: dir, APP_ORIGIN: ORIGIN },
      services: (deps) =>
        createServices(deps, {
          files: { storage, signingSecret: "e2e2-secret", partialGraceMs: 0, log: () => {} },
        }),
    });
    const services = t.services;
    if (!services) throw new Error("services");
    const converter = new FakeConverter(storage.root);
    const hannah = await t.addUser("hannah", PW);
    await t.addUser("sam", PW);
    const she = (await t.signIn("hannah", PW)).cookies;
    const sam = (await t.signIn("sam", PW)).cookies;

    const keyOf = async (name: string) =>
      CreatedApiKey.parse(
        (await t.request("/api/keys", { cookies: she, body: { name, scope: "write" } })).body,
      );
    const claude = await keyOf("Claude Code");
    const codex = await keyOf("Codex");

    type Res = { status: number; body: Json };
    const user = (method: string, path: string, body?: unknown, cookies = she): Promise<Res> =>
      t.request(path, { method, cookies, ...(body === undefined ? {} : { body }) });
    const agentWith =
      (secret: string) =>
      (method: string, path: string, body?: unknown): Promise<Res> =>
        t.request(path, {
          method,
          bearer: secret,
          origin: null,
          ...(body === undefined ? {} : { body }),
        });
    const agent = agentWith(claude.secret);
    const otherAgent = agentWith(codex.secret);
    const ok = async (res: Promise<Res>, status = 200): Promise<Json> => {
      const got = await res;
      expect(got.status, JSON.stringify(got.body)).toBe(status);
      return got.body;
    };

    // ---- the day so far (compact): spine, source, transcripts, a study guide --------------
    const { node: term } = await ok(
      user("POST", "/api/nodes", { parentId: null, kind: "term", name: "Fall 2026" }),
      201,
    );
    const { node: course } = await ok(
      user("POST", "/api/nodes", { parentId: term.id, kind: "course", name: "Pharmacology II" }),
      201,
    );
    const sections = (await ok(user("GET", `/api/nodes?parentId=${course.id}`))).items;
    const { node: lecture } = await ok(
      user("POST", "/api/nodes", {
        parentId: sections.find((s: Json) => s.section === "lectures").id,
        kind: "lecture",
        name: "Beta blockers",
        lecture: { number: 7, date: "2026-10-14" },
      }),
      201,
    );
    const bytes = variant(PDF, "story");
    const { items: tickets } = await ok(
      agent("POST", "/api/uploads/tickets", {
        files: [{ name: "beta-blockers.pdf", bytes: bytes.length }],
      }),
      201,
    );
    const put = await t.app.request(new URL(tickets[0].url).pathname, {
      method: "PUT",
      body: bytes,
      duplex: "half",
    } as RequestInit);
    expect(put.status).toBe(201);
    const fileId = ((await put.json()) as Json).file.id as string;
    converter.succeed(converter.pending()[0] as string, { pages: 3, type: "pdf" });
    services.files.processQueue();
    const pages = (await ok(agent("GET", `/api/files/${fileId}/pages`))).items as Json[];
    for (const [i, text] of [SLIDE_1, SLIDE_2, SLIDE_3].entries()) {
      await ok(agent("PUT", `/api/pages/${pages[i]?.id}/transcript`, { text, flags: [] }), 201);
    }
    await ok(agent("POST", `/api/files/${fileId}/file`, { nodeId: lecture.id }));
    const cite = (page: number, quote: string) => ({
      fileId,
      pageId: pages[page - 1]?.id,
      quote,
      label: `Slide ${page}`,
    });
    const made = await ok(
      agent("POST", "/api/documents", {
        nodeId: lecture.id,
        kind: "lecture_note",
        title: "Beta blockers",
        blocks: [
          { type: "heading", content: { level: 1, text: "Beta blockers" } },
          {
            type: "paragraph",
            content: { text: "Metoprolol and atenolol are cardioselective." },
            citations: [cite(1, "Metoprolol and atenolol are cardioselective.")],
          },
          {
            type: "paragraph",
            content: { text: "Propranolol is nonselective." },
            citations: [cite(2, "Propranolol is nonselective")],
          },
        ],
      }),
      201,
    );
    const documentId = made.documentId as string;
    const [, cardio, nonselective] = made.blockIds as string[];

    // ---- the agent builds the concept map, citing the pages ----------------------------------
    const bulk = await ok(
      agent("POST", "/api/concepts/bulk", {
        concepts: [
          {
            type: "drug",
            name: "metoprolol",
            summary: "Cardioselective beta blocker.",
            citations: [cite(1, "Metoprolol and atenolol are cardioselective.")],
          },
          {
            type: "drug",
            name: "propranolol",
            citations: [cite(2, "Propranolol is nonselective")],
          },
          {
            type: "adverse_effect",
            name: "bronchospasm",
            citations: [cite(2, "causes bronchospasm in asthma")],
          },
        ],
        relations: [
          {
            from: { type: "drug", name: "propranolol" },
            to: { type: "adverse_effect", name: "bronchospasm" },
            type: "causes_adverse_effect",
            citations: [cite(2, "causes bronchospasm in asthma")],
          },
        ],
      }),
    );
    expect(bulk).toMatchObject({ applied: true, created: 4 });
    const metoprolol = bulk.concepts[0].id as string;
    const propranolol = bulk.concepts[1].id as string;
    // A citation with a quote that is not on the page is refused for concepts too.
    const badConcept = await agent("POST", "/api/concepts/bulk", {
      concepts: [{ type: "drug", name: "nadolol", citations: [cite(1, "Nadolol is a miracle")] }],
    });
    expect(badConcept.status).toBe(400);

    // ... and mentions them in the study guide.
    await ok(
      agent("POST", `/api/documents/${documentId}/blocks`, {
        blocks: [
          {
            type: "paragraph",
            content: {
              text: [
                { text: "Compare " },
                { concept: metoprolol, text: "metoprolol" },
                { text: " with " },
                { concept: propranolol, text: "propranolol" },
                { text: "." },
              ],
            },
            generalKnowledge: true,
          },
        ],
      }),
      201,
    );

    // ---- the agent authors a mixed question set citing the pages -----------------------------
    const authored = await ok(
      agent("POST", "/api/practice/questions", {
        nodeIds: [lecture.id],
        questions: [
          fx.mc(cite(1, "Metoprolol and atenolol are cardioselective."), {
            prompt: "Which agent is cardioselective? (story-one)",
            conceptIds: [metoprolol],
          }),
          fx.mc(cite(2, "Propranolol is nonselective"), {
            prompt: "Which agent is nonselective? (story-two)",
            conceptIds: [propranolol],
          }),
          fx.fill(cite(3, "Never stop a beta blocker abruptly"), { conceptIds: [metoprolol] }),
          fx.flash(cite(3, "rebound tachycardia"), {}),
        ],
      }),
      201,
    );
    expect(authored.stored).toBe(4);
    const [mcOne, mcTwo, fill, flash] = authored.created.map((c: Json) => c.id as string);
    // An invented quote is refused for questions too, and nothing is stored.
    const invented = await agent("POST", "/api/practice/questions", {
      nodeIds: [lecture.id],
      questions: [fx.mc(cite(1, "Metoprolol cures everything"))],
    });
    expect(invented.status).toBe(400);
    expect(JSON.stringify(invented.body)).toMatch(/character for character/);

    // ---- she practises: answers, misses some ---------------------------------------------------
    const started = await ok(
      user("POST", "/api/practice/sessions", {
        scope: { kind: "nodes", nodeIds: [lecture.id] },
        length: 10,
        seed: 11,
      }),
      201,
    );
    const sessionId = started.session.id as string;
    const miss = new Set([mcTwo, fill]);
    let answered = 0;
    for (let guard = 0; guard < 10; guard++) {
      const next = (await ok(user("GET", `/api/practice/sessions/${sessionId}/next`))).next;
      if (!next) break;
      const wrong = miss.has(next.questionId);
      const answer =
        next.type === "multiple_choice"
          ? { type: "multiple_choice", optionId: wrong ? "b" : "a" }
          : next.type === "fill_blank"
            ? {
                type: "fill_blank",
                blanks: wrong ? ["wrong", "wrong"] : ["zorvanide", "heart rate"],
              }
            : { type: "flashcard", rating: "good" };
      await ok(user("POST", `/api/practice/sessions/${sessionId}/answer`, { answer }));
      answered++;
    }
    expect(answered).toBe(4);
    const results = await ok(user("GET", `/api/practice/sessions/${sessionId}/results`));
    expect(results.items.filter((i: Json) => i.correct === false)).toHaveLength(2);

    // The notebook and weak areas show what she missed.
    const notebook = await ok(user("GET", "/api/practice/notebook"));
    expect(notebook.items.map((e: Json) => e.questionId).sort()).toEqual([mcTwo, fill].sort());
    const weak = await ok(user("GET", "/api/practice/weak-areas?minAttempts=1&minQuestions=1"));
    const tag = weak.byTag.find((a: Json) => a.key === "beta-blockers");
    expect(tag).toMatchObject({ attempts: 3, correct: 1 });
    const metoprololArea = weak.byConcept.find((a: Json) => a.key === metoprolol);
    expect(metoprololArea).toMatchObject({ attempts: 2, correct: 1 });

    // ---- an exam covering the lecture shows progress -------------------------------------------
    const { exam } = await ok(
      user("POST", "/api/exams", {
        courseId: course.id,
        title: "Exam 2",
        date: "2026-12-14",
        nodeIds: [lecture.id],
      }),
      201,
    );
    const examProgress = async () => (await ok(user("GET", `/api/exams/${exam.id}`))).exam.progress;
    expect(await examProgress()).toMatchObject({
      questions: 4,
      attempted: 4,
      attempts: 4,
      correct: 2,
    });

    // ---- she leaves a request on a block; edit protection is real --------------------------------
    // She edits the cardioselective block (it becomes hers), then says "this is wrong".
    const light = await ok(user("GET", `/api/documents/${documentId}`));
    await ok(
      user("PATCH", `/api/documents/${documentId}/blocks/${cardio}`, {
        patch: { content: { text: "Metoprolol and atenolol are cardioselective (her words)." } },
        expectedRevision: light.document.revision,
      }),
    );
    const { request } = await ok(
      user("POST", "/api/requests", {
        target: { type: "block", documentId, blockId: cardio },
        kind: "wrong",
        message: "Atenolol is the hydrophilic one, say so.",
      }),
      201,
    );
    expect(request.context).toMatchObject({
      name: "Beta blockers",
      preview: expect.stringContaining("her words"),
    });
    const fix = {
      patch: {
        content: { text: "Metoprolol and atenolol are cardioselective; atenolol is hydrophilic." },
      },
      requestId: request.id,
    };
    // Nobody has claimed it: refused. A different key claims it: the first key is still refused.
    expect(
      (await agent("PATCH", `/api/documents/${documentId}/blocks/${cardio}`, fix)).status,
    ).toBe(403);
    await ok(otherAgent("POST", `/api/requests/${request.id}/claim`, {}));
    const refused = await agent("PATCH", `/api/documents/${documentId}/blocks/${cardio}`, fix);
    expect(refused.status).toBe(403);
    expect(refused.body.error.message).toMatch(/claimed with this very API key/);
    // A request on one block never opens another; and without any request her block stays hers.
    expect(
      (await otherAgent("PATCH", `/api/documents/${documentId}/blocks/${nonselective}`, fix))
        .status,
    ).toBe(200); // not hers: an agent block, free to change
    expect(
      (await agent("PATCH", `/api/documents/${documentId}/blocks/${cardio}`, { patch: fix.patch }))
        .status,
    ).toBe(403);
    // The claiming agent edits through the request and answers it.
    await ok(otherAgent("PATCH", `/api/documents/${documentId}/blocks/${cardio}`, fix));
    const done = await ok(
      otherAgent("POST", `/api/requests/${request.id}/complete`, {
        reply: "Added that atenolol is hydrophilic, from slide 1.",
        links: [],
      }),
    );
    expect(done.request).toMatchObject({ status: "done" });
    expect(done.request.reply.text).toContain("hydrophilic");
    const blockNow = await ok(user("GET", `/api/documents/${documentId}/blocks/${cardio}`));
    expect(blockPlainText(blockNow.block)).toContain("hydrophilic");
    expect(blockNow.block.origin).toBe("agent");

    // ---- the concept page lists mentions and questions ------------------------------------------
    const page = await ok(user("GET", `/api/concepts/${metoprolol}/page`));
    expect(page.mentions.map((m: Json) => [m.documentId, m.title])).toEqual([
      [documentId, "Beta blockers"],
    ]);
    expect(page.questions.map((q: Json) => q.questionId).sort()).toEqual([mcOne, fill].sort());
    expect(page.sources[0]).toMatchObject({
      status: "available",
      fileName: "beta-blockers.pdf",
      pageIndex: 1,
    });

    // ---- search returns all five kinds ----------------------------------------------------------
    const kindsOf = async (q: string, extra = "") =>
      (
        (await ok(user("GET", `/api/search?q=${encodeURIComponent(q)}${extra}`))).items as Json[]
      ).map((h) => h.kind);
    // "beta" is in the lecture's name, a concept's summary is not searched, so use words each holds.
    await ok(user("PATCH", `/api/nodes/${lecture.id}`, { name: "Beta blockers cardioselective" }));
    const found = await kindsOf("cardioselective");
    expect(new Set(found)).toEqual(new Set(["node", "page", "block", "question"]));
    await ok(
      user("PATCH", `/api/concepts/${metoprolol}`, { aliases: ["cardioselective prototype"] }),
    );
    expect(new Set(await kindsOf("cardioselective"))).toEqual(
      new Set(["node", "concept", "page", "block", "question"]),
    );
    expect(await kindsOf("metoprolol", "&kinds=concept,question")).toEqual(["concept"]);

    // ---- the lecture goes to the trash -----------------------------------------------------------
    await ok(user("POST", `/api/nodes/${lecture.id}/trash`));
    expect((await user("GET", `/api/documents/${documentId}`)).status).toBe(404);
    expect((await ok(user("GET", "/api/practice/questions"))).items).toEqual([]);
    expect((await user("GET", `/api/practice/questions/${mcOne}`)).status).toBe(404);
    expect(await examProgress()).toMatchObject({ questions: 0 });
    expect((await ok(user("GET", `/api/concepts/${metoprolol}/page`))).questions).toEqual([]);
    expect((await ok(user("GET", `/api/concepts/${metoprolol}/page`))).mentions[0].trashed).toBe(
      true,
    );
    expect(new Set(await kindsOf("cardioselective"))).toEqual(new Set(["concept", "page"]));
    const unfiled = (await ok(user("GET", `/api/files/${fileId}`))).file;
    expect(unfiled).toMatchObject({ nodeId: null, trashedAt: null });
    expect((await ok(user("GET", "/api/files?inbox=true"))).items.map((f: Json) => f.id)).toEqual([
      fileId,
    ]);
    expect((await ok(user("GET", "/api/practice/notebook"))).items).toEqual([]);
    // Her answers are still on record.
    expect((t.db.prepare("SELECT COUNT(*) AS n FROM attempts").get() as { n: number }).n).toBe(4);

    // ---- restore: it all comes back -----------------------------------------------------------------
    await ok(user("POST", `/api/nodes/${lecture.id}/restore`));
    expect((await user("GET", `/api/documents/${documentId}`)).status).toBe(200);
    expect(
      ((await ok(user("GET", "/api/practice/questions"))).items as Json[]).map((q) => q.id).sort(),
    ).toEqual([mcOne, mcTwo, fill, flash].sort());
    expect(await examProgress()).toMatchObject({ questions: 4, attempts: 4, correct: 2 });
    expect(
      (await ok(user("GET", "/api/practice/notebook"))).items.map((e: Json) => e.questionId).sort(),
    ).toEqual([mcTwo, fill].sort());
    expect((await ok(user("GET", `/api/concepts/${metoprolol}/page`))).questions).toHaveLength(2);
    expect((await ok(user("GET", `/api/files/${fileId}`))).file).toMatchObject({
      nodeId: lecture.id,
      status: "filed",
    });
    expect(new Set(await kindsOf("cardioselective"))).toEqual(
      new Set(["node", "concept", "page", "block", "question"]),
    );
    const attempts = (await ok(user("GET", `/api/practice/questions/${mcTwo}/attempts`)))
      .items as Json[];
    expect(attempts).toHaveLength(1);

    // ---- the activity log: the agents' work, in words; none of hers ------------------------------------
    const log = (await ok(user("GET", "/api/activity?limit=200"))).items as Json[];
    const words = log.map((a) => a.summary as string);
    expect(words).toContain(
      "Wrote 4 practice questions (2 multiple choice, 1 fill-in-the-blank, 1 flashcard) for lecture 07 · Beta blockers",
    );
    expect(words.some((w) => w.startsWith("Updated the concept map: 3 concepts added"))).toBe(true);
    expect(words).toContain('Claimed a wrong request on "Beta blockers"');
    expect(
      words.some((w) =>
        w.startsWith('Answered a wrong request on "Beta blockers": Added that atenolol'),
      ),
    ).toBe(true);
    expect(new Set(log.map((a) => a.keyId))).toEqual(new Set([claude.key.id, codex.key.id]));
    for (const hers of ["Exam 2", "practice session", "Left a wrong request", "Fall 2026"]) {
      expect(words.join("\n"), hers).not.toContain(hers);
    }
    // The change feed has hers too, as her.
    const feed = (await ok(user("GET", "/api/changes?limit=500"))).items as Json[];
    const actions = new Set(feed.map((c) => c.action));
    for (const action of [
      "question.authored",
      "concept.upserted",
      "exam.created",
      "request.created",
      "request.claimed",
      "request.completed",
    ]) {
      expect(actions, action).toContain(action);
    }
    expect(feed.find((c) => c.action === "exam.created")?.actor).toEqual({
      type: "user",
      userId: hannah.id,
    });

    // ---- a second user sees none of it ------------------------------------------------------------------
    const bob = (path: string) => user("GET", path, undefined, sam);
    expect((await ok(bob("/api/search?q=cardioselective"))).items).toEqual([]);
    expect((await ok(bob("/api/practice/questions"))).items).toEqual([]);
    expect((await ok(bob("/api/practice/notebook"))).items).toEqual([]);
    expect((await ok(bob("/api/exams"))).items).toEqual([]);
    expect((await ok(bob("/api/requests?status=waiting,in_progress,done,declined"))).items).toEqual(
      [],
    );
    expect((await ok(bob("/api/concepts/search?q=metoprolol"))).items ?? []).toEqual([]);
    expect((await ok(bob("/api/activity"))).items).toEqual([]);
    expect((await ok(bob("/api/changes"))).items).toEqual([]);
    for (const path of [
      `/api/practice/questions/${mcOne}`,
      `/api/practice/sessions/${sessionId}`,
      `/api/exams/${exam.id}`,
      `/api/requests/${request.id}`,
      `/api/concepts/${metoprolol}`,
      `/api/concepts/${metoprolol}/page`,
      `/api/documents/${documentId}`,
    ]) {
      expect((await bob(path)).status, path).toBe(404);
    }
  });
});
