import { type Actor, newId, practice } from "@notes/schema";
import { Hono } from "hono";
import { createTestDatabase } from "../src/db/client.js";
import { createFakeSourceLookup } from "../src/domains/documents/index.js";
import { createExamsService, examsRoutes } from "../src/domains/exams/index.js";
import { createLibraryService, libraryRoutes } from "../src/domains/library/index.js";
import {
  createPracticePort,
  createPracticeService,
  practiceRoutes,
} from "../src/domains/practice/index.js";
import type { AppEnv, AuthContext } from "../src/http/auth-context.js";
import { handleError } from "../src/http/errors.js";

// biome-ignore lint/suspicious/noExplicitAny: response bodies are inspected loosely in tests
export type Json = any;

export const DAY = 86_400_000;

export function userAuth(userId: string): AuthContext {
  return {
    userId,
    actor: { type: "user", userId } as Actor,
    via: "session",
    scope: "write",
    sessionId: "ses_x",
  };
}

export function agentAuth(
  userId: string,
  scope: "read" | "write" = "write",
  keyId = newId("apiKey"),
): AuthContext {
  return {
    userId,
    actor: { type: "agent", keyId, label: "Claude Code" } as Actor,
    via: "key",
    scope,
  };
}

/** A quote that exists in the fake transcript, so citations resolve. */
export const QUOTE = "Lorvanol lowers heart rate and oxygen demand in heart failure.";

export function setupPractice() {
  const db = createTestDatabase();
  const clock = { ms: Date.UTC(2026, 10, 15, 12, 0, 0) };
  const now = () => clock.ms;
  const sources = createFakeSourceLookup({ strict: true });
  const deps = { db, now };
  const service = createPracticeService(deps, { sources });
  const exams = createExamsService(deps, { practice: service });
  const port = createPracticePort(service, exams);
  const library = createLibraryService(db, { now: () => new Date(now()) });

  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    const user = c.req.header("x-user");
    const key = c.req.header("x-key");
    const scope = (c.req.header("x-scope") ?? "write") as "read" | "write";
    let auth: AuthContext | null = null;
    if (user && key) auth = agentAuth(user, scope, key);
    else if (user) auth = { ...userAuth(user), scope };
    c.set("auth", auth);
    await next();
  });
  app.route("/", libraryRoutes(db));
  app.route("/api", practiceRoutes(deps, service));
  app.route("/api", examsRoutes(deps, exams));
  app.onError(handleError);

  const alice = newId("user");
  const bob = newId("user");
  const she = userAuth(alice);
  const bot = agentAuth(alice);
  const readBot = agentAuth(alice, "read");
  const bobUser = userAuth(bob);

  /** term > course > sections > lectures; returns the ids. */
  function spine(userId = alice, lectures = 3) {
    const term = library.create(userId, { parentId: null, kind: "term", name: "Fall 2026" });
    const course = library.create(userId, {
      parentId: term.id,
      kind: "course",
      name: "Pharmacology II",
      course: { code: "PHAR 7340" },
    });
    const kids = library.list(userId, { parentId: course.id }).items;
    const sec = Object.fromEntries(kids.map((s) => [s.section as string, s.id])) as Record<
      string,
      string
    >;
    const lecs = Array.from({ length: lectures }, (_, i) =>
      library.create(userId, {
        parentId: sec.lectures as string,
        kind: "lecture",
        name: `Lecture ${i + 5}`,
        lecture: { number: i + 5, date: null },
      }),
    );
    return { term, course, sec, lectures: lecs.map((l) => l.id) as string[] };
  }

  /** A page the fake lookup knows, with a transcript containing QUOTE. */
  function addPage(userId = alice) {
    const fileId = newId("file");
    const pageId = newId("page");
    sources.addPage({
      userId,
      fileId,
      pageId,
      fileName: "Lecture 7.pdf",
      pageIndex: 3,
      transcript: `Slide 3. ${QUOTE} More text.`,
    });
    return { fileId, pageId, cite: { fileId, pageId, quote: QUOTE, label: "Slide 3" } };
  }

  async function call(
    who: AuthContext | null,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: Json }> {
    const headers: Record<string, string> = {};
    if (who) {
      headers["x-user"] = who.userId;
      headers["x-scope"] = who.scope;
      if (who.actor.type === "agent") headers["x-key"] = who.actor.keyId;
    }
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await app.request(path, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }

  return {
    db,
    clock,
    deps,
    service,
    exams,
    port,
    library,
    sources,
    app,
    alice,
    bob,
    she,
    bot,
    readBot,
    bobUser,
    spine,
    addPage,
    call,
    advance: (ms: number) => {
      clock.ms += ms;
    },
  };
}

export type Env = ReturnType<typeof setupPractice>;

// ---------------------------------------------------------------- fixtures
// All drug names are invented. Answer-bearing strings are unique so a leak shows.

type Cite = { fileId: string; pageId: string; quote: string };
type Loose = Record<string, unknown>;

export const fx = {
  mc: (cite: Cite, over: Loose = {}): Loose => ({
    type: "multiple_choice",
    prompt: "Which effect is expected with lorvanol, a fictional beta blocker?",
    options: [
      { id: "a", text: "Slower heart rate", correct: true, rationale: "RATIONALE-MC-RIGHT" },
      { id: "b", text: "Faster heart rate", rationale: "RATIONALE-MC-WRONG" },
      { id: "c", text: "Higher potassium" },
    ],
    explanation: "EXPLAIN-MC beta blockers slow the heart rate.",
    sources: [cite],
    tags: ["beta-blockers"],
    ...over,
  }),
  selectAll: (cite: Cite, over: Loose = {}): Loose => ({
    type: "select_all",
    prompt: "Which are expected with lorvanol (fictional)?",
    options: [
      { id: "a", text: "Bradycardia", correct: true },
      { id: "b", text: "Lower blood pressure", correct: true },
      { id: "c", text: "Hair growth" },
    ],
    explanation: "EXPLAIN-SA lorvanol slows the heart and lowers pressure.",
    sources: [cite],
    tags: ["beta-blockers"],
    ...over,
  }),
  matching: (cite: Cite, over: Loose = {}): Loose => ({
    type: "matching",
    prompt: "Match each brand to its generic (all fictional).",
    pairs: [
      { id: "p1", left: "Veloxa", right: "lorvanol" },
      { id: "p2", left: "Cardimar", right: "tenzolol" },
      { id: "p3", left: "Pulsera", right: "mirexalol" },
    ],
    distractors: ["zenvapril"],
    explanation: "EXPLAIN-MATCH brand to generic.",
    sources: [cite],
    tags: ["brand-generic"],
    ...over,
  }),
  fill: (cite: Cite, over: Loose = {}): Loose => ({
    type: "fill_blank",
    text: "Lorvanol is a {{1}} blocker that lowers the {{2}}.",
    blanks: [{ answers: ["zorvanide"] }, { answers: ["heart rate", "pulse"] }],
    explanation: "EXPLAIN-FILL lorvanol blocks beta receptors.",
    sources: [cite],
    tags: ["beta-blockers"],
    ...over,
  }),
  calc: (cite: Cite, over: Loose = {}): Loose => ({
    type: "calculation",
    prompt:
      "A patient weighs {weightKg} kg. The order is {doseMgPerKg} mg/kg as one dose. How many mg?",
    answer: {
      kind: "expression",
      expression: "weightKg * doseMgPerKg",
      variables: {
        weightKg: { kind: "range", min: 50, max: 90, step: 5 },
        doseMgPerKg: { kind: "list", values: [2, 3, 5] },
      },
    },
    units: ["mg", "milligram"],
    explanation: "EXPLAIN-CALC dose = {weightKg} x {doseMgPerKg} = {answer}.",
    sources: [cite],
    tags: ["dosing"],
    ...over,
  }),
  calcFixed: (cite: Cite, over: Loose = {}): Loose => ({
    type: "calculation",
    prompt: "Give 2.5 mL/kg to a 10 kg child. How many mL?",
    answer: { kind: "fixed", value: 25 },
    units: ["mL"],
    explanation: "EXPLAIN-CALCFIXED 2.5 x 10.",
    sources: [cite],
    tags: ["dosing"],
    ...over,
  }),
  flash: (cite: Cite, over: Loose = {}): Loose => ({
    type: "flashcard",
    front: "Brand name of lorvanol (fictional)?",
    back: "BACK-FLASH Veloxa",
    explanation: "EXPLAIN-FLASH brand names.",
    sources: [cite],
    tags: ["brand-generic"],
    ...over,
  }),
  free: (cite: Cite, over: Loose = {}): Loose => ({
    type: "free_response",
    prompt: "Explain why lorvanol (fictional) is used in heart failure.",
    modelAnswer: "MODEL-FREE lowers heart rate and oxygen demand.",
    rubric: [
      { point: "RUBRIC-A lowers heart rate", points: 1 },
      { point: "RUBRIC-B reduces remodelling", points: 2 },
    ],
    explanation: "EXPLAIN-FREE heart failure.",
    sources: [cite],
    tags: ["beta-blockers"],
    ...over,
  }),
  case: (cite: Cite, over: Loose = {}): Loose => ({
    type: "case",
    vignette: "A 64-year-old man with heart failure is started on lorvanol (fictional).",
    questions: [
      {
        type: "multiple_choice",
        prompt: "Which finding should be monitored first?",
        options: [
          { id: "a", text: "Heart rate", correct: true, rationale: "RATIONALE-CASE-MC" },
          { id: "b", text: "Hair growth" },
        ],
        explanation: "EXPLAIN-CASE-MC bradycardia.",
      },
      {
        type: "fill_blank",
        text: "Lorvanol belongs to the {{1}} blocker class.",
        blanks: [{ answers: ["quillarate"] }],
        explanation: "EXPLAIN-CASE-FILL class.",
      },
      {
        type: "calculation",
        prompt: "He weighs {weightKg} kg and the dose is 2 mg/kg. How many mg?",
        answer: {
          kind: "expression",
          expression: "weightKg * 2",
          variables: { weightKg: { kind: "range", min: 60, max: 80, step: 5 } },
        },
        units: ["mg"],
        explanation: "EXPLAIN-CASE-CALC {weightKg} x 2 = {answer}.",
      },
      {
        type: "free_response",
        prompt: "Why monitor heart rate?",
        modelAnswer: "MODEL-CASE-FREE bradycardia risk.",
        rubric: [{ point: "RUBRIC-CASE bradycardia", points: 1 }],
        explanation: "EXPLAIN-CASE-FREE.",
      },
    ],
    sources: [cite],
    tags: ["beta-blockers"],
    ...over,
  }),
};

/** Every type, for loops. */
export const ALL_TYPES: Array<[practice.QuestionType, (c: Cite, o?: Loose) => Loose]> = [
  ["multiple_choice", fx.mc],
  ["select_all", fx.selectAll],
  ["matching", fx.matching],
  ["fill_blank", fx.fill],
  ["calculation", fx.calc],
  ["flashcard", fx.flash],
  ["free_response", fx.free],
  ["case", fx.case],
];

/** The seeds a session stored for each question (the API never shows them). */
export function sessionItems(env: Env, sessionId: string): practice.SessionItem[] {
  const row = env.db.prepare("SELECT items FROM practice_sessions WHERE id = ?").get(sessionId) as {
    items: string;
  };
  return JSON.parse(row.items);
}

/** A fully correct answer for a question, as the grader wants it (self-graded types tick everything). */
export function rightAnswer(
  q: practice.Question | practice.QuestionPart,
  variantSeed: number,
): practice.Answer {
  switch (q.type) {
    case "flashcard":
      return { type: "flashcard", rating: "good" };
    case "free_response":
      return { type: "free_response", text: "my answer", covered: q.rubric.map((_, i) => i) };
    case "case":
      return {
        type: "case",
        parts: q.questions.map((p, i) =>
          rightAnswer(p, practice.deriveSeed(variantSeed, "part", i)),
        ) as never,
      };
    default:
      return practice.correctAnswerOf(q, variantSeed).data as practice.Answer;
  }
}

/** An answer that is wrong for the types the app grades; self-graded ones say "again" / nothing covered. */
export function wrongAnswer(q: practice.Question | practice.QuestionPart): practice.Answer {
  switch (q.type) {
    case "multiple_choice":
      return {
        type: "multiple_choice",
        optionId: (q.options.find((o) => !o.correct) as { id: string }).id,
      };
    case "select_all":
      return {
        type: "select_all",
        optionIds: q.options.filter((o) => !o.correct).map((o) => o.id),
      };
    case "matching":
      return {
        type: "matching",
        matches: q.pairs.map((p) => ({ pairId: p.id, right: "nothing at all" })),
      };
    case "fill_blank":
      return { type: "fill_blank", blanks: q.blanks.map(() => "wrong") };
    case "calculation":
      return { type: "calculation", response: "1 mg" };
    case "flashcard":
      return { type: "flashcard", rating: "again" };
    case "free_response":
      return { type: "free_response", text: "", covered: [] };
    case "case":
      return { type: "case", parts: q.questions.map(() => null) };
  }
}
