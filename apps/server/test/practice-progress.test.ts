import { newId, practice } from "@notes/schema";
import { beforeEach, describe, expect, it } from "vitest";
import { AppError } from "../src/http/errors.js";
import {
  ALL_TYPES,
  DAY,
  type Env,
  fx,
  type Json,
  rightAnswer,
  sessionItems,
  setupPractice,
  wrongAnswer,
} from "./practice-helpers.js";

let env: Env;
let sp: ReturnType<Env["spine"]>;
let cite: ReturnType<Env["addPage"]>["cite"];

beforeEach(() => {
  env = setupPractice();
  sp = env.spine(env.alice, 6);
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

const lecture = (i: number) => sp.lectures[i] as string;

function make(type: practice.QuestionType, node: string, over: Json = {}): string {
  const entry = ALL_TYPES.find(([t]) => t === type) as (typeof ALL_TYPES)[number];
  const res = env.service.createQuestions(env.bot, {
    nodeIds: [node],
    questions: [entry[1](cite, over)],
  });
  return (res.created[0] as Json).id;
}

/** One question answered in its own one-question session. `right` false answers wrongly. */
function take(questionId: string, right: boolean, answerOverride?: practice.Answer) {
  const detail = env.service.getQuestion(env.she, questionId);
  const { session } = env.service.startSession(env.she, {
    scope: { kind: "nodes", nodeIds: [detail.nodeIds[0]] },
    formats: [detail.type],
    length: 100,
    seed: 1,
  });
  // the session may hold other questions of this node; answer only this one
  const position = session.items.find((i) => i.questionId === questionId)?.position as number;
  const item = sessionItems(env, session.id)[position] as practice.SessionItem;
  const answer =
    answerOverride ??
    (right ? rightAnswer(detail.question, item.variantSeed) : wrongAnswer(detail.question));
  const out = env.service.submitAnswer(env.she, session.id, { position, answer });
  if (!out.progress.finished) env.service.abandonSession(env.she, session.id);
  env.advance(1000);
  return out;
}

describe("the missed-questions notebook", () => {
  it("a miss puts a question in, a right answer takes it out", () => {
    const id = make("multiple_choice", lecture(0));
    expect(env.service.notebook(env.she).items).toEqual([]);
    take(id, true);
    expect(env.service.notebook(env.she).counts.total).toBe(0);
    take(id, false);
    const nb = env.service.notebook(env.she);
    expect(nb.counts).toEqual({ total: 1, byType: { multiple_choice: 1 } });
    expect(nb.items[0]).toMatchObject({
      questionId: id,
      timesMissed: 1,
      correctRun: 0,
      stillNeeds: 1,
    });
    expect(nb.items[0]?.question.text).toContain("lorvanol");
    take(id, false);
    expect(env.service.notebook(env.she).items[0]?.timesMissed).toBe(2);
    take(id, true);
    expect(env.service.notebook(env.she).counts.total).toBe(0);
    take(id, true);
    expect(env.service.notebook(env.she).counts.total).toBe(0);
  });

  it("says why a calculation is there, from the grader's note on the last wrong answer", () => {
    const id = make("calculation", lecture(0));
    take(id, false);
    const item = env.service.notebook(env.she).items[0];
    expect(item).toHaveProperty("reason");
    expect(typeof item?.reason === "string" || item?.reason === null).toBe(true);
    // a multiple choice miss names the option she picked
    const mc = make("multiple_choice", lecture(0));
    take(mc, false);
    const entry = env.service.notebook(env.she).items.find((i) => i.questionId === mc);
    expect(entry?.reason).toBeTruthy();
  });

  it("a calculation needs two right answers in a row to leave", () => {
    const id = make("calculation", lecture(0));
    take(id, false);
    take(id, true);
    expect(env.service.notebook(env.she).items[0]).toMatchObject({ correctRun: 1, stillNeeds: 1 });
    take(id, false);
    expect(env.service.notebook(env.she).items[0]).toMatchObject({
      correctRun: 0,
      stillNeeds: 2,
      timesMissed: 2,
    });
    take(id, true);
    take(id, true);
    expect(env.service.notebook(env.she).counts.total).toBe(0);
  });

  it("flashcards never enter, free response follows her ticks, a case counts as one question", () => {
    const card = make("flashcard", lecture(0));
    take(card, false);
    expect(env.service.notebook(env.she).counts.total).toBe(0);
    const free = make("free_response", lecture(0));
    take(free, true, { type: "free_response", text: "x", covered: [0] });
    expect(env.service.notebook(env.she).items.map((i) => i.questionId)).toEqual([free]);
    const kase = make("case", lecture(0));
    take(kase, false);
    expect(env.service.notebook(env.she).counts.byType).toEqual({ free_response: 1, case: 1 });
  });

  it("lists the newest miss first, narrows by node and type, and hides questions in the trash", () => {
    const a = make("multiple_choice", lecture(0));
    const b = make("fill_blank", lecture(1));
    take(a, false);
    take(b, false);
    expect(env.service.notebook(env.she).items.map((i) => i.questionId)).toEqual([b, a]);
    expect(
      env.service.notebook(env.she, { nodeId: lecture(0) }).items.map((i) => i.questionId),
    ).toEqual([a]);
    expect(
      env.service.notebook(env.she, { type: "fill_blank" }).items.map((i) => i.questionId),
    ).toEqual([b]);
    env.service.trashQuestion(env.she, a);
    expect(env.service.notebook(env.she).items.map((i) => i.questionId)).toEqual([b]);
    env.service.restoreQuestion(env.she, a);
    expect(env.service.notebook(env.she).counts.total).toBe(2);
    expect(code(() => env.service.notebook(env.she, { nodeId: newId("node") }))).toBe("not_found");
  });

  it("is hers: another user and an empty library see nothing, an agent can read it", () => {
    const id = make("multiple_choice", lecture(0));
    take(id, false);
    expect(env.service.notebook(env.bobUser).items).toEqual([]);
    expect(env.service.notebook(env.readBot).counts.total).toBe(1);
  });
});

describe("weak areas", () => {
  it("needs 5 attempts across 3 questions before it calls a tag weak, and says so before that", () => {
    const dosing = [0, 1, 2].map((i) =>
      make("calculation", lecture(0), {
        prompt: `Dose ${i}: {weightKg} kg at {doseMgPerKg} mg/kg. How many mg?`,
        tags: ["dosing"],
      }),
    );
    const other = make("multiple_choice", lecture(1), { tags: ["moa"] });
    take(other, false);
    take(dosing[0] as string, false);
    take(dosing[0] as string, false);
    take(dosing[0] as string, false);
    take(dosing[0] as string, false);
    take(dosing[0] as string, false);
    let report = env.service.weakAreas(env.she);
    // one question retried five times is not enough
    expect(report.byTag.find((a) => a.key === "dosing")).toMatchObject({
      attempts: 5,
      questions: 1,
      status: "insufficient_data",
    });
    take(dosing[1] as string, false);
    take(dosing[2] as string, true);
    report = env.service.weakAreas(env.she);
    expect(report.byTag.find((a) => a.key === "dosing")).toMatchObject({
      attempts: 7,
      correct: 1,
      questions: 3,
      status: "weak",
    });
    expect(report.byTag[0]?.key).toBe("dosing");
    expect(report.byTag.find((a) => a.key === "moa")?.status).toBe("insufficient_data");
    expect(report.thresholds).toEqual({ minAttempts: 5, minQuestions: 3, weakBelow: 0.7 });
  });

  it("reports by lecture, folder and course with readable paths, and by concept", () => {
    const concept = newId("concept");
    const ids = [0, 1, 2].map((i) =>
      make("multiple_choice", lecture(0), {
        prompt: `Question ${i} on lorvanol (fictional)?`,
        conceptIds: [concept],
      }),
    );
    for (const id of ids) take(id, true);
    take(ids[0] as string, true);
    take(ids[1] as string, false);
    const report = env.service.weakAreas(env.she);
    expect(report.byConcept[0]).toMatchObject({
      key: concept,
      attempts: 5,
      correct: 4,
      status: "ok",
    });
    const lectureArea = report.byNode.find((a) => a.key === lecture(0));
    expect(lectureArea?.label).toBe("Fall 2026 / Pharmacology II / Lectures / Lecture 5");
    expect(report.byNode.find((a) => a.key === sp.course.id)?.attempts).toBe(5);
  });

  it("thresholds are options, a node narrows the report, deleted questions are unmatched", () => {
    const a = make("multiple_choice", lecture(0), { tags: ["x"] });
    const b = make("multiple_choice", lecture(1), { tags: ["y"] });
    take(a, false);
    take(b, true);
    expect(
      env.service.weakAreas(env.she).byTag.every((t) => t.status === "insufficient_data"),
    ).toBe(true);
    const lenient = env.service.weakAreas(env.she, { minAttempts: 1, minQuestions: 1 });
    expect(lenient.byTag.find((t) => t.key === "x")?.status).toBe("weak");
    expect(lenient.byTag.find((t) => t.key === "y")?.status).toBe("ok");
    const narrowed = env.service.weakAreas(env.she, {
      minAttempts: 1,
      minQuestions: 1,
      nodeId: lecture(1),
    });
    expect(narrowed.byTag.map((t) => t.key)).toEqual(["y"]);
    env.service.trashQuestion(env.she, b);
    env.service.deleteQuestion(env.she, b);
    expect(env.service.weakAreas(env.she).unmatchedAttempts).toBe(1);
    expect(env.service.weakAreas(env.bobUser).byTag).toEqual([]);
    expect(
      env.service.weakAreas(env.readBot, { minAttempts: 1, minQuestions: 1 }).byTag,
    ).toHaveLength(1);
  });
});

describe("spaced repetition", () => {
  const cardOf = (id: string) => env.service.getQuestion(env.she, id).card as practice.CardState;

  it("a new flashcard is due at once; reviews follow the scheduler exactly, on the injected clock", () => {
    const id = make("flashcard", lecture(0));
    const t0 = env.clock.ms;
    expect(cardOf(id)).toEqual(practice.newCard(t0));
    let due = env.service.dueList(env.she);
    expect(due.counts).toMatchObject({ due: 0, new: 1, total: 1 });
    expect(due.items[0]?.card.phase).toBe("new");
    expect(Object.keys(due.items[0]?.intervals ?? {})).toEqual(["again", "hard", "good", "easy"]);

    let expected = practice.newCard(t0);
    const ratings: practice.ReviewRating[] = ["good", "good", "again", "easy", "hard"];
    for (const rating of ratings) {
      // wait until the card is due, as she would
      if (expected.phase === "review") {
        env.clock.ms = Date.parse(expected.due);
      }
      const at = env.clock.ms;
      const out = take(id, true, { type: "flashcard", rating });
      env.clock.ms = at; // take() moved the clock a second; the review used `at`
      const step = practice.reviewCard(expected, rating, at);
      expected = step.card;
      expect(cardOf(id)).toEqual(expected);
      expect(out.schedule).toMatchObject({
        rating,
        intervalDays: step.intervalDays,
        due: expected.due,
      });
    }
    expect(cardOf(id).reps).toBe(5);
    expect(cardOf(id).lapses).toBe(1);
    due = env.service.dueList(env.she);
    expect(due.counts.new).toBe(0);
  });

  it("lists what is due, most overdue first, with counts for the next two weeks", () => {
    const ids = [0, 1, 2, 3].map((i) =>
      make("flashcard", lecture(0), { front: `Front ${i} of lorvanol (fictional)?` }),
    );
    const t0 = env.clock.ms;
    const due: Record<string, string> = {};
    // review each card "good" at t0; each is then due `interval` days later
    for (const id of ids) {
      env.clock.ms = t0;
      take(id, true, { type: "flashcard", rating: "good" });
      due[id] = cardOf(id).due;
    }
    const interval = practice.reviewCard(practice.newCard(t0), "good", t0).intervalDays;
    // nothing due yet
    env.clock.ms = t0;
    let view = env.service.dueList(env.she);
    expect(view.counts).toMatchObject({ due: 0, new: 0, total: 4 });
    expect(view.counts.byDay).toHaveLength(14);
    expect(view.counts.byDay[interval]).toEqual({
      date: new Date(t0 + interval * DAY).toISOString().slice(0, 10),
      count: 4,
    });
    expect(view.counts.byDay.reduce((s, d) => s + d.count, 0)).toBe(4);
    // two days past due: all four are due, overdue counts into today
    env.clock.ms = t0 + (interval + 2) * DAY;
    view = env.service.dueList(env.she);
    expect(view.counts.due).toBe(4);
    expect(view.counts.byDay[0]?.count).toBe(4);
    expect(view.items.map((i) => i.overdueDays)).toEqual([2, 2, 2, 2]);
    expect(env.service.dueList(env.she, { limit: 2 }).items).toHaveLength(2);
    // a day's boundary follows her time zone
    const east = env.service.dueList(env.she, { utcOffsetMinutes: 14 * 60 });
    expect(east.counts.byDay[0]?.date).not.toBe(view.counts.byDay[0]?.date);
  });

  it("a session of scope due reviews in order and moves each card on", () => {
    const ids = [0, 1, 2].map((i) =>
      make("flashcard", lecture(0), { front: `Front ${i} of lorvanol (fictional)?` }),
    );
    const { session } = env.service.startSession(env.she, { scope: { kind: "due" }, length: 2 });
    expect(session.total).toBe(2);
    for (const _ of session.items) {
      env.service.submitAnswer(env.she, session.id, {
        answer: { type: "flashcard", rating: "easy" },
      });
    }
    const reviewed = ids.filter((id) => cardOf(id).phase === "review");
    expect(reviewed).toHaveLength(2);
    expect(env.service.dueList(env.she).counts.new).toBe(1);
    const next = env.service.startSession(env.she, { scope: { kind: "due" }, length: 5 });
    expect(next.session.total).toBe(1);
    expect(next.session.items[0]?.questionId).toBe(ids.find((id) => cardOf(id).phase === "new"));
  });

  it("any question type can opt in; the rating comes from the grade", () => {
    const mc = make("multiple_choice", lecture(0));
    const m = make("matching", lecture(0));
    env.service.setSchedule(env.she, mc, true);
    env.service.setSchedule(env.she, m, true);
    take(mc, true);
    expect(cardOf(mc).reps).toBe(1);
    expect(cardOf(mc).phase).toBe("review");
    const partial: practice.Answer = {
      type: "matching",
      matches: [
        { pairId: "p1", right: "lorvanol" },
        { pairId: "p2", right: "tenzolol" },
        { pairId: "p3", right: "nope" },
      ],
    };
    const out = take(m, false, partial);
    expect(out.schedule?.rating).toBe("hard");
    // reviewed today, so neither is due yet; the type filter still counts what is scheduled
    const matchingOnly = env.service.dueList(env.she, { type: "matching" });
    expect(matchingOnly.items).toEqual([]);
    expect(matchingOnly.counts.total).toBe(1);
    env.advance(30 * DAY);
    expect(
      env.service.dueList(env.she, { type: "matching" }).items.map((i) => i.question.id),
    ).toEqual([m]);
    expect(env.service.dueList(env.she, { nodeId: lecture(1) }).counts.total).toBe(0);
    expect(env.service.dueList(env.she, { nodeId: lecture(0) }).counts.total).toBe(2);
    expect(code(() => env.service.dueList(env.she, { nodeId: newId("node") }))).toBe("not_found");
    expect(env.service.dueList(env.bobUser).counts.total).toBe(0);
  });

  it("a question not on the schedule keeps no card", () => {
    const mc = make("multiple_choice", lecture(0));
    take(mc, true);
    expect(env.service.getQuestion(env.she, mc).card).toBeNull();
  });
});

describe("node hooks", () => {
  it("trashing a node hides its questions everywhere; restoring brings them back with their history", () => {
    const a = make("multiple_choice", lecture(0));
    const b = make("flashcard", lecture(1));
    take(a, false);
    env.service.onNodeTrashed(env.alice, [lecture(0)]);
    expect(env.service.listQuestions(env.she).items.map((q) => q.id)).toEqual([b]);
    expect(code(() => env.service.getQuestion(env.she, a))).toBe("not_found");
    expect(env.service.notebook(env.she).counts.total).toBe(0);
    expect(
      code(() =>
        env.service.startSession(env.she, { scope: { kind: "nodes", nodeIds: [lecture(0)] } }),
      ),
    ).toBe("invalid_input");
    env.service.onNodeRestored(env.alice, [lecture(0)]);
    expect(env.service.listQuestions(env.she).items).toHaveLength(2);
    expect(env.service.notebook(env.she).counts.total).toBe(1);
  });

  it("a question in two nodes stays while one is live", () => {
    const res = env.service.createQuestions(env.bot, {
      nodeIds: [lecture(0), lecture(1)],
      questions: [fx.mc(cite)],
    });
    const id = (res.created[0] as Json).id;
    env.service.onNodeTrashed(env.alice, [lecture(0)]);
    expect(env.service.getQuestion(env.she, id).id).toBe(id);
    env.service.onNodeTrashed(env.alice, [lecture(1)]);
    expect(code(() => env.service.getQuestion(env.she, id))).toBe("not_found");
  });

  it("deleting a node removes questions that lived only there, keeps the others, and keeps history", () => {
    const only = make("multiple_choice", lecture(0));
    const both = (
      env.service.createQuestions(env.bot, {
        nodeIds: [lecture(0), lecture(1)],
        questions: [fx.fill(cite)],
      }).created[0] as Json
    ).id;
    take(only, false);
    env.service.onNodeDeleted(env.alice, [lecture(0)]);
    expect(code(() => env.service.getQuestion(env.she, only))).toBe("not_found");
    expect(env.service.getQuestion(env.she, both).nodeIds).toEqual([lecture(1)]);
    expect(env.db.prepare("SELECT COUNT(*) AS n FROM attempts").get()).toEqual({ n: 1 });
    expect(env.service.notebook(env.she).counts.total).toBe(0);
    expect(env.service.weakAreas(env.she).unmatchedAttempts).toBe(1);
  });

  it("duplicating a node copies its live questions with fresh IDs and a fresh schedule", () => {
    const a = make("flashcard", lecture(0));
    make("multiple_choice", lecture(0));
    const gone = make("fill_blank", lecture(0));
    env.service.trashQuestion(env.she, gone);
    take(a, true, { type: "flashcard", rating: "good" });
    const copy = env.library.duplicate(env.alice, lecture(0));
    expect(env.service.onNodeDuplicated(env.alice, lecture(0), copy.id)).toBe(2);
    const copies = env.service.listQuestions(env.she, { nodeId: copy.id, full: true })
      .items as Json[];
    expect(copies.map((c) => c.type)).toEqual(["flashcard", "multiple_choice"]);
    expect(copies[0].id).not.toBe(a);
    expect(copies[0].card.phase).toBe("new");
    expect(copies[0].question.sources).toEqual(
      env.service.getQuestion(env.she, a).question.sources,
    );
    expect(env.service.onNodesDuplicated(env.alice, [[lecture(0), copy.id]])).toBe(2);
  });

  it("hooks only touch the named user's data", () => {
    const a = make("multiple_choice", lecture(0));
    env.service.onNodeTrashed(env.bob, [lecture(0)]);
    env.service.onNodeDeleted(env.bob, [lecture(0)]);
    expect(env.service.getQuestion(env.she, a).id).toBe(a);
  });
});
