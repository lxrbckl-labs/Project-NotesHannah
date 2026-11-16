import { newId, practice } from "@notes/schema";
import { beforeEach, describe, expect, it } from "vitest";
import { AppError } from "../src/http/errors.js";
import { ALL_TYPES, type Env, fx, type Json, setupPractice } from "./practice-helpers.js";

let env: Env;
let lec: string[];
let sp: ReturnType<Env["spine"]>;
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

describe("authoring every question type", () => {
  for (const [type, make] of ALL_TYPES) {
    it(`stores a ${type} with provenance and returns it whole`, () => {
      const res = env.service.createQuestions(env.bot, {
        nodeIds: [lec[0]],
        questions: [make(cite)],
      });
      expect(res.stored).toBe(1);
      expect(res.problems).toEqual([]);
      const summary = res.created[0] as Json;
      expect(summary.type).toBe(type);
      expect(summary.author.type).toBe("agent");
      expect(summary.review).toBe("unverified");
      expect(summary.nodeIds).toEqual([lec[0]]);
      expect(summary.scheduled).toBe(type === "flashcard");

      const detail = env.service.getQuestion(env.she, summary.id);
      expect(practice.Question.safeParse(detail.question).success).toBe(true);
      expect(detail.question.sources[0]?.quote).toBe(cite.quote);
      expect(detail.stats.attempts).toBe(0);
    });
  }

  it("fills in option and pair ids and tidies tags", () => {
    const input = fx.mc(cite, { tags: ["Beta-Blockers", "beta-blockers "] }) as Json;
    for (const o of input.options) delete o.id;
    const res = env.service.createQuestions(env.bot, { nodeIds: [lec[0]], questions: [input] });
    const stored = env.service.getQuestion(env.she, (res.created[0] as Json).id).question as Json;
    expect(stored.options.map((o: Json) => o.id)).toEqual(["o1", "o2", "o3"]);
    expect(stored.tags).toEqual(["beta-blockers"]);
  });

  it("marks her own questions reviewed and an agent's unverified", () => {
    const mine = env.service.createQuestions(env.she, {
      nodeIds: [lec[0]],
      questions: [fx.mc(cite)],
    });
    expect((mine.created[0] as Json).review).toBe("reviewed");
    expect((mine.created[0] as Json).author).toEqual({ type: "user", userId: env.alice });
  });
});

describe("bulk create", () => {
  const bad = (c: typeof cite) => fx.mc(c, { options: [{ text: "only one", correct: true }] });
  const noKey = (c: typeof cite) => fx.mc(c, { options: [{ text: "a" }, { text: "b" }] });

  it("is atomic by default: one bad question stores nothing and names every problem", () => {
    let err: AppError | undefined;
    try {
      env.service.createQuestions(env.bot, {
        nodeIds: [lec[0]],
        questions: [fx.mc(cite), bad(cite), fx.fill(cite), noKey(cite)],
      });
    } catch (e) {
      err = e as AppError;
    }
    expect(err?.code).toBe("invalid_input");
    expect(err?.message).toContain("2 of 4 questions have problems; nothing was stored");
    expect(err?.hint).toContain("questions[1] $.options");
    expect(err?.hint).toContain("questions[3]");
    expect(err?.example).toBeTypeOf("object");
    expect(env.service.listQuestions(env.she).items).toHaveLength(0);
  });

  it("partial: true stores the valid ones and reports the rest with path, message and example", () => {
    const res = env.service.createQuestions(env.bot, {
      nodeIds: [lec[0]],
      partial: true,
      questions: [fx.mc(cite), bad(cite), fx.fill(cite), noKey(cite)],
    });
    expect(res.stored).toBe(2);
    expect(res.created.map((c) => c.type)).toEqual(["multiple_choice", "fill_blank"]);
    expect(res.problems.map((p) => p.index)).toEqual([1, 3]);
    for (const p of res.problems) {
      for (const problem of p.problems) {
        expect(problem.path.startsWith("$")).toBe(true);
        expect(problem.message.length).toBeGreaterThan(5);
        expect(problem.example).toBeTypeOf("object");
      }
    }
    expect(env.service.listQuestions(env.she).items).toHaveLength(2);
  });

  it("validate reports the same per-item problems without storing", () => {
    const res = env.service.validateQuestions(env.bot, [fx.mc(cite), bad(cite)]);
    expect(res.valid).toBe(1);
    expect(res.problems[0]?.index).toBe(1);
    expect(env.service.listQuestions(env.she).items).toHaveLength(0);
  });

  it("refuses an empty batch, a batch over 100 and unknown fields", () => {
    expect(
      code(() => env.service.createQuestions(env.bot, { nodeIds: [lec[0]], questions: [] })),
    ).toBe("invalid_input");
    expect(
      code(() =>
        env.service.createQuestions(env.bot, {
          nodeIds: [lec[0]],
          questions: Array.from({ length: 101 }, () => fx.mc(cite)),
        }),
      ),
    ).toBe("invalid_input");
    expect(
      code(() =>
        env.service.createQuestions(env.bot, { nodeIds: [lec[0]], questions: [fx.mc(cite)], x: 1 }),
      ),
    ).toBe("invalid_input");
  });
});

describe("the citation rule", () => {
  it("refuses a question with no citation and not marked general knowledge", () => {
    expect(
      code(() =>
        env.service.createQuestions(env.bot, {
          nodeIds: [lec[0]],
          questions: [fx.mc(cite, { sources: [] })],
        }),
      ),
    ).toBe("invalid_input");
  });

  it("accepts generalKnowledge: true and refuses it together with sources", () => {
    const ok = env.service.createQuestions(env.bot, {
      nodeIds: [lec[0]],
      questions: [fx.mc(cite, { sources: [], generalKnowledge: true })],
    });
    expect((ok.created[0] as Json).generalKnowledge).toBe(true);
    expect(
      code(() =>
        env.service.createQuestions(env.bot, {
          nodeIds: [lec[0]],
          questions: [fx.mc(cite, { generalKnowledge: true })],
        }),
      ),
    ).toBe("invalid_input");
  });

  it("refuses a citation to a page that is not hers, a trashed file, or an invented quote", () => {
    const other = env.addPage(env.bob);
    const invented = { ...cite, quote: "Lorvanol cures hair loss." };
    for (const c of [other.cite, invented]) {
      expect(
        code(() =>
          env.service.createQuestions(env.bot, { nodeIds: [lec[0]], questions: [fx.mc(c)] }),
        ),
      ).toBe("invalid_input");
    }
    env.sources.trash(cite.fileId);
    expect(
      code(() =>
        env.service.createQuestions(env.bot, { nodeIds: [lec[0]], questions: [fx.mc(cite)] }),
      ),
    ).toBe("invalid_input");
  });
});

describe("filing under library nodes", () => {
  it("needs a live lecture, folder, document or practice section she owns", () => {
    const { sec, course, term } = sp;
    const folder = env.library.create(env.alice, {
      parentId: sec.practice as string,
      kind: "folder",
      name: "Quiz 1",
    });
    for (const ok of [folder.id, sec.practice as string]) {
      expect(
        env.service.createQuestions(env.bot, { nodeIds: [ok], questions: [fx.mc(cite)] }).stored,
      ).toBe(1);
    }
    for (const wrong of [course.id, term.id, sec.sources as string]) {
      expect(
        code(() =>
          env.service.createQuestions(env.bot, { nodeIds: [wrong], questions: [fx.mc(cite)] }),
        ),
      ).toBe("invalid_input");
    }
    const bobNode = env.spine(env.bob).lectures[0] as string;
    expect(
      code(() =>
        env.service.createQuestions(env.bot, { nodeIds: [bobNode], questions: [fx.mc(cite)] }),
      ),
    ).toBe("not_found");
    expect(
      code(() =>
        env.service.createQuestions(env.bot, {
          nodeIds: [newId("node")],
          questions: [fx.mc(cite)],
        }),
      ),
    ).toBe("not_found");
    env.library.trash(env.alice, lec[1] as string);
    expect(
      code(() =>
        env.service.createQuestions(env.bot, { nodeIds: [lec[1]], questions: [fx.mc(cite)] }),
      ),
    ).toBe("invalid_input");
  });

  it("allows one question in several nodes", () => {
    const res = env.service.createQuestions(env.bot, {
      nodeIds: [lec[0], lec[1]],
      questions: [fx.mc(cite)],
    });
    expect((res.created[0] as Json).nodeIds.sort()).toEqual([lec[0], lec[1]].sort());
  });
});

describe("listing", () => {
  let folder: string;
  beforeEach(() => {
    const { sec } = sp;
    folder = env.library.create(env.alice, {
      parentId: sec.lectures as string,
      kind: "folder",
      name: "Week 3",
    }).id;
    const inFolder = env.library.create(env.alice, {
      parentId: folder,
      kind: "lecture",
      name: "Lecture 9",
    }).id;
    const make = (nodes: string[], q: unknown[]) =>
      env.service.createQuestions(env.bot, { nodeIds: nodes, questions: q });
    make([lec[0] as string], [fx.mc(cite), fx.fill(cite, { tags: ["alpha"] })]);
    make(
      [lec[1] as string],
      [fx.matching(cite), fx.calc(cite, { difficulty: 3, conceptIds: [newId("concept")] })],
    );
    make([inFolder], [fx.flash(cite), fx.case(cite)]);
    env.service.createQuestions(env.she, {
      nodeIds: [lec[2] as string],
      questions: [fx.free(cite)],
    });
  });

  const list = (f: Json = {}) => env.service.listQuestions(env.she, f).items as Json[];

  it("lists everything in creation order", () => {
    expect(list().map((q) => q.type)).toEqual([
      "multiple_choice",
      "fill_blank",
      "matching",
      "calculation",
      "flashcard",
      "case",
      "free_response",
    ]);
  });

  it("filters by node and includes its descendants", () => {
    expect(list({ nodeId: lec[0] })).toHaveLength(2);
    expect(list({ nodeId: folder }).map((q) => q.type)).toEqual(["flashcard", "case"]);
    const course = env.service.listQuestions(env.she, { nodeId: sp.course.id }).items;
    expect(course).toHaveLength(7);
  });

  it("filters by type, tag, concept, difficulty, review status and author", () => {
    expect(list({ type: "matching" })).toHaveLength(1);
    expect(list({ tag: "alpha" }).map((q) => q.type)).toEqual(["fill_blank"]);
    expect(list({ tag: "ALPHA" })).toHaveLength(1);
    const concept = list({ type: "calculation" })[0].conceptIds[0];
    expect(list({ conceptId: concept }).map((q) => q.type)).toEqual(["calculation"]);
    expect(list({ difficulty: 3 })).toHaveLength(1);
    expect(list({ review: "reviewed" }).map((q) => q.type)).toEqual(["free_response"]);
    expect(list({ review: "unverified" })).toHaveLength(6);
    expect(list({ author: "user" })).toHaveLength(1);
    expect(list({ nodeId: lec[0], type: "fill_blank", tag: "alpha" })).toHaveLength(1);
    expect(list({ nodeId: lec[1], tag: "alpha" })).toHaveLength(0);
  });

  it("filters by exam coverage", () => {
    const exam = env.exams.createExam(env.she, {
      courseId: sp.course.id,
      title: "Exam 2",
      date: "2026-12-14",
      nodeIds: [lec[0]],
    });
    expect(list({ examId: exam.id })).toHaveLength(2);
    expect(code(() => env.service.listQuestions(env.she, { examId: newId("exam") }))).toBe(
      "not_found",
    );
  });

  it("pages with a cursor", () => {
    const first = env.service.listQuestions(env.she, { limit: 3 });
    expect(first.items).toHaveLength(3);
    expect(first.nextCursor).toBeTypeOf("string");
    const second = env.service.listQuestions(env.she, {
      limit: 3,
      cursor: first.nextCursor as string,
    });
    const third = env.service.listQuestions(env.she, {
      limit: 3,
      cursor: second.nextCursor as string,
    });
    expect(third.nextCursor).toBeNull();
    const ids = [...first.items, ...second.items, ...third.items].map((q) => q.id);
    expect(new Set(ids).size).toBe(7);
    expect(code(() => env.service.listQuestions(env.she, { cursor: "!!" }))).toBe("invalid_input");
  });

  it("full: true returns each question's content", () => {
    const items = env.service.listQuestions(env.she, { full: true, limit: 2 }).items as Json[];
    expect(items[0].question.type).toBe("multiple_choice");
  });

  it("an unknown node is not_found", () => {
    expect(code(() => env.service.listQuestions(env.she, { nodeId: newId("node") }))).toBe(
      "not_found",
    );
  });
});

describe("changing questions", () => {
  let id: string;
  beforeEach(() => {
    id = (
      env.service.createQuestions(env.bot, { nodeIds: [lec[0]], questions: [fx.mc(cite)] })
        .created[0] as Json
    ).id;
  });

  it("an agent can rewrite its own unreviewed question; it stays the agent's and unverified", () => {
    const out = env.service.updateQuestion(env.bot, id, {
      question: fx.mc(cite, { prompt: "Which finding is expected with lorvanol (fictional)?" }),
    });
    expect(out.text).toContain("Which finding");
    expect(out.review).toBe("unverified");
    expect(out.createdAt).toBeTruthy();
  });

  it("refuses a rewrite that changes the type", () => {
    expect(code(() => env.service.updateQuestion(env.bot, id, { question: fx.fill(cite) }))).toBe(
      "invalid_input",
    );
  });

  it("an agent cannot rewrite a question she reviewed, but can move it", () => {
    env.service.setReview(env.she, [id], "reviewed");
    expect(code(() => env.service.updateQuestion(env.bot, id, { question: fx.mc(cite) }))).toBe(
      "forbidden",
    );
    const moved = env.service.updateQuestion(env.bot, id, { nodeIds: [lec[1] as string] });
    expect(moved.nodeIds).toEqual([lec[1]]);
    expect(moved.review).toBe("reviewed");
  });

  it("she can rewrite anything; her edit makes it hers and reviewed", () => {
    env.service.setReview(env.she, [id], "reviewed");
    const out = env.service.updateQuestion(env.she, id, {
      question: fx.mc(cite, { prompt: "New wording of the lorvanol (fictional) question?" }),
    });
    expect(out.author.type).toBe("user");
    expect(out.review).toBe("reviewed");
  });

  it("only her session marks reviewed; agents are refused", () => {
    expect(code(() => env.service.setReview(env.bot, [id], "reviewed"))).toBe("forbidden");
    expect(code(() => env.service.setReview(env.readBot, [id], "reviewed"))).toBe("read_only_key");
    expect(env.service.setReview(env.she, [id], "reviewed").changed).toBe(1);
    expect(env.service.setReview(env.she, [id], "reviewed").changed).toBe(0);
    expect(env.service.getQuestion(env.bot, id).question.review).toBe("reviewed");
    expect(env.service.setReview(env.she, [id], "unverified").changed).toBe(1);
  });

  it("trash hides it, restore brings it back, delete for good needs the trash and her session", () => {
    env.service.trashQuestion(env.bot, id);
    expect(env.service.listQuestions(env.she).items).toHaveLength(0);
    expect((env.service.listQuestions(env.she, { trashed: true }).items as Json[])[0].id).toBe(id);
    expect(code(() => env.service.trashQuestion(env.bot, id))).toBe("conflict");
    expect(code(() => env.service.deleteQuestion(env.bot, id))).toBe("forbidden");
    env.service.restoreQuestion(env.bot, id);
    expect(env.service.listQuestions(env.she).items).toHaveLength(1);
    expect(code(() => env.service.restoreQuestion(env.bot, id))).toBe("conflict");
    expect(code(() => env.service.deleteQuestion(env.she, id))).toBe("conflict");
    env.service.trashQuestion(env.she, id);
    env.service.deleteQuestion(env.she, id);
    expect(code(() => env.service.getQuestion(env.she, id))).toBe("not_found");
  });

  it("opting a question into the schedule, and out again", () => {
    expect(env.service.setSchedule(env.she, id, true).card?.phase).toBe("new");
    expect(env.service.setSchedule(env.she, id, false).card).toBeNull();
    const card = (
      env.service.createQuestions(env.bot, { nodeIds: [lec[0]], questions: [fx.flash(cite)] })
        .created[0] as Json
    ).id;
    expect(code(() => env.service.setSchedule(env.she, card, false))).toBe("conflict");
  });
});

describe("what cites a page", () => {
  it("lists questions that cite a page or any page of its file, with the trashed ones marked", () => {
    const a = env.service.createQuestions(env.bot, {
      nodeIds: [lec[0]],
      questions: [fx.mc(cite), fx.fill(cite)],
    });
    env.service.trashQuestion(env.she, (a.created[1] as Json).id);
    const byPage = env.service.citedBy(env.she, { pageId: cite.pageId });
    expect(byPage.items.map((i) => i.itemType)).toEqual(["question", "question"]);
    expect(byPage.items.map((i) => i.trashed)).toEqual([false, true]);
    expect(env.service.citedBy(env.she, { fileId: cite.fileId }).items).toHaveLength(2);
    expect(env.service.citedBy(env.bobUser, { pageId: cite.pageId }).items).toHaveLength(0);
  });
});

describe("the narrow port for the MCP layer", () => {
  it("authors, reads, and reaches results, weak areas, the notebook and exams, without a way to take a session", () => {
    const sp2 = sp;
    const made = env.port.createQuestions(env.bot, { nodeIds: [lec[0]], questions: [fx.mc(cite)] });
    expect(made.stored).toBe(1);
    const id = (made.created[0] as Json).id;
    expect(env.port.getQuestion(env.readBot, id).id).toBe(id);
    expect(env.port.listQuestions(env.readBot).items).toHaveLength(1);
    expect(env.port.validateQuestions(env.readBot, [{ type: "x" }]).valid).toBe(0);
    const exam = env.exams.createExam(env.bot, {
      courseId: sp2.course.id,
      title: "E",
      date: "2026-12-14",
    });
    expect(env.port.getExam(env.readBot, exam.id).id).toBe(exam.id);
    expect(env.port.listExams(env.readBot).items).toHaveLength(1);
    expect(env.port.upcoming(env.readBot).items).toHaveLength(1);
    expect(env.port.notebook(env.readBot).counts.total).toBe(0);
    expect(env.port.weakAreas(env.readBot).byTag).toEqual([]);
    expect(env.port.dueList(env.readBot).counts.total).toBe(0);
    expect(env.port.listSessions(env.readBot).items).toEqual([]);
    expect(Object.keys(env.port)).not.toContain("startSession");
    expect(Object.keys(env.port)).not.toContain("submitAnswer");
  });
});
