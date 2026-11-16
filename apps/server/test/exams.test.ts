import { newId, type practice } from "@notes/schema";
import { beforeEach, describe, expect, it } from "vitest";
import { AppError } from "../src/http/errors.js";
import {
  ALL_TYPES,
  DAY,
  type Env,
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
  sp = env.spine(env.alice, 5);
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

const lec = (i: number) => sp.lectures[i] as string;
const exam = (over: Json = {}) =>
  env.exams.createExam(env.she, {
    courseId: sp.course.id,
    title: "Exam 2",
    date: "2026-12-14",
    nodeIds: [lec(0), lec(1)],
    ...over,
  });

function make(type: practice.QuestionType, node: string, over: Json = {}): string {
  const entry = ALL_TYPES.find(([t]) => t === type) as (typeof ALL_TYPES)[number];
  const res = env.service.createQuestions(env.bot, {
    nodeIds: [node],
    questions: [entry[1](cite, over)],
  });
  return (res.created[0] as Json).id;
}

function take(questionId: string, right: boolean) {
  const detail = env.service.getQuestion(env.she, questionId);
  const { session } = env.service.startSession(env.she, {
    scope: { kind: "nodes", nodeIds: [detail.nodeIds[0]] },
    formats: [detail.type],
    length: 100,
    seed: 3,
  });
  const position = session.items.find((i) => i.questionId === questionId)?.position as number;
  const item = sessionItems(env, session.id)[position] as practice.SessionItem;
  const answer = right
    ? rightAnswer(detail.question, item.variantSeed)
    : wrongAnswer(detail.question);
  const out = env.service.submitAnswer(env.she, session.id, { position, answer });
  if (!out.progress.finished) env.service.abandonSession(env.she, session.id);
  env.advance(1000);
}

describe("creating and reading exams", () => {
  it("an exam belongs to a course, has a date, and covers nodes inside it", () => {
    const e = exam({ notes: "Chapters 5 to 6" });
    expect(e).toMatchObject({
      title: "Exam 2",
      date: "2026-12-14",
      courseId: sp.course.id,
      courseName: "Pharmacology II",
      notes: "Chapters 5 to 6",
    });
    expect(e.nodeIds).toEqual([lec(0), lec(1)]);
    expect(e.coverage[0]).toEqual({
      nodeId: lec(0),
      name: "Lecture 5",
      path: "Fall 2026 / Pharmacology II / Lectures / Lecture 5",
    });
    expect(e.createdBy.type).toBe("user");
    expect(e.daysRemaining).toBe(29);
    expect(env.exams.getExam(env.bot, e.id).id).toBe(e.id);
  });

  it("an agent can create and change exams (M4), and the exam records who", () => {
    const e = env.exams.createExam(env.bot, {
      courseId: sp.course.id,
      title: "Midterm",
      date: "2026-11-30",
    });
    expect(e.createdBy.type).toBe("agent");
    expect(e.nodeIds).toEqual([]);
    const changed = env.exams.updateExam(env.bot, e.id, { nodeIds: [lec(2)], date: "2026-12-01" });
    expect(changed).toMatchObject({ date: "2026-12-01", nodeIds: [lec(2)], title: "Midterm" });
  });

  it("may cover a folder or a whole section of the course", () => {
    const e = exam({ nodeIds: [sp.sec.lectures] });
    expect(e.nodeIds).toEqual([sp.sec.lectures]);
  });

  it("refuses coverage outside the course, in the trash, or that is not hers", () => {
    const other = env.spine(env.alice, 1);
    expect(code(() => exam({ nodeIds: [other.lectures[0]] }))).toBe("invalid_input");
    expect(code(() => exam({ nodeIds: [sp.course.id] }))).toBe("invalid_input");
    expect(code(() => exam({ nodeIds: [newId("node")] }))).toBe("not_found");
    expect(code(() => exam({ nodeIds: [env.spine(env.bob, 1).lectures[0]] }))).toBe("not_found");
    env.library.trash(env.alice, lec(2));
    expect(code(() => exam({ nodeIds: [lec(2)] }))).toBe("invalid_input");
    expect(code(() => exam({ courseId: lec(0) }))).toBe("invalid_input");
    expect(code(() => exam({ courseId: other.term.id }))).toBe("invalid_input");
    expect(code(() => exam({ courseId: env.spine(env.bob, 1).course.id }))).toBe("not_found");
    expect(code(() => exam({ courseId: newId("node") }))).toBe("not_found");
    expect(code(() => exam({ date: "next week" }))).toBe("invalid_input");
    expect(code(() => exam({ title: "  " }))).toBe("invalid_input");
    expect(code(() => exam({ extra: 1 }))).toBe("invalid_input");
  });

  it("update changes only what is sent, and re-checks coverage against the exam's own course", () => {
    const e = exam();
    const other = env.spine(env.alice, 1);
    expect(code(() => env.exams.updateExam(env.she, e.id, { nodeIds: [other.lectures[0]] }))).toBe(
      "invalid_input",
    );
    expect(code(() => env.exams.updateExam(env.she, e.id, {}))).toBe("invalid_input");
    const u = env.exams.updateExam(env.she, e.id, { title: "Exam 2 (moved)" });
    expect(u).toMatchObject({ title: "Exam 2 (moved)", date: "2026-12-14" });
    expect(u.nodeIds).toEqual([lec(0), lec(1)]);
    expect(env.exams.updateExam(env.she, e.id, { nodeIds: [] }).nodeIds).toEqual([]);
  });

  it("lists by date with filters and paging", () => {
    const other = env.spine(env.alice, 1);
    const a = exam({ title: "A", date: "2026-12-20" });
    const b = exam({ title: "B", date: "2026-11-20" });
    const c = env.exams.createExam(env.she, {
      courseId: other.course.id,
      title: "C",
      date: "2026-12-01",
    });
    expect(env.exams.listExams(env.she).items.map((x) => x.title)).toEqual(["B", "C", "A"]);
    expect(
      env.exams.listExams(env.she, { courseId: other.course.id }).items.map((x) => x.id),
    ).toEqual([c.id]);
    expect(env.exams.listExams(env.she, { from: "2026-12-01" }).items.map((x) => x.title)).toEqual([
      "C",
      "A",
    ]);
    expect(env.exams.listExams(env.she, { to: "2026-11-30" }).items.map((x) => x.id)).toEqual([
      b.id,
    ]);
    const p1 = env.exams.listExams(env.she, { limit: 2 });
    expect(p1.items.map((x) => x.title)).toEqual(["B", "C"]);
    const p2 = env.exams.listExams(env.she, { limit: 2, cursor: p1.nextCursor as string });
    expect(p2.items.map((x) => x.id)).toEqual([a.id]);
    expect(p2.nextCursor).toBeNull();
    expect(code(() => env.exams.listExams(env.she, { cursor: "zz" }))).toBe("invalid_input");
    expect(env.exams.listExams(env.readBot).items).toHaveLength(3);
  });

  it("delete needs her browser session and removes only the exam", () => {
    const e = exam();
    const q = make("multiple_choice", lec(0));
    expect(code(() => env.exams.deleteExam(env.bot, e.id))).toBe("forbidden");
    expect(code(() => env.exams.deleteExam(env.readBot, e.id))).toBe("read_only_key");
    env.exams.deleteExam(env.she, e.id);
    expect(code(() => env.exams.getExam(env.she, e.id))).toBe("not_found");
    expect(code(() => env.exams.deleteExam(env.she, e.id))).toBe("not_found");
    expect(env.service.getQuestion(env.she, q).examIds).toEqual([]);
  });

  it("is hers: another user and a read-only key are refused", () => {
    const e = exam();
    expect(code(() => env.exams.getExam(env.bobUser, e.id))).toBe("not_found");
    expect(code(() => env.exams.updateExam(env.bobUser, e.id, { title: "x" }))).toBe("not_found");
    expect(code(() => env.exams.deleteExam(env.bobUser, e.id))).toBe("not_found");
    expect(env.exams.listExams(env.bobUser).items).toEqual([]);
    expect(env.exams.upcoming(env.bobUser).items).toEqual([]);
    expect(
      code(() =>
        env.exams.createExam(env.readBot, {
          courseId: sp.course.id,
          title: "x",
          date: "2026-12-01",
        }),
      ),
    ).toBe("read_only_key");
    expect(code(() => env.exams.updateExam(env.readBot, e.id, { title: "x" }))).toBe(
      "read_only_key",
    );
  });
});

describe("progress and the home screen", () => {
  it("counts covered questions, what she has attempted, accuracy, due cards and the notebook", () => {
    const e = exam();
    const a = make("multiple_choice", lec(0));
    const b = make("fill_blank", lec(1));
    const c = make("matching", lec(1));
    const card = make("flashcard", lec(0));
    make("multiple_choice", lec(2)); // not covered
    let p = env.exams.getExam(env.she, e.id).progress;
    expect(p).toEqual({
      questions: 4,
      attempted: 0,
      attempts: 0,
      correct: 0,
      dueCards: 0,
      newCards: 1,
      notebook: 0,
      attemptedShare: 0,
      accuracy: null,
    });
    take(a, true);
    take(b, false);
    take(b, false);
    take(card, true);
    p = env.exams.getExam(env.she, e.id).progress;
    expect(p).toMatchObject({
      questions: 4,
      attempted: 3,
      attempts: 4,
      correct: 2,
      newCards: 0,
      notebook: 1,
    });
    expect(p.attemptedShare).toBeCloseTo(0.75);
    expect(p.accuracy).toBeCloseTo(0.5);
    // attempts on questions outside the exam do not count
    take(env.service.listQuestions(env.she, { nodeId: lec(2) }).items[0]?.id as string, false);
    expect(env.exams.getExam(env.she, e.id).progress.attempts).toBe(4);
    // a day later the reviewed card is not due; weeks later it is
    expect(env.exams.getExam(env.she, e.id).progress.dueCards).toBe(0);
    env.advance(60 * DAY);
    expect(env.exams.getExam(env.she, e.id).progress.dueCards).toBe(1);
    expect(c).toBeTruthy();
  });

  it("a question trashed or an exam with no coverage gives honest zeros", () => {
    const e = exam({ nodeIds: [] });
    expect(env.exams.getExam(env.she, e.id).progress).toMatchObject({
      questions: 0,
      attemptedShare: null,
      accuracy: null,
    });
    const full = exam();
    const q = make("multiple_choice", lec(0));
    env.service.trashQuestion(env.she, q);
    expect(env.exams.getExam(env.she, full.id).progress.questions).toBe(0);
  });

  it("upcoming: from today on, soonest first, with the countdown", () => {
    exam({ title: "Past", date: "2026-11-01" });
    const today = exam({ title: "Today", date: "2026-11-15" });
    exam({ title: "Later", date: "2027-01-20" });
    exam({ title: "Soon", date: "2026-11-18" });
    const up = env.exams.upcoming(env.she);
    expect(up.items.map((x) => [x.title, x.daysRemaining])).toEqual([
      ["Today", 0],
      ["Soon", 3],
      ["Later", 66],
    ]);
    expect(up.items[0]?.id).toBe(today.id);
    expect(env.exams.upcoming(env.she, { limit: 2 }).items).toHaveLength(2);
    expect(env.exams.upcoming(env.she, { withinDays: 10 }).items.map((x) => x.title)).toEqual([
      "Today",
      "Soon",
    ]);
    env.advance(DAY * 4);
    expect(env.exams.upcoming(env.she).items.map((x) => x.title)).toEqual(["Later"]);
    // now is 19 Nov 12:00 UTC; 14 hours east it is already 20 Nov, so one day closer
    expect(env.exams.upcoming(env.she).items[0]?.daysRemaining).toBe(62);
    expect(env.exams.upcoming(env.she, { utcOffsetMinutes: 14 * 60 }).items[0]?.daysRemaining).toBe(
      61,
    );
    expect(env.exams.upcoming(env.readBot).items).toHaveLength(1);
  });
});

describe("exams as a scope", () => {
  it("scopes sessions, the missed notebook and the due deck to the exam's material", () => {
    const e = exam({ nodeIds: [lec(0)] });
    const inside = make("multiple_choice", lec(0));
    const outside = make("multiple_choice", lec(1));
    const insideCard = make("flashcard", lec(0));
    make("flashcard", lec(1));
    take(inside, false);
    take(outside, false);
    expect(env.service.getQuestion(env.she, inside).examIds).toEqual([e.id]);
    expect(env.service.getQuestion(env.she, outside).examIds).toEqual([]);
    const missed = env.service.startSession(env.she, { scope: { kind: "missed", examId: e.id } });
    expect(missed.session.items.map((i) => i.questionId)).toEqual([inside]);
    const deck = env.service.dueList(env.she, { examId: e.id });
    expect(deck.counts.total).toBe(1);
    expect(deck.items[0]?.question.id).toBe(insideCard);
    const due = env.service.startSession(env.she, { scope: { kind: "due", examId: e.id } });
    expect(due.session.items.map((i) => i.questionId)).toEqual([insideCard]);
    expect(env.service.listQuestions(env.she, { examId: e.id }).items).toHaveLength(2);
  });

  it("covering a folder covers the questions in every lecture inside it", () => {
    const folder = env.library.create(env.alice, {
      parentId: sp.sec.lectures as string,
      kind: "folder",
      name: "Week 3",
    });
    const deep = env.library.create(env.alice, {
      parentId: folder.id,
      kind: "lecture",
      name: "Lecture 9",
    });
    const q = make("multiple_choice", deep.id);
    const e = exam({ nodeIds: [folder.id] });
    expect(env.service.getQuestion(env.she, q).examIds).toEqual([e.id]);
    expect(env.exams.getExam(env.she, e.id).progress.questions).toBe(1);
  });
});

describe("node hooks", () => {
  it("trashing the course hides its exams, restoring returns them", () => {
    const e = exam();
    env.exams.onNodeTrashed(env.alice, [sp.course.id, lec(0)]);
    expect(code(() => env.exams.getExam(env.she, e.id))).toBe("not_found");
    expect(env.exams.listExams(env.she).items).toEqual([]);
    expect(env.exams.upcoming(env.she).items).toEqual([]);
    const q = make("multiple_choice", lec(0));
    expect(env.service.getQuestion(env.she, q).examIds).toEqual([]);
    env.exams.onNodeRestored(env.alice, [sp.course.id, lec(0)]);
    expect(env.exams.getExam(env.she, e.id).id).toBe(e.id);
  });

  it("deleting a node drops it from coverage; deleting the course deletes its exams", () => {
    const e = exam();
    env.exams.onNodeDeleted(env.alice, [lec(0)]);
    expect(env.exams.getExam(env.she, e.id).nodeIds).toEqual([lec(1)]);
    env.exams.onNodeDeleted(env.alice, [sp.course.id]);
    expect(code(() => env.exams.getExam(env.she, e.id))).toBe("not_found");
    expect(env.db.prepare("SELECT COUNT(*) AS n FROM exams").get()).toEqual({ n: 0 });
  });

  it("duplicating a course copies its exams onto the copy, with coverage mapped", () => {
    exam();
    const copy = env.spine(env.alice, 2);
    const n = env.exams.onNodeDuplicated(env.alice, sp.course.id, copy.course.id, {
      [lec(0)]: copy.lectures[0] as string,
    });
    expect(n).toBe(1);
    const copied = env.exams.listExams(env.she, { courseId: copy.course.id }).items;
    expect(copied).toHaveLength(1);
    expect(copied[0]?.nodeIds).toEqual([copy.lectures[0]]);
  });

  it("hooks touch only the named user's exams", () => {
    const e = exam();
    env.exams.onNodeTrashed(env.bob, [sp.course.id]);
    env.exams.onNodeDeleted(env.bob, [sp.course.id]);
    expect(env.exams.getExam(env.she, e.id).id).toBe(e.id);
  });
});
