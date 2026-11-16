import { describe, expect, it, vi } from "vitest";
import { HttpDocumentStore } from "../src/features/documents";
import { nodeHref } from "../src/features/library/rules";
import { createRealPracticeStore } from "../src/features/mounts/practiceStore";
import type { AppHttp } from "../src/lib/api";

function fakeHttp(
  routes: Record<string, (body?: unknown, query?: Record<string, unknown>) => unknown>,
) {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const call = (method: string) => async (path: string, arg?: unknown) => {
    calls.push({ method, path, body: method === "GET" ? undefined : arg });
    const handler = routes[`${method} ${path}`];
    if (!handler) throw new Error(`unexpected ${method} ${path}`);
    return handler(
      method === "GET" ? undefined : arg,
      method === "GET" ? (arg as Record<string, unknown>) : undefined,
    );
  };
  const http = {
    get: call("GET"),
    post: call("POST"),
    patch: call("PATCH"),
    put: call("PUT"),
    del: call("DELETE"),
  } as unknown as AppHttp;
  return { http, calls };
}

const session = (overrides = {}) => ({
  id: "ses_1",
  scope: { kind: "nodes", nodeIds: ["nod_1"] },
  status: "active",
  startedAt: "2026-11-16T10:00:00.000Z",
  finishedAt: null,
  total: 2,
  answered: 0,
  shortfall: 0,
  items: [
    { position: 1, questionId: "qst_a", type: "calculation", answered: false },
    { position: 2, questionId: "qst_b", type: "matching", answered: false },
  ],
  ...overrides,
});

describe("practice store on the real routes", () => {
  it("serves a calculation and a matching question in the module's shape, without answers", async () => {
    const { http } = fakeHttp({
      "GET /nodes/nod_1": () => ({ node: { name: "Lecture 7" } }),
      "GET /practice/sessions/ses_1": () => ({ session: session() }),
      "GET /practice/sessions/ses_1/items/1": () => ({
        answered: false,
        question: {
          position: 1,
          total: 2,
          questionId: "qst_a",
          type: "calculation",
          selfGraded: false,
          view: { type: "calculation", prompt: "70 kg x 5 mg/kg?", needsUnit: true },
        },
      }),
    });
    const store = createRealPracticeStore(http);
    const state = await store.getSession("ses_1");
    expect(state.scopeLabel).toBe("Lecture 7");
    expect(state.total).toBe(2);
    expect(state.current).toMatchObject({
      type: "calculation",
      prompt: "70 kg x 5 mg/kg?",
      index: 1,
      allowFractions: true,
    });
    if (state.current?.type !== "calculation") throw new Error("type");
    expect(state.current.unitChoices).toContain("mg");
    expect(JSON.stringify(state.current)).not.toMatch(/correct|answer"/);
  });

  it("keeps skipping in the browser: the server has no skip", async () => {
    sessionStorage.clear();
    const { http } = fakeHttp({
      "GET /nodes/nod_1": () => ({ node: { name: "Lecture 7" } }),
      "GET /practice/sessions/ses_1": () => ({ session: session() }),
      "GET /practice/sessions/ses_1/items/2": () => ({
        answered: false,
        question: {
          position: 2,
          total: 2,
          questionId: "qst_b",
          type: "matching",
          selfGraded: false,
          view: {
            type: "matching",
            prompt: "Match",
            left: [{ id: "a", text: "Veloxa" }],
            right: ["lorvanol"],
          },
        },
      }),
    });
    const store = createRealPracticeStore(http);
    const after = await store.skip("ses_1", 1);
    expect(after.items.map((i) => i.status)).toEqual(["skipped", "pending"]);
    expect(after.current).toMatchObject({ type: "matching", index: 2, rights: ["lorvanol"] });
  });

  it("starts a due session with the due scope and posts answers to /answer with the position", async () => {
    const post = vi.fn();
    const { http, calls } = fakeHttp({
      "POST /practice/sessions": (body) => {
        post(body);
        return { session: session() };
      },
      "GET /nodes/nod_1": () => ({ node: { name: "Lecture 7" } }),
      "GET /practice/sessions/ses_1": () => ({ session: session() }),
      "GET /practice/sessions/ses_1/items/1": () => ({
        answered: false,
        question: {
          position: 1,
          total: 2,
          questionId: "qst_a",
          type: "flashcard",
          selfGraded: true,
          view: { type: "flashcard", front: "F" },
        },
      }),
      "POST /practice/sessions/ses_1/answer": () => ({
        result: {
          correct: false,
          score: 0,
          points: 0,
          maxPoints: 1,
          feedback: "1000 times too large",
        },
        reveal: { type: "calculation", explanation: "70 x 5 = 350" },
        citations: [],
        generalKnowledge: false,
      }),
    });
    const store = createRealPracticeStore(http);
    await store.startSession({
      scope: { kind: "nodes", nodeIds: ["nod_1"] },
      formats: ["flashcard"],
      length: 5,
      dueOnly: true,
    });
    expect(post).toHaveBeenCalledWith({
      scope: { kind: "due", nodeIds: ["nod_1"] },
      formats: ["flashcard"],
      length: 5,
    });
    const outcome = await store.submitAnswer(
      "ses_1",
      1,
      { type: "calculation", value: "350000", unit: "mg" } as never,
      1200,
    );
    expect(outcome.explanation).toBe("70 x 5 = 350");
    expect(calls.at(-1)).toMatchObject({
      method: "POST",
      path: "/practice/sessions/ses_1/answer",
      body: { position: 1, timeTakenMs: 1200 },
    });
  });

  it("places an exam in the course found above its lecture", async () => {
    const posted = vi.fn();
    const { http } = fakeHttp({
      "GET /nodes/nod_lecture": () => ({
        node: {
          kind: "lecture",
          id: "nod_lecture",
          ancestors: ["nod_term", "nod_course", "nod_section"],
        },
      }),
      "GET /nodes/nod_term": () => ({ node: { kind: "term", id: "nod_term" } }),
      "GET /nodes/nod_course": () => ({ node: { kind: "course", id: "nod_course" } }),
      "POST /exams": (body) => {
        posted(body);
        return {
          exam: {
            id: "exm_1",
            courseId: "nod_course",
            courseName: "Pharmacology II",
            title: "Midterm",
            date: "2027-03-01",
            nodeIds: ["nod_lecture"],
            daysRemaining: 100,
            coverage: [],
            progress: { questions: 0, attempted: 0, accuracy: null, dueCards: 0, notebook: 0 },
          },
        };
      },
    });
    const store = createRealPracticeStore(http);
    const exam = await store.createExam({
      course: "ignored",
      title: "Midterm",
      date: "2027-03-01",
      nodeIds: ["nod_lecture"],
    });
    expect(posted).toHaveBeenCalledWith({
      courseId: "nod_course",
      title: "Midterm",
      date: "2027-03-01",
      nodeIds: ["nod_lecture"],
    });
    expect(exam).toMatchObject({ course: "Pharmacology II", daysRemaining: 100 });
  });
});

describe("documents store on the real routes", () => {
  it("sends a block request with the server's target and field names", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ request: { id: "req_1" } }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const store = new HttpDocumentStore({
      actor: { type: "user", userId: "usr_1" },
      fetch: fetcher as never,
    });
    const out = await store.createRequest({
      documentId: "doc_1",
      blockId: "blk_1",
      kind: "wrong",
      note: "not on the slide",
    });
    expect(out).toEqual({ id: "req_1" });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/requests");
    expect(JSON.parse(String(init.body))).toEqual({
      target: { type: "block", documentId: "doc_1", blockId: "blk_1" },
      kind: "wrong",
      message: "not on the slide",
    });
  });
});

describe("where an item opens", () => {
  it("opens lectures and documents as pages and everything else as a library page", () => {
    // the real build (not the mock) sends lectures and documents to /doc
    expect(nodeHref({ id: "nod_1", kind: "course" })).toBe("/library/nod_1");
    expect(nodeHref({ id: "nod_2", kind: "lecture" })).toMatch(/^\/(doc|library)\/nod_2$/);
  });
});
