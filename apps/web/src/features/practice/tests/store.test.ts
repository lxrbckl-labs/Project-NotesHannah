import { practice } from "@notes/schema";
import { expect, test } from "vitest";
import { summarise } from "../lib/results";
import { NODE_L7, NODE_L8 } from "../store/bank";
import { type AnswerKey, buildAnswer } from "../store/key";
import type { Answer, SessionState } from "../types";
import { newStore } from "./fixtures";

const ALL = [
  "multiple_choice",
  "select_all",
  "matching",
  "fill_blank",
  "calculation",
  "flashcard",
  "case",
  "free_response",
] as const;

/** Answer the question a session is on, right or wrong, the way a client would. */
async function answerCurrent(
  store: ReturnType<typeof newStore>,
  s: SessionState,
  mode: "right" | "wrong",
) {
  const cur = s.current;
  if (!cur) throw new Error("no current question");
  const q = store.bank.find((b) => b.id === cur.questionId) as practice.Question;
  const answer = buildFromKey(q, store.debugKey(s.id, cur.index), mode);
  return store.submitAnswer(s.id, cur.index, answer, 12_000);
}

function buildFromKey(
  q: practice.Question | practice.QuestionPart,
  key: AnswerKey,
  mode: "right" | "wrong",
): Answer {
  const right = mode === "right";
  switch (key.type) {
    case "multiple_choice": {
      const opt = (q as practice.Question & { type: "multiple_choice" }).options.find(
        (o) => o.text === (right ? key.correct : key.wrong),
      );
      return { type: "multiple_choice", optionId: (opt as { id: string }).id };
    }
    case "select_all": {
      const texts = right ? key.correct : key.wrong;
      const opts = (q as practice.Question & { type: "select_all" }).options.filter((o) =>
        texts.includes(o.text),
      );
      return { type: "select_all", optionIds: opts.map((o) => o.id) };
    }
    case "matching": {
      const pairs = (q as practice.Question & { type: "matching" }).pairs;
      const m = right ? key.correct : key.wrong;
      return {
        type: "matching",
        matches: m.map((x) => ({
          pairId: (pairs.find((p) => p.left === x.left) as { id: string }).id,
          right: x.right,
        })),
      };
    }
    case "fill_blank":
      return { type: "fill_blank", blanks: right ? key.correct : key.wrong };
    case "calculation": {
      const v = right ? key.correct : key.wrong;
      return { type: "calculation", response: v.value, unit: v.unit };
    }
    case "flashcard":
      return { type: "flashcard", rating: right ? "good" : "again" };
    case "free_response":
      return { type: "free_response", text: "x", covered: right ? key.covered : [] };
    case "case": {
      const parts = (q as practice.Question & { type: "case" }).questions;
      return {
        type: "case",
        parts: key.parts.map(
          (k, i) => buildFromKey(parts[i] as practice.QuestionPart, k, mode) as practice.PartAnswer,
        ),
      };
    }
  }
}

test("start, answer, skip: progress and the skipped question coming back", async () => {
  const store = newStore();
  let s = await store.startSession({
    scope: { kind: "all" },
    formats: ["multiple_choice"],
    length: 3,
  });
  expect(s.total).toBe(3);
  expect(s.current?.index).toBe(0);
  s = await store.skip(s.id, 0);
  expect(s.current?.index).toBe(1);
  expect(s.skipped).toBe(1);
  await answerCurrent(store, s, "right");
  s = await store.getSession(s.id);
  expect(s.answered).toBe(1);
  expect(s.current?.index).toBe(2);
  await answerCurrent(store, s, "right");
  s = await store.getSession(s.id);
  // only the skipped question is left: it comes back, and skipping again is pointless
  expect(s.current?.index).toBe(0);
  expect(s.onlySkippedLeft).toBe(true);
  await answerCurrent(store, s, "right");
  s = await store.getSession(s.id);
  expect(s.current).toBeNull();
});

test("an unfinished session can be resumed and shows the same question", async () => {
  const store = newStore();
  const s = await store.startSession({ scope: { kind: "all" }, formats: [...ALL], length: 6 });
  await answerCurrent(store, s, "right");
  const left = await store.getUnfinishedSession();
  expect(left?.id).toBe(s.id);
  expect(left?.answered).toBe(1);
  const again = await store.getSession(s.id);
  expect(again.answered).toBe(1);
  expect(again.current?.index).toBe(1);
  await store.abandonSession(s.id);
  expect(await store.getUnfinishedSession()).toBeNull();
});

test("finishing makes results; the math counts answered, correct and points", async () => {
  const store = newStore();
  let s = await store.startSession({
    scope: { kind: "all" },
    formats: ["multiple_choice", "fill_blank"],
    length: 5,
  });
  const modes: ("right" | "wrong")[] = ["right", "wrong", "right", "right"];
  for (const mode of modes) {
    await answerCurrent(store, s, mode);
    s = await store.getSession(s.id);
  }
  const results = await store.finishSession(s.id);
  expect(results.finishedAt).not.toBeNull();
  const sum = summarise(results.items);
  expect(sum.total).toBe(5);
  expect(sum.answered).toBe(4);
  expect(sum.skipped).toBe(1);
  expect(sum.correct).toBe(3);
  expect(sum.accuracy).toBeCloseTo(0.75);
  expect(sum.timeMs).toBe(4 * 12_000);
  expect(sum.missed).toHaveLength(1);
  expect(sum.notebookAdded).toHaveLength(1);
  expect(sum.points).toBeLessThanOrEqual(sum.maxPoints);
  expect(sum.byType.reduce((n, t) => n + t.total, 0)).toBe(4);
  // a finished session is not offered for resuming
  expect(await store.getUnfinishedSession()).toBeNull();
});

test("a wrong answer enters the notebook with its reason; a right one clears it", async () => {
  const store = newStore();
  let s = await store.startSession({
    scope: { kind: "all" },
    formats: ["multiple_choice"],
    length: 1,
  });
  const out = await answerCurrent(store, s, "wrong");
  expect(out.notebook).toBe("added");
  let nb = await store.listNotebook();
  expect(nb).toHaveLength(1);
  expect(nb[0]?.reason).toMatch(/Not correct/);
  expect(nb[0]?.leaveRule).toMatch(/once/);
  // retry just that question
  s = await store.startSession({
    scope: { kind: "missed" },
    formats: ["multiple_choice"],
    length: 1,
    questionIds: [nb[0]?.entry.questionId as string],
  });
  expect(s.total).toBe(1);
  const ok = await answerCurrent(store, s, "right");
  expect(ok.notebook).toBe("cleared");
  nb = await store.listNotebook();
  expect(nb).toHaveLength(0);
});

test("calculations need two correct answers in a row to leave the notebook", async () => {
  const store = newStore();
  const q = store.bank.find((b) => b.type === "calculation" && b.answer.kind === "fixed");
  const ids = [q?.id as string];
  const run = async (mode: "right" | "wrong") => {
    const s = await store.startSession({
      scope: { kind: "all" },
      formats: ["calculation"],
      length: 1,
      questionIds: ids,
    });
    return answerCurrent(store, s, mode);
  };
  expect((await run("wrong")).notebook).toBe("added");
  const first = await run("right");
  expect(first.notebook).toBe("progress");
  expect(first.notebookNote).toMatch(/1 of 2/);
  expect((await run("right")).notebook).toBe("cleared");
  expect(await store.listNotebook()).toHaveLength(0);
});

test("a calculation 1000-fold unit slip and a missing unit are explained", async () => {
  const store = newStore();
  const q = store.bank.find(
    (b) =>
      b.type === "calculation" && b.answer.kind === "fixed" && b.units[0] === "mg" && !b.rounding,
  );
  let s = await store.startSession({
    scope: { kind: "all" },
    formats: ["calculation"],
    length: 1,
    questionIds: [q?.id as string],
  });
  const slip = await store.submitAnswer(
    s.id,
    0,
    { type: "calculation", response: "50", unit: "g" },
    1000,
  );
  expect(slip.result.feedback[0]?.message).toMatch(/1000 times too large/);
  s = await store.startSession({
    scope: { kind: "all" },
    formats: ["calculation"],
    length: 1,
    questionIds: [q?.id as string],
  });
  const none = await store.submitAnswer(s.id, 0, { type: "calculation", response: "50" }, 1000);
  expect(none.result.feedback[0]?.message).toMatch(/No unit given/);
  expect(none.result.correct).toBe(false);
});

test("flashcards reveal the back with the next interval on each button, then self-grade", async () => {
  const store = newStore();
  const s = await store.startSession({ scope: { kind: "all" }, formats: ["flashcard"], length: 2 });
  const r = await store.reveal(s.id, 0);
  expect(r.type).toBe("flashcard");
  if (r.type === "flashcard") {
    expect(r.back.length).toBeGreaterThan(0);
    const { again, hard, good, easy } = r.intervals;
    expect(again).toBeLessThanOrEqual(hard);
    expect(hard).toBeLessThanOrEqual(good);
    expect(good).toBeLessThan(easy);
  }
  const out = await store.submitAnswer(s.id, 0, { type: "flashcard", rating: "good" }, 3000);
  expect(out.result.selfGraded).toBe(true);
  expect(out.result.correct).toBe(true);
  expect(out.notebook).toBeNull();
  const again = await store.startSession({
    scope: { kind: "all" },
    formats: ["flashcard"],
    length: 1,
  });
  const out2 = await store.submitAnswer(again.id, 0, { type: "flashcard", rating: "again" }, 3000);
  expect(out2.result.correct).toBe(false);
  // an "again" on a card is not a miss
  expect(await store.listNotebook()).toHaveLength(0);
});

test("free response: the model answer and rubric arrive on request; ticks decide the grade", async () => {
  const store = newStore();
  const s = await store.startSession({
    scope: { kind: "all" },
    formats: ["free_response"],
    length: 1,
  });
  const shown = await store.reveal(s.id, 0);
  expect(shown.type).toBe("free_response");
  if (shown.type !== "free_response") return;
  expect(shown.rubric.length).toBeGreaterThan(1);
  const partial = await store.submitAnswer(
    s.id,
    0,
    { type: "free_response", text: "mine", covered: [0] },
    4000,
  );
  expect(partial.result.selfGraded).toBe(true);
  expect(partial.result.correct).toBe(false);
  expect(partial.result.points).toBe(shown.rubric[0]?.points);
  expect(partial.notebook).toBe("added");
});

test("a case is graded per part and explains each part", async () => {
  const store = newStore();
  const s = await store.startSession({ scope: { kind: "all" }, formats: ["case"], length: 1 });
  const out = await answerCurrent(store, s, "right").catch(() => null);
  void out;
  const s2 = await store.startSession({ scope: { kind: "all" }, formats: ["case"], length: 1 });
  const cur = s2.current;
  expect(cur?.type).toBe("case");
  const res = await answerCurrent(store, s2, "wrong");
  expect(res.result.parts?.length).toBe(cur?.type === "case" ? cur.parts.length : -1);
  expect(res.partExplanations?.length).toBe(res.result.parts?.length);
  expect(res.result.correct).toBe(false);
});

test("weak areas say 'not enough' until there is enough, then weak or ok", async () => {
  const store = newStore("demo");
  const view = await store.getWeakAreas();
  const statuses = new Set(
    [...view.byConcept, ...view.byTag, ...view.byNode].map((r) => r.stat.status),
  );
  expect(statuses.has("insufficient_data")).toBe(true);
  expect(statuses.has("weak") || statuses.has("ok")).toBe(true);
  for (const r of view.byNode) {
    if (r.stat.status === "insufficient_data") {
      expect(r.stat.attempts < 5 || r.stat.questions < 3).toBe(true);
    }
  }
  expect(view.thresholds.minAttempts).toBe(5);
  const empty = await newStore("empty").getWeakAreas();
  expect(empty.byConcept).toHaveLength(0);
  expect(empty.totalAttempts).toBe(0);
});

test("due cards by day cover two weeks and today's count matches the due scope", async () => {
  const store = newStore("demo");
  const due = await store.getDueByDay(14);
  expect(due.days).toHaveLength(14);
  expect(due.days[0]?.count).toBe(due.today);
  const overview = await store.getOverview({ currentNodeId: NODE_L7 });
  expect(overview.dueToday).toBe(due.today);
  expect(overview.scopes.find((x) => x.kind === "due")?.total).toBe(due.today);
  const s = await store.startSession({
    scope: { kind: "all" },
    formats: ["flashcard"],
    length: 50,
    dueOnly: true,
  });
  expect(s.total).toBe(due.today);
  expect(due.days.slice(1).some((d) => d.count > 0)).toBe(true);
});

test("overview counts by type and notebook size; empty start has nothing due or missed", async () => {
  const empty = await newStore("empty").getOverview();
  expect(empty.notebookSize).toBe(0);
  expect(empty.scopes.some((s) => s.kind === "missed")).toBe(false);
  const all = empty.scopes.find((s) => s.kind === "all");
  expect(all?.total).toBeGreaterThanOrEqual(38);
  expect(Object.values(all?.counts ?? {}).every((n) => n > 0)).toBe(true);
});

test("exams: create, edit coverage, progress, scope, delete", async () => {
  const store = newStore("empty");
  expect(await store.listExams()).toHaveLength(0);
  await expect(
    store.createExam({ course: "", title: "x", date: "2026-12-01", nodeIds: [NODE_L7] }),
  ).rejects.toThrow();
  const e = await store.createExam({
    course: "Cardio",
    title: "Midterm",
    date: "2026-11-25",
    nodeIds: [NODE_L7],
  });
  expect(e.daysRemaining).toBe(10);
  expect(e.coverage.map((c) => c.id)).toEqual([NODE_L7]);
  const l7 = e.progress.questionCount;
  expect(l7).toBeGreaterThan(10);
  const edited = await store.updateExam(e.id, { nodeIds: [NODE_L7, NODE_L8], title: "Midterm 1" });
  expect(edited.title).toBe("Midterm 1");
  expect(edited.coverage).toHaveLength(2);
  expect(edited.progress.questionCount).toBeGreaterThan(l7);
  const s = await store.startSession({
    scope: { kind: "exam", examId: e.id },
    formats: [...ALL],
    length: 10,
  });
  expect(s.total).toBe(10);
  expect(s.scopeLabel).toBe("Midterm 1");
  await store.skip(s.id, 0);
  const narrowed = await store.updateExam(e.id, { nodeIds: [NODE_L8] });
  expect(narrowed.coverage.map((c) => c.id)).toEqual([NODE_L8]);
  const prog = await store.examProgress(e.id);
  expect(prog.attempted).toBe(0);
  await store.deleteExam(e.id);
  expect(await store.listExams()).toHaveLength(0);
});

test("state persists through storage so a reload resumes", async () => {
  const mem = new Map<string, string>();
  const storage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  };
  const { createMockStore } = await import("../store/mock");
  const a = createMockStore({ storage, seed: 3 });
  const s = await a.startSession({
    scope: { kind: "all" },
    formats: ["multiple_choice"],
    length: 3,
  });
  const b = createMockStore({ storage, seed: 3 });
  expect((await b.getUnfinishedSession())?.id).toBe(s.id);
  expect((await b.getSession(s.id)).current?.questionId).toBe(s.current?.questionId);
});

test("buildAnswer right grades correct and wrong grades incorrect for every bank question", () => {
  const store = newStore();
  for (const q of store.bank) {
    if (q.type === "flashcard") continue;
    const seed = 11;
    expect(
      practice.grade(q, buildAnswer(q, seed, "right"), { variantSeed: seed }).correct,
      q.id,
    ).toBe(true);
    expect(
      practice.grade(q, buildAnswer(q, seed, "wrong"), { variantSeed: seed }).correct,
      q.id,
    ).toBe(false);
  }
});
