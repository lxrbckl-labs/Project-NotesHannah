import { describe, expect, it } from "vitest";
import { newId } from "../src/ids.js";
import type { Question, QuestionInput, QuestionType } from "../src/practice/content.js";
import type { GradeResult } from "../src/practice/grade-result.js";
import { notebookEntries, notebookQuestionIds } from "../src/practice/notebook.js";
import { exampleFor } from "../src/practice/registry.js";
import { deriveSeed, hashSeed, makeRng, shuffled } from "../src/practice/rng.js";
import {
  Attempt,
  buildSession,
  displayOrder,
  type PoolQuestion,
  PracticeSession,
  questionWeight,
  sessionShortfall,
} from "../src/practice/session.js";
import { toStoredQuestion, validateQuestionInput } from "../src/practice/validate.js";
import { weakAreas } from "../src/practice/weak-areas.js";

const NODE_A = newId("node");
const NODE_B = newId("node");
const NODE_ROOT = newId("node");
const CONCEPT_1 = newId("concept");
const CONCEPT_2 = newId("concept");
const EXAM = newId("exam");

let counter = 0;
function make(type: QuestionType, extra: Record<string, unknown> = {}): Question {
  const r = validateQuestionInput({ ...exampleFor(type), ...extra });
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return toStoredQuestion(r.question as QuestionInput, {
    id: newId("question", 1_700_000_000_000 + counter++),
    author: { type: "user", userId: newId("user") },
    now: "2026-11-15T10:00:00.000Z",
  });
}
function pool(
  counts: Partial<Record<QuestionType, number>>,
  nodes: string[] = [NODE_A, NODE_ROOT],
): PoolQuestion[] {
  const out: PoolQuestion[] = [];
  for (const [type, n] of Object.entries(counts) as Array<[QuestionType, number]>) {
    for (let i = 0; i < n; i++) out.push({ question: make(type), nodeIds: nodes, examIds: [] });
  }
  return out;
}
const T = (n: number) => new Date(Date.UTC(2026, 10, 1) + n * 3_600_000).toISOString();

function attempt(question: Question | string, correct: boolean, n: number, type?: QuestionType) {
  const id = typeof question === "string" ? question : question.id;
  const t = typeof question === "string" ? (type ?? "multiple_choice") : question.type;
  return {
    questionId: id,
    at: T(n),
    answer: { type: t } as never,
    result: { correct, score: correct ? 1 : 0 } as GradeResult,
  };
}

const SESSION_ID = newId("practiceSession");
const base = (p: PoolQuestion[], over: Record<string, unknown> = {}) => ({
  id: SESSION_ID,
  startedAt: "2026-11-15T12:00:00.000Z",
  scope: { kind: "all" as const },
  formats: ["multiple_choice", "fill_blank", "calculation", "matching"] as QuestionType[],
  length: 8,
  seed: 42,
  pool: p,
  ...over,
});

describe("seeded random numbers", () => {
  it("repeat for the same seed and differ for another", () => {
    const a = makeRng(5);
    const b = makeRng(5);
    const seqA = Array.from({ length: 5 }, a);
    expect(Array.from({ length: 5 }, b)).toEqual(seqA);
    expect(Array.from({ length: 5 }, makeRng(6))).not.toEqual(seqA);
    for (const x of seqA) expect(x >= 0 && x < 1).toBe(true);
  });
  it("hashes parts to stable 32-bit seeds", () => {
    expect(hashSeed("a", 1)).toBe(hashSeed("a", 1));
    expect(hashSeed("a", 1)).not.toBe(hashSeed("a", 2));
    expect(hashSeed("ab", "c")).not.toBe(hashSeed("a", "bc"));
    expect(deriveSeed(1, "x")).toBeLessThan(2 ** 32);
  });
  it("shuffles without losing or changing the input", () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = shuffled(input, makeRng(3));
    expect(out.slice().sort()).toEqual(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(shuffled(input, makeRng(3))).toEqual(out);
  });
  it("gives a roughly even spread of the first position", () => {
    const counts = new Array(4).fill(0);
    for (let s = 0; s < 4000; s++)
      counts[(shuffled([0, 1, 2, 3], makeRng(s)) as number[])[0] as number]++;
    for (const c of counts) expect(c).toBeGreaterThan(800);
  });
});

describe("display order of options", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }];
  it("repeats for the same seed and keeps the authored order when shuffle is off", () => {
    expect(displayOrder(items, 9, true)).toEqual(displayOrder(items, 9, true));
    expect(displayOrder(items, 9, false)).toEqual(items);
    const orders = new Set(
      Array.from({ length: 30 }, (_, s) =>
        displayOrder(items, s, true)
          .map((i) => i.id)
          .join(""),
      ),
    );
    expect(orders.size).toBeGreaterThan(10);
  });
});

describe("buildSession", () => {
  const P = pool({
    multiple_choice: 10,
    fill_blank: 10,
    calculation: 10,
    matching: 10,
    flashcard: 5,
  });

  it("is reproducible from the seed", () => {
    const again = buildSession(base(P));
    const first = buildSession(base(P));
    expect(again).toEqual(first);
  });
  it("is reproducible regardless of the order the pool arrives in", () => {
    expect(buildSession(base(P.slice().reverse()))).toEqual(buildSession(base(P)));
  });
  it("another seed gives another session", () => {
    const a = buildSession(base(P, { seed: 1 }));
    const b = buildSession(base(P, { seed: 2 }));
    expect(a.items.map((i) => i.questionId)).not.toEqual(b.items.map((i) => i.questionId));
  });
  it("produces a valid PracticeSession record", () => {
    const s = buildSession(base(P));
    expect(PracticeSession.safeParse(s).success).toBe(true);
    expect(s.finishedAt).toBeNull();
    expect(s.length).toBe(8);
    expect(s.items).toHaveLength(8);
  });
  it("never repeats a question and only uses the requested formats", () => {
    const s = buildSession(base(P, { formats: ["calculation", "matching"], length: 12 }));
    const ids = s.items.map((i) => i.questionId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const i of s.items) expect(["calculation", "matching"]).toContain(i.type);
  });
  it("balances types: equal shares when the length divides evenly", () => {
    const s = buildSession(base(P, { length: 8 }));
    const counts = new Map<string, number>();
    for (const i of s.items) counts.set(i.type, (counts.get(i.type) ?? 0) + 1);
    expect([...counts.values()]).toEqual([2, 2, 2, 2]);
  });
  it("balances types: shares differ by at most one otherwise, for every seed", () => {
    for (let seed = 0; seed < 50; seed++) {
      const s = buildSession(base(P, { length: 10, seed }));
      const counts = new Map<string, number>();
      for (const i of s.items) counts.set(i.type, (counts.get(i.type) ?? 0) + 1);
      const values = [...counts.values()];
      expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
      expect(values.reduce((a, b) => a + b, 0)).toBe(10);
    }
  });
  it("hands the share of a short type to the others", () => {
    const small = pool({ multiple_choice: 10, flashcard: 1 });
    const s = buildSession(base(small, { formats: ["multiple_choice", "flashcard"], length: 6 }));
    expect(s.items.filter((i) => i.type === "flashcard")).toHaveLength(1);
    expect(s.items.filter((i) => i.type === "multiple_choice")).toHaveLength(5);
  });
  it("is shorter than asked, not broken, when the pool is small", () => {
    const small = pool({ multiple_choice: 2, fill_blank: 1 });
    const s = buildSession(base(small, { length: 10 }));
    expect(s.items).toHaveLength(3);
    expect(s.length).toBe(10);
    expect(sessionShortfall(s)).toBe(7);
  });
  it("is empty when nothing matches", () => {
    expect(buildSession(base([])).items).toEqual([]);
    expect(buildSession(base(P, { formats: ["case"] })).items).toEqual([]);
  });
  it("mixes the order of types", () => {
    const orders = new Set<string>();
    for (let seed = 0; seed < 20; seed++)
      orders.add(
        buildSession(base(P, { seed }))
          .items.map((i) => i.type)
          .join(),
      );
    expect(orders.size).toBeGreaterThan(10);
  });
  it("gives each item its own stable seeds", () => {
    const s = buildSession(base(P));
    const variantSeeds = new Set(s.items.map((i) => i.variantSeed));
    expect(variantSeeds.size).toBe(s.items.length);
    const again = buildSession(base(P));
    expect(again.items.map((i) => i.variantSeed)).toEqual(s.items.map((i) => i.variantSeed));
    // the seed of a question does not depend on which others were chosen
    const other = buildSession(base(P, { length: 20 }));
    for (const item of s.items) {
      const match = other.items.find((i) => i.questionId === item.questionId);
      if (match) expect(match.variantSeed).toBe(item.variantSeed);
    }
  });

  describe("scope", () => {
    const withNodes = [
      ...pool({ multiple_choice: 3 }, [NODE_A, NODE_ROOT]),
      ...pool({ multiple_choice: 3 }, [NODE_B, NODE_ROOT]),
    ];
    const ids = (s: PracticeSession) => new Set(s.items.map((i) => i.questionId));
    const q = (i: number) => (withNodes[i] as PoolQuestion).question.id;

    it("nodes: a lecture, or a folder above it", () => {
      const a = buildSession(
        base(withNodes, { scope: { kind: "nodes", nodeIds: [NODE_A] }, length: 20 }),
      );
      expect(ids(a)).toEqual(new Set([q(0), q(1), q(2)]));
      const root = buildSession(
        base(withNodes, { scope: { kind: "nodes", nodeIds: [NODE_ROOT] }, length: 20 }),
      );
      expect(root.items).toHaveLength(6);
      const both = buildSession(
        base(withNodes, { scope: { kind: "nodes", nodeIds: [NODE_A, NODE_B] }, length: 20 }),
      );
      expect(both.items).toHaveLength(6);
      const none = buildSession(
        base(withNodes, { scope: { kind: "nodes", nodeIds: [newId("node")] }, length: 20 }),
      );
      expect(none.items).toHaveLength(0);
    });
    it("concepts", () => {
      const tagged: PoolQuestion[] = [
        {
          question: make("multiple_choice", { conceptIds: [CONCEPT_1] }),
          nodeIds: [],
          examIds: [],
        },
        {
          question: make("multiple_choice", { conceptIds: [CONCEPT_2] }),
          nodeIds: [],
          examIds: [],
        },
        {
          question: make("multiple_choice", { conceptIds: [CONCEPT_1, CONCEPT_2] }),
          nodeIds: [],
          examIds: [],
        },
        { question: make("multiple_choice"), nodeIds: [], examIds: [] },
      ];
      const s = buildSession(
        base(tagged, { scope: { kind: "concepts", conceptIds: [CONCEPT_1] }, length: 10 }),
      );
      expect(ids(s)).toEqual(
        new Set([(tagged[0] as PoolQuestion).question.id, (tagged[2] as PoolQuestion).question.id]),
      );
    });
    it("exam", () => {
      const exam: PoolQuestion[] = [
        { question: make("multiple_choice"), nodeIds: [], examIds: [EXAM] },
        { question: make("multiple_choice"), nodeIds: [], examIds: [] },
        { question: make("multiple_choice"), nodeIds: [], examIds: [EXAM, newId("exam")] },
      ];
      const s = buildSession(base(exam, { scope: { kind: "exam", examId: EXAM }, length: 10 }));
      expect(ids(s)).toEqual(
        new Set([(exam[0] as PoolQuestion).question.id, (exam[2] as PoolQuestion).question.id]),
      );
    });
    it("missed: only what is in the notebook, from the history", () => {
      const p = pool({ multiple_choice: 5 });
      const [a, b, c] = p.map((x) => x.question);
      const history = [
        attempt(a as Question, false, 1),
        attempt(b as Question, false, 2),
        attempt(b as Question, true, 3), // recovered
        attempt(c as Question, true, 4),
      ];
      const s = buildSession(base(p, { scope: { kind: "missed" }, length: 10, history }));
      expect(ids(s)).toEqual(new Set([(a as Question).id]));
      expect(buildSession(base(p, { scope: { kind: "missed" }, length: 10 })).items).toHaveLength(
        0,
      );
    });
    it("validates as a scope record", () => {
      const s = buildSession(base(withNodes, { scope: { kind: "nodes", nodeIds: [NODE_A] } }));
      expect(PracticeSession.safeParse(s).success).toBe(true);
    });
  });

  describe("weak questions come up more often when history is supplied", () => {
    const p = pool({ multiple_choice: 12 });
    const weak = (p[0] as PoolQuestion).question;
    const strong = (p[1] as PoolQuestion).question;
    const history = [
      attempt(weak, false, 1),
      attempt(weak, false, 2),
      attempt(weak, false, 3),
      attempt(strong, true, 4),
      attempt(strong, true, 5),
      attempt(strong, true, 6),
    ];
    const run = (h: typeof history | undefined) => {
      let weakHits = 0;
      let strongHits = 0;
      for (let seed = 0; seed < 600; seed++) {
        const s = buildSession(
          base(p, { formats: ["multiple_choice"], length: 3, seed, history: h }),
        );
        if (s.items.some((i) => i.questionId === weak.id)) weakHits++;
        if (s.items.some((i) => i.questionId === strong.id)) strongHits++;
      }
      return { weakHits, strongHits };
    };
    it("without history every question is equally likely", () => {
      const { weakHits, strongHits } = run(undefined);
      expect(Math.abs(weakHits - strongHits)).toBeLessThan(80);
      expect(weakHits / 600).toBeGreaterThan(0.18);
      expect(weakHits / 600).toBeLessThan(0.34);
    });
    it("with history the missed question is picked far more than the mastered one", () => {
      const { weakHits, strongHits } = run(history);
      expect(weakHits).toBeGreaterThan(strongHits * 1.8);
      expect(weakHits / 600).toBeGreaterThan(0.5);
    });
    it("weights: unseen 1, always right 1, always wrong and last wrong 6", () => {
      expect(questionWeight("none", [])).toBe(1);
      expect(questionWeight(strong.id, history)).toBe(1);
      expect(questionWeight(weak.id, history)).toBe(6);
      expect(
        questionWeight(weak.id, [attempt(weak, false, 1), attempt(weak, true, 2)]),
      ).toBeCloseTo(2.5, 10);
    });
    it("is still reproducible with history", () => {
      expect(buildSession(base(p, { length: 3, history }))).toEqual(
        buildSession(base(p, { length: 3, history })),
      );
    });
  });
});

describe("attempt records", () => {
  it("validates a full attempt", () => {
    const q = make("multiple_choice");
    const a = {
      id: newId("attempt"),
      sessionId: newId("practiceSession"),
      questionId: q.id,
      variantSeed: null,
      answer: { type: "multiple_choice", optionId: "o1" },
      result: {
        correct: true,
        score: 1,
        points: 1,
        maxPoints: 1,
        selfGraded: false,
        malformed: false,
        feedback: [{ label: "x", correct: true, code: "correct", message: "ok" }],
        correctAnswer: { text: "x", data: null },
      },
      timeTakenMs: 4200,
      at: "2026-11-15T12:01:00.000Z",
    };
    expect(Attempt.safeParse(a).success).toBe(true);
    expect(Attempt.safeParse({ ...a, sessionId: null, variantSeed: 77 }).success).toBe(true);
    expect(Attempt.safeParse({ ...a, timeTakenMs: -1 }).success).toBe(false);
    expect(Attempt.safeParse({ ...a, at: "yesterday" }).success).toBe(false);
    expect(Attempt.safeParse({ ...a, variantSeed: 1.5 }).success).toBe(false);
  });
});

describe("missed-questions notebook", () => {
  const mc = (id: string, ok: boolean, n: number) => attempt(id, ok, n, "multiple_choice");
  const calc = (id: string, ok: boolean, n: number) => attempt(id, ok, n, "calculation");

  it("a wrong answer puts a question in, a later right answer takes it out", () => {
    expect(notebookQuestionIds([mc("q1", false, 1)])).toEqual(["q1"]);
    expect(notebookQuestionIds([mc("q1", false, 1), mc("q1", true, 2)])).toEqual([]);
  });
  it("a right answer on a question never missed changes nothing", () => {
    expect(notebookQuestionIds([mc("q1", true, 1), mc("q1", true, 2)])).toEqual([]);
  });
  it("a wrong answer after recovering puts it back", () => {
    expect(
      notebookQuestionIds([mc("q1", false, 1), mc("q1", true, 2), mc("q1", false, 3)]),
    ).toEqual(["q1"]);
  });
  it("calculations need two correct in a row", () => {
    expect(notebookQuestionIds([calc("c", false, 1), calc("c", true, 2)])).toEqual(["c"]);
    expect(
      notebookQuestionIds([calc("c", false, 1), calc("c", true, 2), calc("c", true, 3)]),
    ).toEqual([]);
  });
  it("a wrong answer resets a calculation's run", () => {
    const run = [calc("c", false, 1), calc("c", true, 2), calc("c", false, 3), calc("c", true, 4)];
    expect(notebookQuestionIds(run)).toEqual(["c"]);
    const entry = notebookEntries(run)[0];
    expect(entry).toMatchObject({
      timesMissed: 2,
      correctRun: 1,
      stillNeeds: 1,
      type: "calculation",
    });
  });
  it("is not fooled by the order attempts arrive in", () => {
    const run = [mc("q", true, 5), mc("q", false, 1), mc("q", false, 3)];
    expect(notebookQuestionIds(run)).toEqual([]);
    expect(notebookQuestionIds([...run].reverse())).toEqual([]);
  });
  it("keeps the order of equal timestamps as given", () => {
    const a = { ...mc("q", false, 1) };
    const b = { ...mc("q", true, 1) };
    expect(notebookQuestionIds([a, b])).toEqual([]);
    expect(notebookQuestionIds([b, a])).toEqual(["q"]);
  });
  it("flashcards never enter", () => {
    expect(notebookQuestionIds([attempt("f", false, 1, "flashcard")])).toEqual([]);
  });
  it("self-graded and case questions follow the single-correct rule", () => {
    expect(
      notebookQuestionIds([
        attempt("r", false, 1, "free_response"),
        attempt("r", true, 2, "free_response"),
      ]),
    ).toEqual([]);
    expect(notebookQuestionIds([attempt("k", false, 1, "case")])).toEqual(["k"]);
  });
  it("lists the most recently missed first, with counts and dates", () => {
    const entries = notebookEntries([
      mc("old", false, 1),
      mc("new", false, 5),
      mc("old", false, 2),
      mc("mid", false, 3),
    ]);
    expect(entries.map((e) => e.questionId)).toEqual(["new", "mid", "old"]);
    expect(entries[2]).toMatchObject({
      timesMissed: 2,
      firstMissedAt: T(1),
      lastMissedAt: T(2),
      stillNeeds: 1,
    });
  });
  it("first-missed date restarts after a recovery", () => {
    const e = notebookEntries([mc("q", false, 1), mc("q", true, 2), mc("q", false, 7)])[0];
    expect(e?.firstMissedAt).toBe(T(7));
    expect(e?.timesMissed).toBe(3 - 1);
  });
  it("handles many questions independently", () => {
    const run = [mc("a", false, 1), mc("b", false, 2), mc("a", true, 3), mc("c", true, 4)];
    expect(notebookQuestionIds(run)).toEqual(["b"]);
  });
  it("is empty for no attempts", () => {
    expect(notebookEntries([])).toEqual([]);
  });
});

describe("weak areas", () => {
  const labels = (id: string, tags: string[], concepts: string[], nodes: string[]) => ({
    questionId: id,
    tags,
    conceptIds: concepts,
    nodeIds: nodes,
  });
  const q = (i: number) => `qst_${i}`;
  const res = (correct: boolean, score = correct ? 1 : 0) => ({ correct, score }) as GradeResult;
  const att = (i: number, correct: boolean, score?: number) => ({
    questionId: q(i),
    result: res(correct, score),
  });

  const L = [
    labels(q(1), ["beta-blockers"], [CONCEPT_1], [NODE_A, NODE_ROOT]),
    labels(q(2), ["beta-blockers"], [CONCEPT_1], [NODE_A, NODE_ROOT]),
    labels(q(3), ["beta-blockers"], [CONCEPT_1], [NODE_A, NODE_ROOT]),
    labels(q(4), ["ace-inhibitors"], [CONCEPT_2], [NODE_B, NODE_ROOT]),
    labels(q(5), ["ace-inhibitors"], [CONCEPT_2], [NODE_B, NODE_ROOT]),
    labels(q(6), ["dosing"], [], [NODE_B, NODE_ROOT]),
  ];
  const find = (list: ReturnType<typeof weakAreas>["byTag"], key: string) =>
    list.find((a) => a.key === key);

  it("one wrong answer does not make a topic weak", () => {
    const r = weakAreas([att(1, false)], L);
    expect(find(r.byTag, "beta-blockers")).toMatchObject({
      attempts: 1,
      status: "insufficient_data",
    });
    expect(find(r.byConcept, CONCEPT_1)?.status).toBe("insufficient_data");
    expect(find(r.byNode, NODE_A)?.status).toBe("insufficient_data");
  });
  it("four wrong answers are still too few by default", () => {
    const r = weakAreas([att(1, false), att(2, false), att(3, false), att(1, false)], L);
    expect(find(r.byTag, "beta-blockers")?.status).toBe("insufficient_data");
  });
  it("one question retried many times is not enough different questions", () => {
    const many = Array.from({ length: 8 }, () => att(1, false));
    expect(find(weakAreas(many, L).byTag, "beta-blockers")).toMatchObject({
      attempts: 8,
      questions: 1,
      status: "insufficient_data",
    });
  });
  it("enough attempts across enough questions, and low accuracy, is weak", () => {
    const attempts = [att(1, false), att(2, false), att(3, true), att(1, false), att(2, true)];
    const r = weakAreas(attempts, L);
    const t = find(r.byTag, "beta-blockers");
    expect(t).toMatchObject({ attempts: 5, correct: 2, questions: 3, status: "weak" });
    expect(t?.accuracy).toBeCloseTo(0.4, 10);
  });
  it("good accuracy is ok", () => {
    const attempts = [att(1, true), att(2, true), att(3, true), att(1, true), att(2, false)];
    expect(find(weakAreas(attempts, L).byTag, "beta-blockers")?.status).toBe("ok");
  });
  it("the threshold is a boundary: below 0.7 is weak, 0.7 is ok", () => {
    const seven = [
      att(1, true),
      att(2, true),
      att(3, true),
      att(1, true),
      att(2, true),
      att(3, true),
      att(1, true),
    ];
    const ten = (k: number) => [...seven, ...[1, 2, 3].map((i, n) => att(i, n < k))];
    expect(find(weakAreas(ten(0), L).byTag, "beta-blockers")?.accuracy).toBeCloseTo(0.7, 10);
    expect(find(weakAreas(ten(0), L).byTag, "beta-blockers")?.status).toBe("ok");
    expect(
      find(
        weakAreas([...seven.slice(1), ...[1, 2, 3].map((i) => att(i, false))], L).byTag,
        "beta-blockers",
      )?.status,
    ).toBe("weak");
  });
  it("a topic with fewer questions than the minimum can still be judged once it has the attempts", () => {
    // ace-inhibitors has only two questions in the catalogue
    const attempts = [att(4, false), att(5, false), att(4, false), att(5, false), att(4, true)];
    expect(find(weakAreas(attempts, L).byTag, "ace-inhibitors")).toMatchObject({
      questions: 2,
      status: "weak",
    });
  });
  it("options change the thresholds", () => {
    const attempts = [att(1, false), att(2, false)];
    const r = weakAreas(attempts, L, { minAttempts: 2, minQuestions: 2 });
    expect(find(r.byTag, "beta-blockers")?.status).toBe("weak");
    expect(
      find(
        weakAreas(attempts, L, { minAttempts: 2, minQuestions: 2, weakBelow: 0 }).byTag,
        "beta-blockers",
      )?.status,
    ).toBe("ok");
  });
  it("reports by concept and by lecture/folder, counting a question under each ancestor", () => {
    const attempts = [
      att(1, false),
      att(2, false),
      att(3, true),
      att(4, true),
      att(5, true),
      att(6, true),
    ];
    const r = weakAreas(attempts, L, { minAttempts: 3, minQuestions: 2 });
    expect(find(r.byNode, NODE_ROOT)).toMatchObject({ attempts: 6, correct: 4 });
    expect(find(r.byNode, NODE_A)).toMatchObject({ attempts: 3, correct: 1, status: "weak" });
    expect(find(r.byNode, NODE_B)).toMatchObject({ attempts: 3, correct: 3, status: "ok" });
    expect(find(r.byConcept, CONCEPT_1)?.status).toBe("weak");
  });
  it("sorts weak first (worst first), then ok, then insufficient", () => {
    const attempts = [
      att(1, false),
      att(2, false),
      att(3, false),
      att(1, false),
      att(2, true), // beta: 1/5 weak
      att(4, true),
      att(5, true),
      att(4, true),
      att(5, true),
      att(4, true), // ace: ok
      att(6, false), // dosing: insufficient
    ];
    const keys = weakAreas(attempts, L).byTag.map((a) => `${a.key}:${a.status}`);
    expect(keys).toEqual(["beta-blockers:weak", "ace-inhibitors:ok", "dosing:insufficient_data"]);
  });
  it("counts partial credit in the mean score", () => {
    const attempts = [
      att(1, false, 0.5),
      att(2, false, 0.5),
      att(3, true, 1),
      att(1, true, 1),
      att(2, true, 1),
    ];
    const t = find(weakAreas(attempts, L).byTag, "beta-blockers");
    expect(t?.meanScore).toBeCloseTo(0.8, 10);
    expect(t?.accuracy).toBeCloseTo(0.6, 10);
  });
  it("ignores attempts on questions it has no labels for, and says how many", () => {
    const r = weakAreas([att(1, false), { questionId: "qst_gone", result: res(false) }], L);
    expect(r.unmatchedAttempts).toBe(1);
    expect(find(r.byTag, "beta-blockers")?.attempts).toBe(1);
  });
  it("is empty with no attempts", () => {
    expect(weakAreas([], L)).toEqual({
      byTag: [],
      byConcept: [],
      byNode: [],
      unmatchedAttempts: 0,
    });
  });
});
