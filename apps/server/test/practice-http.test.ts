import { newId } from "@notes/schema";
import { beforeEach, describe, expect, it } from "vitest";
import { errorCode, makeTestApp } from "./helpers.js";
import { type Env, fx, type Json, setupPractice } from "./practice-helpers.js";

let env: Env;
let ids: {
  q: string;
  flash: string;
  session: string;
  exam: string;
  node: string;
  course: string;
  page: string;
  file: string;
};

beforeEach(() => {
  env = setupPractice();
  const sp = env.spine();
  const { cite, pageId, fileId } = env.addPage();
  const made = env.service.createQuestions(env.bot, {
    nodeIds: [sp.lectures[0] as string],
    questions: [fx.mc(cite), fx.flash(cite)],
  });
  const exam = env.exams.createExam(env.she, {
    courseId: sp.course.id,
    title: "E",
    date: "2026-12-14",
    nodeIds: [sp.lectures[0] as string],
  });
  const { session } = env.service.startSession(env.she, {
    scope: { kind: "all" },
    length: 5,
    formats: ["multiple_choice", "flashcard"],
  });
  ids = {
    q: (made.created[0] as Json).id,
    flash: (made.created[1] as Json).id,
    session: session.id,
    exam: exam.id,
    node: sp.lectures[0] as string,
    course: sp.course.id,
    page: pageId,
    file: fileId,
  };
});

type Route = { method: string; path: string; body?: () => unknown };

/** Fill `:q`, `:session` and the like from the ids made in beforeEach. */
const resolve = (path: string) =>
  path.replace(/:(\w+)/g, (_, k: string) => ids[k as keyof typeof ids]);

const READS: Route[] = [
  { method: "GET", path: "/api/practice/questions" },
  { method: "GET", path: "/api/practice/questions/:q" },
  { method: "GET", path: "/api/practice/questions/:q/attempts" },
  { method: "GET", path: "/api/practice/citations/pages/:page" },
  { method: "GET", path: "/api/practice/citations/files/:file" },
  { method: "GET", path: "/api/practice/sessions" },
  { method: "GET", path: "/api/practice/sessions/:session" },
  { method: "GET", path: "/api/practice/sessions/:session/next" },
  { method: "GET", path: "/api/practice/sessions/:session/items/0" },
  { method: "GET", path: "/api/practice/sessions/:session/results" },
  { method: "GET", path: "/api/practice/notebook" },
  { method: "GET", path: "/api/practice/weak-areas" },
  { method: "GET", path: "/api/practice/due" },
  {
    method: "POST",
    path: "/api/practice/questions/validate",
    body: () => ({ questions: [{ type: "nope" }] }),
  },
  { method: "GET", path: "/api/exams" },
  { method: "GET", path: "/api/exams/upcoming" },
  { method: "GET", path: "/api/exams/:exam" },
];

/** Routes that change something. `session` means only her browser session may. */
const WRITES: Array<Route & { session?: boolean }> = [
  {
    method: "POST",
    path: "/api/practice/questions",
    body: () => ({ nodeIds: [ids.node], questions: [] }),
  },
  { method: "PATCH", path: "/api/practice/questions/:q", body: () => ({ nodeIds: [ids.node] }) },
  { method: "POST", path: "/api/practice/questions/:q/trash" },
  { method: "POST", path: "/api/practice/questions/:q/restore" },
  { method: "POST", path: "/api/practice/questions/:q/schedule", body: () => ({ enabled: true }) },
  {
    method: "POST",
    path: "/api/practice/questions/:q/review",
    body: () => ({ status: "reviewed" }),
    session: true,
  },
  {
    method: "POST",
    path: "/api/practice/questions/review",
    body: () => ({ questionIds: [ids.q], status: "reviewed" }),
    session: true,
  },
  { method: "DELETE", path: "/api/practice/questions/:q", session: true },
  {
    method: "POST",
    path: "/api/practice/sessions",
    body: () => ({ scope: { kind: "all" } }),
    session: true,
  },
  {
    method: "POST",
    path: "/api/practice/sessions/:session/answer",
    body: () => ({ answer: { type: "multiple_choice", optionId: "a" } }),
    session: true,
  },
  {
    method: "POST",
    path: "/api/practice/sessions/:session/reveal",
    body: () => ({ position: 0 }),
    session: true,
  },
  { method: "POST", path: "/api/practice/sessions/:session/finish", session: true },
  { method: "POST", path: "/api/practice/sessions/:session/abandon", session: true },
  {
    method: "POST",
    path: "/api/exams",
    body: () => ({ courseId: ids.course, title: "x", date: "2026-12-20" }),
  },
  { method: "PATCH", path: "/api/exams/:exam", body: () => ({ title: "y" }) },
  { method: "DELETE", path: "/api/exams/:exam", session: true },
];

const label = (r: Route) => `${r.method} ${r.path}`;

describe("every route needs a sign-in", () => {
  for (const r of [...READS, ...WRITES]) {
    it(label(r), async () => {
      const res = await env.call(null, r.method, resolve(r.path), r.body?.());
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("unauthenticated");
    });
  }
});

describe("another user's objects are not_found, and their lists are empty", () => {
  for (const r of [
    ...READS.filter((x) => /:(q|session|exam)\b/.test(x.path)),
    ...WRITES.filter((x) => /:(q|session|exam)\b/.test(x.path)),
  ]) {
    it(label(r), async () => {
      const res = await env.call(env.bobUser, r.method, resolve(r.path), r.body?.());
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("not_found");
    });
  }

  it("lists, the notebook, weak areas, due, upcoming and the cited-by lists are empty for her neighbour", async () => {
    for (const path of ["/api/practice/questions", "/api/practice/sessions", "/api/exams"]) {
      expect((await env.call(env.bobUser, "GET", path)).body.items).toEqual([]);
    }
    expect((await env.call(env.bobUser, "GET", "/api/practice/notebook")).body.items).toEqual([]);
    expect((await env.call(env.bobUser, "GET", "/api/practice/weak-areas")).body.byTag).toEqual([]);
    expect((await env.call(env.bobUser, "GET", "/api/practice/due")).body.counts.total).toBe(0);
    expect((await env.call(env.bobUser, "GET", "/api/exams/upcoming")).body.items).toEqual([]);
    expect(
      (await env.call(env.bobUser, "GET", `/api/practice/citations/pages/${ids.page}`)).body.items,
    ).toEqual([]);
  });

  it("a neighbour cannot file under her node, cover her nodes or exam against her course", async () => {
    const bobNode = env.spine(env.bob, 1);
    const create = await env.call(env.bobUser, "POST", "/api/practice/questions", {
      nodeIds: [ids.node],
      questions: [fx.mc({ fileId: newId("file"), pageId: newId("page"), quote: "q" })],
    });
    expect(create.status).toBe(404);
    const exam = await env.call(env.bobUser, "POST", "/api/exams", {
      courseId: ids.course,
      title: "x",
      date: "2026-12-20",
    });
    expect(exam.status).toBe(404);
    const own = await env.call(env.bobUser, "POST", "/api/exams", {
      courseId: bobNode.course.id,
      title: "x",
      date: "2026-12-20",
      nodeIds: [ids.node],
    });
    expect(own.status).toBe(404);
    const start = await env.call(env.bobUser, "POST", "/api/practice/sessions", {
      scope: { kind: "nodes", nodeIds: [ids.node] },
    });
    expect(start.status).toBe(404);
  });
});

describe("a read-only key can read everything and change nothing", () => {
  for (const r of READS) {
    it(`reads: ${label(r)}`, async () => {
      const res = await env.call(env.readBot, r.method, resolve(r.path), r.body?.());
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });
  }
  for (const r of WRITES) {
    it(`refuses: ${label(r)}`, async () => {
      const res = await env.call(env.readBot, r.method, resolve(r.path), r.body?.());
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("read_only_key");
    });
  }
});

describe("a write key can author but not take a session, review or delete", () => {
  for (const r of WRITES.filter((x) => x.session)) {
    it(`refuses: ${label(r)}`, async () => {
      const res = await env.call(env.bot, r.method, resolve(r.path), r.body?.());
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("forbidden");
    });
  }

  it("authors questions and exams, reads sessions and results", async () => {
    const page = env.addPage();
    const created = await env.call(env.bot, "POST", "/api/practice/questions", {
      nodeIds: [ids.node],
      questions: [fx.fill(page.cite), { type: "multiple_choice" }],
      partial: true,
    });
    expect(created.status).toBe(201);
    expect(created.body.stored).toBe(1);
    expect(created.body.problems[0].index).toBe(1);
    expect(created.body.problems[0].problems[0]).toHaveProperty("example");
    const exam = await env.call(env.bot, "POST", "/api/exams", {
      courseId: ids.course,
      title: "Final",
      date: "2026-12-20",
      nodeIds: [ids.node],
    });
    expect(exam.status).toBe(201);
    expect(
      (await env.call(env.bot, "GET", `/api/practice/sessions/${ids.session}/results`)).status,
    ).toBe(200);
  });
});

describe("the session flow over HTTP", () => {
  it("starts, serves a key-free question, grades, finishes and reports", async () => {
    const start = await env.call(env.she, "POST", "/api/practice/sessions", {
      scope: { kind: "nodes", nodeIds: [ids.node] },
      formats: ["multiple_choice"],
      length: 1,
      seed: 11,
    });
    expect(start.status).toBe(201);
    expect(JSON.stringify(start.body.next)).not.toContain("EXPLAIN");
    const sid = start.body.session.id;
    const wrong = await env.call(env.she, "POST", `/api/practice/sessions/${sid}/answer`, {
      answer: { type: "multiple_choice", optionId: "b" },
      correct: true,
    });
    expect(wrong.status).toBe(200);
    expect(wrong.body.result.correct).toBe(false);
    expect(wrong.body.progress.finished).toBe(true);
    const again = await env.call(env.she, "POST", `/api/practice/sessions/${sid}/answer`, {
      answer: { type: "multiple_choice", optionId: "a" },
    });
    expect(again.status).toBe(409);
    const results = await env.call(env.bot, "GET", `/api/practice/sessions/${sid}/results`);
    expect(results.body.summary).toMatchObject({ answered: 1, correct: 0 });
    const notebook = await env.call(env.readBot, "GET", "/api/practice/notebook");
    expect(notebook.body.counts.total).toBe(1);
  });

  it("answers errors with the shared error shape", async () => {
    const bad = await env.call(env.she, "POST", `/api/practice/sessions/${ids.session}/answer`, {
      answer: { type: "nope" },
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("invalid_input");
    expect(bad.body.error.example).toBeTruthy();
    expect(
      (await env.call(env.she, "POST", "/api/practice/sessions", { scope: { kind: "elsewhere" } }))
        .status,
    ).toBe(400);
    expect((await env.call(env.she, "GET", "/api/practice/sessions/not-an-id")).status).toBe(404);
    expect((await env.call(env.she, "GET", "/api/practice/questions?type=bogus")).status).toBe(400);
    expect(
      (await env.call(env.she, "GET", "/api/practice/questions?trashed=true&full=true")).status,
    ).toBe(200);
  });

  it("atomic batch failures are a 400 that names every problem", async () => {
    const page = env.addPage();
    const res = await env.call(env.she, "POST", "/api/practice/questions", {
      nodeIds: [ids.node],
      questions: [fx.mc(page.cite), { type: "multiple_choice", prompt: "x" }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain("nothing was stored");
    expect(res.body.error.hint).toContain("questions[1]");
  });
});

describe("mounted in the real app", () => {
  it("is behind sign-in, the origin check and the same error shape", async () => {
    const t = makeTestApp();
    for (const path of ["/api/practice/notebook", "/api/exams", "/api/practice/sessions"]) {
      const res = await t.request(path);
      expect(res.status).toBe(401);
      expect(errorCode(res.body)).toBe("unauthenticated");
    }
    await t.addUser("hannah", "correct horse battery");
    const { cookies } = await t.signIn("hannah", "correct horse battery");
    const term = await t.request("/api/nodes", {
      cookies,
      body: { parentId: null, kind: "term", name: "Fall 2026" },
    });
    const course = await t.request("/api/nodes", {
      cookies,
      body: { parentId: (term.body as Json).node.id, kind: "course", name: "Pharm" },
    });
    const sections = await t.request(`/api/nodes?parentId=${(course.body as Json).node.id}`, {
      cookies,
    });
    const lectures = (sections.body as Json).items.find((s: Json) => s.section === "lectures");
    const lecture = await t.request("/api/nodes", {
      cookies,
      body: { parentId: lectures.id, kind: "lecture", name: "Lecture 7" },
    });
    const nodeId = (lecture.body as Json).node.id;
    const noOrigin = await t.request("/api/practice/questions", {
      cookies,
      origin: "http://evil.example",
      body: { nodeIds: [nodeId], questions: [] },
    });
    expect(noOrigin.status).toBe(403);
    const q = await t.request("/api/practice/questions", {
      cookies,
      body: {
        nodeIds: [nodeId],
        questions: [
          fx.mc({
            fileId: newId("file"),
            pageId: newId("page"),
            quote: "Lorvanol lowers heart rate.",
          }),
        ],
      },
    });
    expect(q.status, JSON.stringify(q.body)).toBe(201);
    const start = await t.request("/api/practice/sessions", {
      cookies,
      body: { scope: { kind: "all" }, length: 1 },
    });
    expect(start.status).toBe(201);
    const ex = await t.request("/api/exams", {
      cookies,
      body: {
        courseId: (course.body as Json).node.id,
        title: "Exam 1",
        date: "2026-12-14",
        nodeIds: [nodeId],
      },
    });
    expect(ex.status).toBe(201);
    const up = await t.request("/api/exams/upcoming", { cookies });
    expect((up.body as Json).items[0].progress.questions).toBe(1);
  });
});
