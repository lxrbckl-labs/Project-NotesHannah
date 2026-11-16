import { ExamId, NodeId } from "@notes/schema";
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
import { createExamsService, type ExamsService } from "./service.js";

const Offset = z.coerce.number().int().min(-840).max(840).optional();
const ListQuery = z.object({
  courseId: NodeId.optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
const UpcomingQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  withinDays: z.coerce.number().int().min(0).max(3650).optional(),
  utcOffsetMinutes: Offset,
});
const OneQuery = z.object({ utcOffsetMinutes: Offset });

function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  throw new AppError(
    "invalid_input",
    result.error.issues.map((i) => `${i.path.join(".") || "query"}: ${i.message}`).join("; "),
    { hint: "Fix the field named above and send again." },
  );
}

async function readBody(c: { req: { json(): Promise<unknown> } }, example: unknown) {
  try {
    return await c.req.json();
  } catch {
    throw new AppError("invalid_input", "The request body must be JSON.", {
      hint: "Send a JSON object with the header Content-Type: application/json.",
      example,
    });
  }
}

const EXAMPLE = { courseId: "nod_...", title: "Exam 2", date: "2026-12-14", nodeIds: ["nod_..."] };

/** Exam routes. Mount at "/api". Reads need any sign-in; changes a session or write key; delete her session. */
export function examsRoutes(
  deps: Pick<ServerDeps, "db" | "now">,
  service: ExamsService = createExamsService(deps),
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const eid = (v: string | undefined) => {
    const r = ExamId.safeParse(v);
    if (!r.success) {
      throw new AppError("not_found", "No such exam.", {
        hint: "Exam IDs look like exm_...; list them with GET /api/exams.",
      });
    }
    return r.data;
  };

  app.post("/exams", requireWrite, async (c) => {
    return c.json({ exam: service.createExam(getAuth(c), await readBody(c, EXAMPLE)) }, 201);
  });

  app.get("/exams", requireAuth, (c) => {
    return c.json(service.listExams(getAuth(c), parse(ListQuery, c.req.query())));
  });

  app.get("/exams/upcoming", requireAuth, (c) => {
    return c.json(service.upcoming(getAuth(c), parse(UpcomingQuery, c.req.query())));
  });

  app.get("/exams/:id", requireAuth, (c) => {
    const q = parse(OneQuery, c.req.query());
    return c.json({ exam: service.getExam(getAuth(c), eid(c.req.param("id")), q) });
  });

  app.patch("/exams/:id", requireWrite, async (c) => {
    const body = await readBody(c, { title: "Exam 2 (moved)", date: "2026-12-16" });
    return c.json({ exam: service.updateExam(getAuth(c), eid(c.req.param("id")), body) });
  });

  app.delete("/exams/:id", requireWrite, requireSession, (c) => {
    service.deleteExam(getAuth(c), eid(c.req.param("id")));
    return c.body(null, 204);
  });

  return app;
}
