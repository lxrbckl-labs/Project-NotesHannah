import { newId, practice } from "@notes/schema";
import { beforeEach, describe, expect, it } from "vitest";
import { createPracticeService } from "../src/domains/practice/index.js";
import { AppError } from "../src/http/errors.js";
import {
  ALL_TYPES,
  type Env,
  type Json,
  rightAnswer,
  sessionItems,
  setupPractice,
  wrongAnswer,
} from "./practice-helpers.js";

let env: Env;
let sp: ReturnType<Env["spine"]>;
let lec: string[];
let cite: ReturnType<Env["addPage"]>["cite"];

beforeEach(() => {
  env = setupPractice();
  sp = env.spine();
  lec = sp.lectures;
  cite = env.addPage().cite;
});

const code = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
  return undefined;
};

/** Create one question of a type under a node; returns its id. */
function make(type: practice.QuestionType, node = lec[0] as string, over: Json = {}): string {
  const entry = ALL_TYPES.find(([t]) => t === type) as (typeof ALL_TYPES)[number];
  const res = env.service.createQuestions(env.bot, {
    nodeIds: [node],
    questions: [entry[1](cite, over)],
  });
  return (res.created[0] as Json).id;
}

function start(scope: Json, over: Json = {}) {
  return env.service.startSession(env.she, { scope, ...over });
}

/** The stored question and the seed the session gave it. */
function itemFor(sessionId: string, questionId: string) {
  const item = sessionItems(env, sessionId).find((i) => i.questionId === questionId);
  if (!item) throw new Error("question not in the session");
  return { item, question: env.service.getQuestion(env.she, questionId).question };
}

/** Answer every open question of a session with its right (or wrong) answer. */
function playAll(sessionId: string, mode: "right" | "wrong" = "right") {
  for (;;) {
    const { next } = env.service.nextQuestion(env.she, sessionId);
    if (!next) return;
    const { item, question } = itemFor(sessionId, next.questionId);
    const answer =
      mode === "right" ? rightAnswer(question, item.variantSeed) : wrongAnswer(question);
    env.service.submitAnswer(env.she, sessionId, { answer });
  }
}

describe("a full session for each kind of scope", () => {
  beforeEach(() => {
    make("multiple_choice", lec[0]);
    make("fill_blank", lec[0]);
    make("matching", lec[1]);
    make("select_all", lec[1], { conceptIds: [CONCEPT] });
    make("flashcard", lec[2]);
  });
  const CONCEPT = newId("concept");

  it("nodes: only questions under the chosen nodes", () => {
    const { session } = start({ kind: "nodes", nodeIds: [lec[0]] }, { length: 10 });
    expect(session.total).toBe(2);
    expect(session.items.map((i) => i.type).sort()).toEqual(["fill_blank", "multiple_choice"]);
    playAll(session.id);
    const done = env.service.getSession(env.she, session.id);
    expect(done.status).toBe("finished");
    const r = env.service.results(env.she, session.id);
    expect(r.summary).toMatchObject({ total: 2, answered: 2, correct: 2, accuracy: 1, percent: 1 });
  });

  it("nodes: a folder or a course takes everything below it", () => {
    expect(start({ kind: "nodes", nodeIds: [sp.course.id] }, { length: 10 }).session.total).toBe(5);
    expect(
      start({ kind: "nodes", nodeIds: [sp.sec.lectures as string] }, { length: 3 }).session.total,
    ).toBe(3);
  });

  it("concepts", () => {
    const { session } = start({ kind: "concepts", conceptIds: [CONCEPT] });
    expect(session.items.map((i) => i.type)).toEqual(["select_all"]);
    playAll(session.id);
    expect(env.service.results(env.she, session.id).summary.correct).toBe(1);
  });

  it("exam", () => {
    const exam = env.exams.createExam(env.she, {
      courseId: sp.course.id,
      title: "Exam 2",
      date: "2026-12-14",
      nodeIds: [lec[1]],
    });
    const { session } = start({ kind: "exam", examId: exam.id });
    expect(session.items.map((i) => i.type).sort()).toEqual(["matching", "select_all"]);
    playAll(session.id);
    expect(env.service.getSession(env.she, session.id).status).toBe("finished");
    expect(code(() => start({ kind: "exam", examId: newId("exam") }))).toBe("not_found");
  });

  it("missed: only what is in the notebook, optionally narrowed to an exam", () => {
    expect(code(() => start({ kind: "missed" }))).toBe("invalid_input");
    const first = start(
      { kind: "nodes", nodeIds: [sp.course.id] },
      { length: 10, formats: ["multiple_choice", "matching"] },
    );
    playAll(first.session.id, "wrong");
    expect(env.service.notebook(env.she).counts.total).toBe(2);
    const { session } = start({ kind: "missed" });
    expect(session.items.map((i) => i.type).sort()).toEqual(["matching", "multiple_choice"]);
    const exam = env.exams.createExam(env.she, {
      courseId: sp.course.id,
      title: "E",
      date: "2026-12-14",
      nodeIds: [lec[1]],
    });
    const narrowed = start({ kind: "missed", examId: exam.id });
    expect(narrowed.session.items.map((i) => i.type)).toEqual(["matching"]);
    playAll(session.id);
    expect(env.service.notebook(env.she).counts.total).toBe(0);
  });

  it("due: flashcards due now, and the review updates their schedule", () => {
    const { session, next } = start({ kind: "due" });
    expect(session.items.map((i) => i.type)).toEqual(["flashcard"]);
    expect(next?.type).toBe("flashcard");
    const out = env.service.submitAnswer(env.she, session.id, {
      answer: { type: "flashcard", rating: "good" },
    });
    expect(out.schedule?.rating).toBe("good");
    expect(out.schedule?.intervalDays).toBeGreaterThanOrEqual(1);
    expect(out.progress.finished).toBe(true);
    expect(code(() => start({ kind: "due" }))).toBe("invalid_input");
  });

  it("all, and the formats and length limits", () => {
    const all = start({ kind: "all" }, { length: 100 });
    expect(all.session.total).toBe(5);
    const two = start({ kind: "all" }, { length: 2, formats: ["flashcard", "matching"] });
    expect(two.session.items.map((i) => i.type).sort()).toEqual(["flashcard", "matching"]);
    const short = start({ kind: "all" }, { length: 50 });
    expect(short.session.shortfall).toBe(45);
    expect(code(() => start({ kind: "nodes", nodeIds: [newId("node")] }))).toBe("not_found");
    expect(code(() => start({ kind: "all" }, { formats: ["calculation"] }))).toBe("invalid_input");
    expect(code(() => start({ kind: "all" }, { length: 0 }))).toBe("invalid_input");
  });

  it("does not offer questions that are trashed or whose nodes are in the trash", () => {
    const q = (env.service.listQuestions(env.she, { type: "fill_blank" }).items[0] as Json).id;
    env.service.trashQuestion(env.she, q);
    env.service.onNodeTrashed(env.alice, [lec[1] as string]);
    const { session } = start({ kind: "all" }, { length: 10 });
    expect(session.items.map((i) => i.type).sort()).toEqual(["flashcard", "multiple_choice"]);
  });
});

describe("a session is reproducible and resumes anywhere", () => {
  beforeEach(() => {
    for (let i = 0; i < 4; i++)
      make("multiple_choice", lec[0], { prompt: `Question ${i} about lorvanol (fictional)?` });
    for (let i = 0; i < 3; i++) make("calculation");
    for (let i = 0; i < 3; i++) make("matching");
  });

  it("the same seed gives the same questions, order and views", () => {
    const a = start({ kind: "all" }, { length: 8, seed: 424242 });
    const b = start({ kind: "all" }, { length: 8, seed: 424242 });
    const c = start({ kind: "all" }, { length: 8, seed: 7 });
    expect(a.session.id).not.toBe(b.session.id);
    expect(a.session.items.map((i) => i.questionId)).toEqual(
      b.session.items.map((i) => i.questionId),
    );
    expect(a.session.items.map((i) => i.questionId)).not.toEqual(
      c.session.items.map((i) => i.questionId),
    );
    expect(JSON.stringify(a.next)).toBe(JSON.stringify(b.next));
    expect(sessionItems(env, a.session.id)).toEqual(sessionItems(env, b.session.id));
    for (let p = 0; p < 8; p++) {
      const va = env.service.getItem(env.she, a.session.id, p).question.view;
      const vb = env.service.getItem(env.she, b.session.id, p).question.view;
      expect(va).toEqual(vb);
    }
  });

  it("balances the types as far as the pool allows", () => {
    const { session } = start({ kind: "all" }, { length: 9, seed: 1 });
    const counts = Object.fromEntries(
      ["multiple_choice", "calculation", "matching"].map((t) => [
        t,
        session.items.filter((i) => i.type === t).length,
      ]),
    );
    expect(counts).toEqual({ multiple_choice: 3, calculation: 3, matching: 3 });
  });

  it("resumes mid-session on another device: same next question, same numbers, same option order", () => {
    const { session } = start({ kind: "all" }, { length: 8, seed: 99 });
    for (let i = 0; i < 3; i++) {
      const { next } = env.service.nextQuestion(env.she, session.id);
      const { item, question } = itemFor(session.id, (next as Json).questionId);
      env.service.submitAnswer(env.she, session.id, {
        answer: rightAnswer(question, item.variantSeed),
      });
    }
    const before = env.service.nextQuestion(env.she, session.id);
    // a brand-new service over the same database stands in for another device
    const other = createPracticeService(env.deps, { sources: env.sources });
    const after = other.nextQuestion(env.she, session.id);
    expect(after.session.answered).toBe(3);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    expect((after.next as Json).position).toBe(3);
  });

  it("a calculation shows the same variant on resume, and different questions can differ", () => {
    const { session } = start({ kind: "all" }, { length: 10, seed: 5, formats: ["calculation"] });
    const prompts = session.items.map(
      (_, p) =>
        (env.service.getItem(env.she, session.id, p).question.view as Json).prompt as string,
    );
    const again = session.items.map(
      (_, p) =>
        (createPracticeService(env.deps).getItem(env.she, session.id, p).question.view as Json)
          .prompt as string,
    );
    expect(again).toEqual(prompts);
    for (const p of prompts) expect(p).not.toMatch(/[{}]/);
  });
});

describe("no answer leaks before answering", () => {
  /** Strings that must not appear in a question's view before it is answered. */
  const SECRETS: Record<string, string[]> = {
    multiple_choice: ["RATIONALE-MC", "EXPLAIN-MC", "rationale", "explanation", '"correct"'],
    select_all: ["EXPLAIN-SA", "explanation", '"correct"'],
    matching: ["EXPLAIN-MATCH", "explanation", '"pairs"', '"correct"'],
    fill_blank: [
      "zorvanide",
      "pulse",
      "EXPLAIN-FILL",
      '"answers"',
      '"blanks"',
      "allowTypos",
      "strict",
    ],
    calculation: [
      "EXPLAIN-CALC",
      "weightKg * doseMgPerKg",
      '"expression"',
      '"variables"',
      '"answer"',
      "milligram",
      '"units"',
      "tolerance",
    ],
    flashcard: ["BACK-FLASH", "EXPLAIN-FLASH", '"back"', "explanation"],
    free_response: [
      "MODEL-FREE",
      "RUBRIC-A",
      "RUBRIC-B",
      "EXPLAIN-FREE",
      '"rubric"',
      "modelAnswer",
      "passFraction",
    ],
    case: [
      "quillarate",
      "RATIONALE-CASE-MC",
      "EXPLAIN-CASE",
      "MODEL-CASE-FREE",
      "RUBRIC-CASE",
      "weightKg * 2",
      '"expression"',
      '"variables"',
      '"correct"',
      '"rubric"',
      "modelAnswer",
      "explanation",
    ],
  };

  for (const [type] of ALL_TYPES) {
    it(`${type}: nothing of the key is in the view; it appears after answering`, () => {
      make(type);
      const { session, next } = start({ kind: "all" }, { length: 1, formats: [type] });
      const viewJson = JSON.stringify(next);
      for (const secret of SECRETS[type] as string[])
        expect(viewJson, secret).not.toContain(secret);
      // every route that shows the question shows the same, key-free view
      for (const shown of [
        env.service.nextQuestion(env.she, session.id).next,
        env.service.getItem(env.she, session.id, 0).question,
      ]) {
        expect(JSON.stringify(shown)).toBe(viewJson);
      }
      expect(JSON.stringify(env.service.getSession(env.she, session.id))).not.toContain("EXPLAIN");
      expect(JSON.stringify(env.service.results(env.she, session.id))).not.toContain("EXPLAIN");

      const { item, question } = itemFor(session.id, (next as Json).questionId);
      const out = env.service.submitAnswer(env.she, session.id, { answer: wrongAnswer(question) });
      const after = JSON.stringify(out);
      const marker = {
        multiple_choice: "RATIONALE-MC-RIGHT",
        select_all: "EXPLAIN-SA",
        matching: "EXPLAIN-MATCH",
        fill_blank: "zorvanide",
        calculation: "EXPLAIN-CALC",
        flashcard: "BACK-FLASH",
        free_response: "MODEL-FREE",
        case: "RATIONALE-CASE-MC",
      }[type] as string;
      expect(after).toContain(marker);
      expect(out.result.correctAnswer.text.length).toBeGreaterThan(0);
      if (type === "calculation") {
        const expected = practice.instantiateCalculation(question as never, item.variantSeed);
        expect(viewJson).not.toContain(expected.answerText);
        expect(out.result.correctAnswer.text).toBe(expected.answerText);
        expect(out.reveal.explanation).toContain(`= ${expected.answerText}`);
      }
    });
  }

  it("a case keeps its calculation variant answer out of the view", () => {
    make("case");
    const { session, next } = start({ kind: "all" }, { length: 1 });
    const { item, question } = itemFor(session.id, (next as Json).questionId);
    const calc = (question as Json).questions[2];
    const inst = practice.instantiateCalculation(
      calc,
      practice.deriveSeed(item.variantSeed, "part", 2),
    );
    expect(JSON.stringify(next)).not.toContain(inst.answerText);
    expect((next as Json).view.parts).toHaveLength(4);
    expect((next as Json).view.parts[2].prompt).toContain(`${inst.values.weightKg} kg`);
  });

  it("reveal gives the key only for what she marks herself, and never for the rest of a case", () => {
    make("flashcard");
    make("free_response");
    make("multiple_choice");
    make("case");
    const { session } = start({ kind: "all" }, { length: 10 });
    for (const it of session.items) {
      const call = () => env.service.reveal(env.she, session.id, it.position);
      if (it.type === "multiple_choice") expect(code(call)).toBe("invalid_input");
      else {
        const key = JSON.stringify(call());
        if (it.type === "flashcard") expect(key).toContain("BACK-FLASH");
        if (it.type === "free_response") expect(key).toContain("RUBRIC-B");
        if (it.type === "case") {
          expect(key).toContain("RUBRIC-CASE");
          for (const s of ["quillarate", "RATIONALE-CASE-MC", "weightKg"])
            expect(key).not.toContain(s);
        }
      }
    }
    expect(code(() => env.service.reveal(env.bot, session.id, 0))).toBe("forbidden");
    expect(code(() => env.service.reveal(env.she, session.id, 40))).toBe("invalid_input");
  });
});

describe("grading happens on the server", () => {
  for (const [type] of ALL_TYPES) {
    it(`${type}: the right answer scores, a wrong one does not, and the attempt is stored`, () => {
      make(type);
      for (const mode of ["right", "wrong"] as const) {
        const { session } = start({ kind: "all" }, { length: 1, formats: [type] });
        const { item, question } = itemFor(session.id, (session.items[0] as Json).questionId);
        const answer =
          mode === "right" ? rightAnswer(question, item.variantSeed) : wrongAnswer(question);
        const out = env.service.submitAnswer(env.she, session.id, { answer });
        expect(out.result.correct, `${type} ${mode}`).toBe(mode === "right");
        expect(out.attempt.answer).toEqual(answer);
        expect(out.attempt.result).toEqual(out.result);
        expect(out.attempt.sessionId).toBe(session.id);
        expect(out.attempt.variantSeed).toBe(
          type === "calculation" || type === "case" ? item.variantSeed : null,
        );
        if (type === "flashcard") expect(out.result.selfGraded).toBe(true);
      }
      expect(
        env.service.listAttempts(env.she, (env.service.listQuestions(env.she).items[0] as Json).id)
          .items,
      ).toHaveLength(2);
    });
  }

  it("matching and select_all report partial credit while staying incorrect", () => {
    make("matching");
    make("select_all");
    const m = start({ kind: "all" }, { length: 1, formats: ["matching"] });
    const out = env.service.submitAnswer(env.she, m.session.id, {
      answer: {
        type: "matching",
        matches: [
          { pairId: "p1", right: "lorvanol" },
          { pairId: "p2", right: "tenzolol" },
          { pairId: "p3", right: "zenvapril" },
        ],
      },
    });
    expect(out.result.correct).toBe(false);
    expect(out.result.points).toBe(2);
    expect(out.result.score).toBeCloseTo(2 / 3);
    const s = start({ kind: "all" }, { length: 1, formats: ["select_all"] });
    const sa = env.service.submitAnswer(env.she, s.session.id, {
      answer: { type: "select_all", optionIds: ["a"] },
    });
    expect(sa.result.correct).toBe(false);
    expect(sa.result.partialScore).toBeCloseTo(0.5);
  });

  describe("calculation: units, variants", () => {
    function calcSession(over: Json = {}) {
      make("calculation", lec[0], over);
      const { session } = start({ kind: "all" }, { length: 1 });
      const { item, question } = itemFor(session.id, (session.items[0] as Json).questionId);
      const inst = practice.instantiateCalculation(question as never, item.variantSeed);
      return { session, inst };
    }
    const submit = (id: string, response: string, unit?: string) =>
      env.service.submitAnswer(env.she, id, {
        answer: { type: "calculation", response, ...(unit ? { unit } : {}) },
      });

    it("accepts the value with its unit, with the unit in the picker, and in another size of the unit", () => {
      const forms: Array<(e: number) => { response: string; unit?: string }> = [
        (e) => ({ response: `${e} mg` }),
        (e) => ({ response: String(e), unit: "mg" }),
        (e) => ({ response: `${e / 1000} g` }),
      ];
      for (const make of forms) {
        env = setupPractice();
        sp = env.spine();
        lec = sp.lectures;
        cite = env.addPage().cite;
        const { session, inst } = calcSession();
        const a = make(inst.expected);
        const out = submit(session.id, a.response, a.unit);
        expect(out.result.correct, JSON.stringify(a)).toBe(true);
      }
    });

    it("refuses a missing unit, a wrong unit and a thousand-fold slip as wrong (not unreadable)", () => {
      const cases: Array<[(e: number) => [string, string?], string]> = [
        [(e) => [String(e)], "missing_unit"],
        [(e) => [`${e} mL`], "wrong_unit"],
        [(e) => [`${e} g`], "magnitude_off"],
        [(e) => [`${e * 2} mg`], "too_high"],
      ];
      for (const [answer, expectedCode] of cases) {
        env = setupPractice();
        sp = env.spine();
        lec = sp.lectures;
        cite = env.addPage().cite;
        const { session, inst } = calcSession();
        const [response, unit] = answer(inst.expected);
        const out = submit(session.id, response, unit);
        expect(out.result.correct).toBe(false);
        expect(out.result.feedback.map((f) => f.code)).toContain(expectedCode);
      }
    });

    it("a rounding instruction is enforced", () => {
      const { session, inst } = calcSession({
        prompt: "Give 7 mg over 3 kg. How many mg/kg to 1 decimal place?",
        answer: { kind: "fixed", value: 7 / 3 },
        units: ["mg/kg"],
        rounding: { mode: "decimals", places: 1 },
      });
      expect(inst.expected).toBe(2.3);
      const out = submit(session.id, "2.3333 mg/kg");
      expect(out.result.correct).toBe(false);
      expect(out.result.feedback.map((f) => f.code)).toContain("rounding");
    });
  });

  it("refuses an answer it cannot read without using up the question", () => {
    make("multiple_choice");
    const { session } = start({ kind: "all" }, { length: 1 });
    expect(
      code(() =>
        env.service.submitAnswer(env.she, session.id, {
          answer: { type: "multiple_choice", optionId: "zzz" },
        }),
      ),
    ).toBe("invalid_input");
    expect(
      code(() =>
        env.service.submitAnswer(env.she, session.id, {
          answer: { type: "fill_blank", blanks: ["x"] },
        }),
      ),
    ).toBe("invalid_input");
    expect(code(() => env.service.submitAnswer(env.she, session.id, {}))).toBe("invalid_input");
    expect(env.service.getSession(env.she, session.id).answered).toBe(0);
    expect(
      env.service.submitAnswer(env.she, session.id, {
        answer: { type: "multiple_choice", optionId: "a" },
      }).result.correct,
    ).toBe(true);
  });

  it("refuses a second answer for the same position", () => {
    make("multiple_choice");
    make("multiple_choice", lec[0], { prompt: "A second lorvanol (fictional) question?" });
    const { session } = start({ kind: "all" }, { length: 2 });
    const mc = { type: "multiple_choice", optionId: "a" };
    env.service.submitAnswer(env.she, session.id, { position: 1, answer: mc });
    expect(
      code(() => env.service.submitAnswer(env.she, session.id, { position: 1, answer: mc })),
    ).toBe("conflict");
    expect(
      code(() => env.service.submitAnswer(env.she, session.id, { position: 7, answer: mc })),
    ).toBe("invalid_input");
    env.service.submitAnswer(env.she, session.id, { answer: mc });
    expect(env.service.getSession(env.she, session.id).status).toBe("finished");
    expect(code(() => env.service.submitAnswer(env.she, session.id, { answer: mc }))).toBe(
      "conflict",
    );
    expect(env.db.prepare("SELECT COUNT(*) AS n FROM attempts").get()).toEqual({ n: 2 });
  });

  it("ignores any grade the client sends", () => {
    make("multiple_choice");
    const { session } = start({ kind: "all" }, { length: 1 });
    const out = env.service.submitAnswer(env.she, session.id, {
      answer: { type: "multiple_choice", optionId: "b" },
      correct: true,
      score: 1,
      result: { correct: true, score: 1, points: 1, maxPoints: 1 },
    });
    expect(out.result.correct).toBe(false);
    expect(out.result.score).toBe(0);
    expect(out.attempt.result.correct).toBe(false);
  });

  it("measures time between answers, or takes the client's figure", () => {
    for (let i = 0; i < 2; i++)
      make("multiple_choice", lec[0], { prompt: `Question ${i} about lorvanol (fictional)?` });
    const { session } = start({ kind: "all" }, { length: 2 });
    env.advance(12_000);
    const a = env.service.submitAnswer(env.she, session.id, {
      answer: { type: "multiple_choice", optionId: "a" },
    });
    expect(a.attempt.timeTakenMs).toBe(12_000);
    env.advance(5_000);
    const b = env.service.submitAnswer(env.she, session.id, {
      answer: { type: "multiple_choice", optionId: "a" },
      timeTakenMs: 3_210,
    });
    expect(b.attempt.timeTakenMs).toBe(3_210);
    expect(env.service.results(env.she, session.id).summary.timeTakenMs).toBe(15_210);
  });
});

describe("agents and sessions", () => {
  it("an agent cannot start a session or take one, but can read sessions and results", () => {
    make("multiple_choice");
    expect(code(() => env.service.startSession(env.bot, { scope: { kind: "all" } }))).toBe(
      "forbidden",
    );
    expect(code(() => env.service.startSession(env.readBot, { scope: { kind: "all" } }))).toBe(
      "read_only_key",
    );
    const { session } = start({ kind: "all" }, { length: 1 });
    const mc = { answer: { type: "multiple_choice", optionId: "a" } };
    expect(code(() => env.service.submitAnswer(env.bot, session.id, mc))).toBe("forbidden");
    expect(code(() => env.service.finishSession(env.bot, session.id))).toBe("forbidden");
    expect(code(() => env.service.abandonSession(env.bot, session.id))).toBe("forbidden");
    env.service.submitAnswer(env.she, session.id, mc);
    const r = env.service.results(env.readBot, session.id);
    expect(r.summary.correct).toBe(1);
    expect(r.items[0]?.text).toContain("lorvanol");
    expect(env.service.getSession(env.bot, session.id).status).toBe("finished");
    expect(env.service.listSessions(env.readBot).items).toHaveLength(1);
  });

  it("another user's session is not_found everywhere", () => {
    make("multiple_choice");
    const { session } = start({ kind: "all" }, { length: 1 });
    const bob = env.bobUser;
    expect(code(() => env.service.getSession(bob, session.id))).toBe("not_found");
    expect(code(() => env.service.nextQuestion(bob, session.id))).toBe("not_found");
    expect(code(() => env.service.results(bob, session.id))).toBe("not_found");
    expect(code(() => env.service.submitAnswer(bob, session.id, {}))).toBe("not_found");
    expect(env.service.listSessions(bob).items).toHaveLength(0);
  });
});

describe("finishing and abandoning", () => {
  beforeEach(() => {
    for (let i = 0; i < 3; i++)
      make("multiple_choice", lec[0], { prompt: `Question ${i} about lorvanol (fictional)?` });
  });

  it("finish early: unanswered questions count as unanswered and show no key", () => {
    const { session } = start({ kind: "all" }, { length: 3 });
    env.service.submitAnswer(env.she, session.id, {
      answer: { type: "multiple_choice", optionId: "b" },
    });
    env.advance(60_000);
    const r = env.service.finishSession(env.she, session.id);
    expect(r.session.status).toBe("finished");
    expect(r.summary).toMatchObject({
      total: 3,
      answered: 1,
      unanswered: 2,
      correct: 0,
      incorrect: 1,
      accuracy: 0,
      durationMs: 60_000,
    });
    expect(r.items.filter((i) => i.answered)).toHaveLength(1);
    expect(JSON.stringify(r.items.filter((i) => !i.answered))).not.toContain("EXPLAIN");
    expect(env.service.finishSession(env.she, session.id).summary.answered).toBe(1);
    expect(code(() => env.service.abandonSession(env.she, session.id))).toBe("conflict");
    expect(
      code(() =>
        env.service.submitAnswer(env.she, session.id, {
          answer: { type: "multiple_choice", optionId: "a" },
        }),
      ),
    ).toBe("conflict");
  });

  it("abandon closes the session but its answers still count and its results stay readable", () => {
    const { session } = start({ kind: "all" }, { length: 3 });
    env.service.submitAnswer(env.she, session.id, {
      answer: { type: "multiple_choice", optionId: "b" },
    });
    expect(env.service.abandonSession(env.she, session.id).status).toBe("abandoned");
    expect(env.service.abandonSession(env.she, session.id).status).toBe("abandoned");
    expect(code(() => env.service.finishSession(env.she, session.id))).toBe("conflict");
    expect(env.service.results(env.bot, session.id).summary.answered).toBe(1);
    expect(env.service.notebook(env.she).counts.total).toBe(1);
    expect(env.service.nextQuestion(env.she, session.id).next).toBeNull();
  });

  it("an answered position shows her attempt and the key; a question deleted for good is skipped", () => {
    const { session } = start({ kind: "all" }, { length: 3 });
    const first = session.items[0] as Json;
    env.service.submitAnswer(env.she, session.id, {
      answer: { type: "multiple_choice", optionId: "a" },
    });
    const item = env.service.getItem(env.she, session.id, 0) as Json;
    expect(item.answered).toBe(true);
    expect(item.attempt.questionId).toBe(first.questionId);
    expect(JSON.stringify(item.reveal)).toContain("RATIONALE-MC-RIGHT");
    const second = session.items[1] as Json;
    env.service.trashQuestion(env.she, second.questionId);
    env.service.deleteQuestion(env.she, second.questionId);
    const next = env.service.nextQuestion(env.she, session.id).next as Json;
    expect(next.position).toBe(2);
    const r = env.service.results(env.she, session.id);
    expect(r.items[1]?.text).toBeNull();
  });

  it("lists sessions newest first with their status filter", () => {
    const a = start({ kind: "all" }, { length: 1 }).session;
    const b = start({ kind: "all" }, { length: 1 }).session;
    env.service.abandonSession(env.she, a.id);
    expect(env.service.listSessions(env.she).items.map((s) => s.id)).toEqual([b.id, a.id]);
    expect(
      env.service.listSessions(env.she, { status: "abandoned" }).items.map((s) => s.id),
    ).toEqual([a.id]);
    const first = env.service.listSessions(env.she, { limit: 1 });
    expect(first.nextCursor).toBeTypeOf("string");
    expect(
      env.service.listSessions(env.she, { limit: 1, cursor: first.nextCursor as string }).items[0]
        ?.id,
    ).toBe(a.id);
  });
});

describe("skipping a question", () => {
  beforeEach(() => {
    for (let i = 0; i < 3; i++)
      make("multiple_choice", lec[0], { prompt: `Question ${i} about lorvanol (fictional)?` });
  });

  it("is kept on the server and the skipped question comes back after the others", () => {
    const { session, next } = start({ kind: "all" }, { length: 3 });
    const first = (next as { position: number }).position;
    const after = env.service.skipQuestion(env.she, session.id, first);
    expect(after.items.filter((i) => i.skipped).map((i) => i.position)).toEqual([first]);
    // a new request (another device) sees the same order: not-yet-seen first
    const resumed = env.service.nextQuestion(env.she, session.id);
    expect(resumed.session.items[first]?.skipped).toBe(true);
    expect(resumed.next?.position).not.toBe(first);
    // answer the rest; the skipped one is then the only one left
    for (let n = 0; n < 2; n++) {
      env.service.submitAnswer(env.she, session.id, {
        answer: { type: "multiple_choice", optionId: "a" },
      });
    }
    expect(env.service.nextQuestion(env.she, session.id).next?.position).toBe(first);
  });

  it("answering a skipped question clears the mark; skipping twice changes nothing", () => {
    const { session } = start({ kind: "all" }, { length: 3 });
    env.service.skipQuestion(env.she, session.id, 0);
    env.service.skipQuestion(env.she, session.id, 0);
    env.service.submitAnswer(env.she, session.id, {
      position: 0,
      answer: { type: "multiple_choice", optionId: "a" },
    });
    const view = env.service.getSession(env.she, session.id);
    expect(view.items[0]).toMatchObject({ answered: true, skipped: false });
  });

  it("refuses an answered or missing position, an agent, and a closed session", () => {
    const { session } = start({ kind: "all" }, { length: 3 });
    env.service.submitAnswer(env.she, session.id, {
      position: 1,
      answer: { type: "multiple_choice", optionId: "a" },
    });
    expect(code(() => env.service.skipQuestion(env.she, session.id, 1))).toBe("conflict");
    expect(code(() => env.service.skipQuestion(env.she, session.id, 9))).toBeDefined();
    expect(code(() => env.service.skipQuestion(env.bot, session.id, 0))).toBe("forbidden");
    env.service.finishSession(env.she, session.id);
    expect(code(() => env.service.skipQuestion(env.she, session.id, 0))).toBe("conflict");
  });
});
