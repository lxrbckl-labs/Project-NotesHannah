import { ConceptId, ExamId, NodeId, PracticeSessionId, practice, QuestionId } from "@notes/schema";
import { Hono } from "hono";
import { z } from "zod";
import {
  type AppEnv,
  getAuth,
  requireAuth,
  requireSession,
  requireWrite,
} from "../../http/auth-context.js";
import type { ServerDeps } from "../../http/deps.js";
import { AppError } from "../../http/errors.js";
import { ReviewInput, SubmitAnswerInput } from "./inputs.js";
import { createPracticeService, type PracticeService } from "./service.js";

const Limit = z.coerce.number().int().min(1).max(200).default(50);
const Cursor = z.string().max(200).optional();
const Bool = z.stringbool();

const QuestionQuery = z.object({
  nodeId: NodeId.optional(),
  type: practice.QuestionType.optional(),
  tag: z.string().min(1).max(40).optional(),
  conceptId: ConceptId.optional(),
  difficulty: z.coerce.number().int().min(1).max(3).optional(),
  review: practice.ReviewStatus.optional(),
  examId: ExamId.optional(),
  author: z.enum(["agent", "user"]).optional(),
  trashed: Bool.optional(),
  full: Bool.optional(),
  cursor: Cursor,
  limit: Limit,
});
const PageQuery = z.object({ cursor: Cursor, limit: Limit });
const SessionQuery = z.object({
  status: z.enum(["active", "finished", "abandoned"]).optional(),
  cursor: Cursor,
  limit: Limit,
});
const WeakQuery = z.object({
  nodeId: NodeId.optional(),
  minAttempts: z.coerce.number().int().min(1).max(1000).optional(),
  minQuestions: z.coerce.number().int().min(1).max(1000).optional(),
  weakBelow: z.coerce.number().min(0).max(1).optional(),
});
const NotebookQuery = z.object({
  nodeId: NodeId.optional(),
  type: practice.QuestionType.optional(),
});
const DueQuery = z.object({
  nodeId: NodeId.optional(),
  examId: ExamId.optional(),
  type: practice.QuestionType.optional(),
  limit: Limit,
  utcOffsetMinutes: z.coerce.number().int().min(-840).max(840).optional(),
});
const ReviewManyInput = z.strictObject({
  questionIds: z.array(QuestionId).min(1).max(200),
  status: practice.ReviewStatus,
});
const ValidateInput = z.strictObject({ questions: z.array(z.unknown()).min(1).max(100) });
const ScheduleInput = z.strictObject({ enabled: z.boolean() });
const RevealInput = z.strictObject({ position: z.number().int().min(0).max(99) });
const CitedQuery = z.object({ cursor: Cursor, limit: Limit });

const EXAMPLE_QUESTION = practice.exampleFor("multiple_choice");
const EXAMPLES = {
  create: { nodeIds: ["nod_..."], questions: [EXAMPLE_QUESTION], partial: false },
  start: {
    scope: { kind: "nodes", nodeIds: ["nod_..."] },
    formats: ["multiple_choice", "fill_blank"],
    length: 10,
  },
  answer: { position: 0, answer: { type: "multiple_choice", optionId: "o1" } },
};

function parse<T extends z.ZodType>(schema: T, data: unknown, example?: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const problems = result.error.issues.map(
    (issue) => `${issue.path.join(".") || "body"}: ${issue.message}`,
  );
  throw new AppError("invalid_input", problems.join("; "), {
    hint: "Fix the field named above and send again.",
    ...(example !== undefined ? { example } : {}),
  });
}

function id<T extends z.ZodType>(schema: T, value: string | undefined, what: string): string {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError("not_found", `No such ${what}.`, {
      hint: `A ${what} ID looks like the examples in docs/api.md.`,
    });
  }
  return result.data as string;
}

async function readBody(
  c: { req: { json(): Promise<unknown> } },
  example: unknown,
  optional = false,
): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    if (optional) return {};
    throw new AppError("invalid_input", "The request body must be JSON.", {
      hint: "Send a JSON object with the header Content-Type: application/json.",
      example,
    });
  }
}

/**
 * Practice routes: questions, sessions, the notebook, weak areas and the
 * review schedule. Mount at "/api". Reads need any sign-in; changes need a
 * session or a write key; taking a session (start, answer, reveal, finish,
 * abandon), reviewing and deleting need her browser session.
 */
export function practiceRoutes(
  deps: Pick<ServerDeps, "db" | "now">,
  service: PracticeService = createPracticeService(deps),
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const qid = (v: string | undefined) => id(QuestionId, v, "question");
  const sid = (v: string | undefined) => id(PracticeSessionId, v, "practice session");

  // ---- questions ----------------------------------------------------------

  app.post("/practice/questions", requireWrite, async (c) => {
    const body = await readBody(c, EXAMPLES.create);
    const result = service.createQuestions(getAuth(c), body);
    return c.json(result, result.stored > 0 ? 201 : 200);
  });

  app.post("/practice/questions/validate", requireAuth, async (c) => {
    const body = parse(ValidateInput, await readBody(c, { questions: [EXAMPLE_QUESTION] }));
    return c.json(service.validateQuestions(getAuth(c), body.questions));
  });

  app.get("/practice/questions", requireAuth, (c) => {
    return c.json(service.listQuestions(getAuth(c), parse(QuestionQuery, c.req.query())));
  });

  app.post("/practice/questions/review", requireWrite, requireSession, async (c) => {
    const body = parse(
      ReviewManyInput,
      await readBody(c, { questionIds: ["qst_..."], status: "reviewed" }),
    );
    return c.json(service.setReview(getAuth(c), body.questionIds, body.status));
  });

  app.get("/practice/questions/:id", requireAuth, (c) => {
    return c.json({ question: service.getQuestion(getAuth(c), qid(c.req.param("id"))) });
  });

  app.patch("/practice/questions/:id", requireWrite, async (c) => {
    const body = await readBody(c, { question: EXAMPLE_QUESTION });
    return c.json({ question: service.updateQuestion(getAuth(c), qid(c.req.param("id")), body) });
  });

  app.post("/practice/questions/:id/trash", requireWrite, (c) => {
    return c.json({ question: service.trashQuestion(getAuth(c), qid(c.req.param("id"))) });
  });

  app.post("/practice/questions/:id/restore", requireWrite, (c) => {
    return c.json({ question: service.restoreQuestion(getAuth(c), qid(c.req.param("id"))) });
  });

  app.delete("/practice/questions/:id", requireWrite, requireSession, (c) => {
    service.deleteQuestion(getAuth(c), qid(c.req.param("id")));
    return c.body(null, 204);
  });

  app.post("/practice/questions/:id/review", requireWrite, requireSession, async (c) => {
    const body = parse(ReviewInput, await readBody(c, { status: "reviewed" }));
    const result = service.setReview(getAuth(c), [qid(c.req.param("id"))], body.status);
    return c.json({ question: result.items[0], changed: result.changed });
  });

  app.post("/practice/questions/:id/schedule", requireWrite, async (c) => {
    const body = parse(ScheduleInput, await readBody(c, { enabled: true }));
    return c.json({
      question: service.setSchedule(getAuth(c), qid(c.req.param("id")), body.enabled),
    });
  });

  app.get("/practice/questions/:id/attempts", requireAuth, (c) => {
    return c.json(
      service.listAttempts(getAuth(c), qid(c.req.param("id")), parse(PageQuery, c.req.query())),
    );
  });

  // ---- what cites a page (K5), questions' share ------------------------------

  app.get("/practice/citations/pages/:pageId", requireAuth, (c) => {
    const pageId = id(z.string().regex(/^pag_/), c.req.param("pageId"), "page");
    return c.json(service.citedBy(getAuth(c), { pageId }, parse(CitedQuery, c.req.query())));
  });

  app.get("/practice/citations/files/:fileId", requireAuth, (c) => {
    const fileId = id(z.string().regex(/^fil_/), c.req.param("fileId"), "file");
    return c.json(service.citedBy(getAuth(c), { fileId }, parse(CitedQuery, c.req.query())));
  });

  // ---- sessions ---------------------------------------------------------------

  app.post("/practice/sessions", requireWrite, requireSession, async (c) => {
    const body = await readBody(c, EXAMPLES.start);
    return c.json(service.startSession(getAuth(c), body), 201);
  });

  app.get("/practice/sessions", requireAuth, (c) => {
    return c.json(service.listSessions(getAuth(c), parse(SessionQuery, c.req.query())));
  });

  app.get("/practice/sessions/:id", requireAuth, (c) => {
    return c.json({ session: service.getSession(getAuth(c), sid(c.req.param("id"))) });
  });

  app.get("/practice/sessions/:id/next", requireAuth, (c) => {
    return c.json(service.nextQuestion(getAuth(c), sid(c.req.param("id"))));
  });

  app.get("/practice/sessions/:id/items/:position", requireAuth, (c) => {
    const position = parse(z.coerce.number().int().min(0).max(99), c.req.param("position"));
    return c.json(service.getItem(getAuth(c), sid(c.req.param("id")), position));
  });

  app.post("/practice/sessions/:id/answer", requireWrite, requireSession, async (c) => {
    const body = parse(SubmitAnswerInput, await readBody(c, EXAMPLES.answer), EXAMPLES.answer);
    return c.json(service.submitAnswer(getAuth(c), sid(c.req.param("id")), body));
  });

  app.post("/practice/sessions/:id/reveal", requireWrite, requireSession, async (c) => {
    const body = parse(RevealInput, await readBody(c, { position: 0 }), { position: 0 });
    return c.json({
      position: body.position,
      reveal: service.reveal(getAuth(c), sid(c.req.param("id")), body.position),
    });
  });

  app.post("/practice/sessions/:id/finish", requireWrite, requireSession, (c) => {
    return c.json(service.finishSession(getAuth(c), sid(c.req.param("id"))));
  });

  app.post("/practice/sessions/:id/abandon", requireWrite, requireSession, (c) => {
    return c.json({ session: service.abandonSession(getAuth(c), sid(c.req.param("id"))) });
  });

  app.get("/practice/sessions/:id/results", requireAuth, (c) => {
    return c.json(service.results(getAuth(c), sid(c.req.param("id"))));
  });

  // ---- her progress -----------------------------------------------------------

  app.get("/practice/notebook", requireAuth, (c) => {
    return c.json(service.notebook(getAuth(c), parse(NotebookQuery, c.req.query())));
  });

  app.get("/practice/weak-areas", requireAuth, (c) => {
    return c.json(service.weakAreas(getAuth(c), parse(WeakQuery, c.req.query())));
  });

  app.get("/practice/due", requireAuth, (c) => {
    return c.json(service.dueList(getAuth(c), parse(DueQuery, c.req.query())));
  });

  return app;
}
