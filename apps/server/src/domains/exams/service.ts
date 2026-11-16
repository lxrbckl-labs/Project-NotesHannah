import { type Actor, NodeId, newId } from "@notes/schema";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import type { AuthContext } from "../../http/auth-context.js";
import type { ServerDeps } from "../../http/deps.js";
import { AppError } from "../../http/errors.js";
import { leaveTrace, plural, type Trace } from "../activity/trace.js";
import {
  type CoverageStats,
  createPracticeService,
  DAY_MS,
  localDay,
  type PracticeService,
} from "../practice/service.js";
import { loadTree, nodeWords, type Tree } from "../practice/tree.js";
import { createExamsRepo, type ExamRow } from "./repo.js";

const DEFAULT_LIMIT = 50;

const Title = z.string().trim().min(1, "title must not be empty").max(200);
const ExamDate = z.iso.date({ error: "date must be a day like 2026-12-14" });
const Nodes = z.array(NodeId).max(100);

export const CreateExamInput = z.strictObject({
  /** The course the exam belongs to. */
  courseId: NodeId,
  title: Title,
  date: ExamDate,
  /** The lectures, folders or documents it covers; each must be inside the course. */
  nodeIds: Nodes.default([]),
  notes: z.string().max(2000).default(""),
});
export type CreateExamInput = z.input<typeof CreateExamInput>;

export const UpdateExamInput = z
  .strictObject({
    title: Title.optional(),
    date: ExamDate.optional(),
    nodeIds: Nodes.optional(),
    notes: z.string().max(2000).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    error: "Send at least one of title, date, nodeIds, notes.",
  });
export type UpdateExamInput = z.input<typeof UpdateExamInput>;

export interface ExamView {
  id: string;
  courseId: string;
  courseName: string | null;
  title: string;
  /** The day of the exam, YYYY-MM-DD. */
  date: string;
  notes: string;
  /** What it covers, in the order set. */
  nodeIds: string[];
  coverage: Array<{ nodeId: string; name: string | null; path: string | null }>;
  createdBy: Actor;
  createdAt: string;
  updatedAt: string;
}

export interface ExamProgress extends CoverageStats {
  /** Share of the covered questions she has attempted at least once, 0 to 1; null when nothing is covered yet. */
  attemptedShare: number | null;
  /** Correct answers over attempts on covered questions; null before the first attempt. */
  accuracy: number | null;
}

export interface ExamDetail extends ExamView {
  /** Whole days from today to the exam; 0 on the day, negative once it has passed. */
  daysRemaining: number;
  progress: ExamProgress;
}

export interface ExamsPorts extends Trace {
  /** Share the practice service of the rest of the app. Default: a new one over the same database. */
  practice?: PracticeService;
}

export interface ExamListOptions {
  courseId?: string | undefined;
  /** Only exams on or after this day. */
  from?: string | undefined;
  /** Only exams on or before this day. */
  to?: string | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

const notFoundExam = () =>
  new AppError("not_found", "No such exam.", {
    hint: "Exam IDs look like exm_...; list them with GET /api/exams.",
  });

/** Whole days from one YYYY-MM-DD to another. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

export function createExamsService(deps: Pick<ServerDeps, "db" | "now">, ports: ExamsPorts = {}) {
  const db: Db = deps.db;
  const repo = createExamsRepo(db);
  const practice = ports.practice ?? createPracticeService(deps);
  const nowIso = () => new Date(deps.now()).toISOString();

  function assertWrite(auth: AuthContext): void {
    if (auth.scope !== "write") {
      throw new AppError("read_only_key", "This API key is read-only.", {
        hint: "Create a read-write key in Settings to make changes.",
      });
    }
  }

  function parse<T extends z.ZodType>(schema: T, input: unknown, example: unknown): z.infer<T> {
    const r = schema.safeParse(input);
    if (r.success) return r.data;
    throw new AppError("invalid_input", "The request is not valid.", {
      hint: r.error.issues.map((i) => `${i.path.join(".") || "(body)"}: ${i.message}`).join("; "),
      example,
    });
  }

  const EXAMPLE = {
    courseId: "nod_...",
    title: "Exam 2",
    date: "2026-12-14",
    nodeIds: ["nod_..."],
  };

  function view(row: ExamRow, tree: Tree): ExamView {
    const nodeIds = repo.coverage(row.id);
    return {
      id: row.id,
      courseId: row.course_node_id,
      courseName: tree.nodes.get(row.course_node_id)?.name ?? null,
      title: row.title,
      date: row.exam_date,
      notes: row.notes,
      nodeIds,
      coverage: nodeIds.map((nodeId) => ({
        nodeId,
        name: tree.nodes.get(nodeId)?.name ?? null,
        path: tree.nodes.has(nodeId) ? tree.path(nodeId) : null,
      })),
      createdBy: JSON.parse(row.created_by) as Actor,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function detail(row: ExamRow, tree: Tree, offsetMinutes = 0): ExamDetail {
    const v = view(row, tree);
    const stats = practice.coverageStats(row.user_id, v.nodeIds);
    return {
      ...v,
      daysRemaining: daysBetween(localDay(deps.now(), offsetMinutes), row.exam_date),
      progress: {
        ...stats,
        attemptedShare: stats.questions === 0 ? null : stats.attempted / stats.questions,
        accuracy: stats.attempts === 0 ? null : stats.correct / stats.attempts,
      },
    };
  }

  function liveRow(userId: string, id: string): ExamRow {
    const row = repo.byId(userId, id);
    if (!row || row.trashed_at !== null) throw notFoundExam();
    return row;
  }

  /** The course must be hers and live; every covered node must lie inside it. */
  function checkPlacement(tree: Tree, courseId: string, nodeIds: readonly string[]): string[] {
    const course = tree.nodes.get(courseId);
    if (!course) {
      throw new AppError("not_found", `No such course: ${courseId}.`, {
        hint: "Use the ID of a course from GET /api/nodes.",
      });
    }
    if (course.kind !== "course") {
      throw new AppError("invalid_input", `"${course.name}" is a ${course.kind}, not a course.`, {
        hint: "An exam belongs to a course. Pass the course's ID as courseId.",
      });
    }
    if (course.trashed) {
      throw new AppError("invalid_input", `The course "${course.name}" is in the trash.`, {
        hint: "Restore the course first.",
      });
    }
    const inside = new Set(tree.subtree(courseId));
    inside.delete(courseId);
    const unique = [...new Set(nodeIds)];
    for (const id of unique) {
      const node = tree.nodes.get(id);
      if (!node) {
        throw new AppError("not_found", `No such library item: ${id}.`, {
          hint: "Cover lectures or folders of this course; list them with GET /api/nodes.",
        });
      }
      if (!inside.has(id)) {
        throw new AppError(
          "invalid_input",
          `"${node.name}" is not inside the course "${course.name}", so this exam cannot cover it.`,
          {
            hint: "Every covered node must be a lecture, folder or document under the exam's course.",
          },
        );
      }
      if (node.trashed) {
        throw new AppError("invalid_input", `"${node.name}" is in the trash.`, {
          hint: "Restore it first, or leave it out.",
        });
      }
    }
    return unique;
  }

  function createExam(auth: AuthContext, rawInput: unknown): ExamDetail {
    assertWrite(auth);
    const input = parse(CreateExamInput, rawInput, EXAMPLE);
    const tree = loadTree(db, auth.userId);
    const nodeIds = checkPlacement(tree, input.courseId, input.nodeIds);
    const now = nowIso();
    const id = newId("exam", Date.parse(now));
    db.transaction(() => {
      repo.insert({
        id,
        user_id: auth.userId,
        course_node_id: input.courseId,
        title: input.title,
        exam_date: input.date,
        notes: input.notes,
        created_by: JSON.stringify(auth.actor),
        created_at: now,
        updated_at: now,
      });
      repo.setCoverage(id, auth.userId, nodeIds);
      leaveTrace(ports, auth.userId, auth.actor, {
        action: "exam.created",
        objectType: "exam",
        objectIds: [id],
        nodeId: input.courseId,
        summary: `Added the exam "${input.title}" on ${input.date} for ${nodeWords(
          tree.nodes.get(input.courseId),
        )}, covering ${plural(nodeIds.length, "item")}`,
      });
    })();
    return detail(liveRow(auth.userId, id), tree);
  }

  function getExam(
    auth: AuthContext,
    id: string,
    opts: { utcOffsetMinutes?: number | undefined } = {},
  ): ExamDetail {
    return detail(liveRow(auth.userId, id), loadTree(db, auth.userId), opts.utcOffsetMinutes);
  }

  /** Her exams by date, soonest first. Light: no progress (ask for one exam, or `upcoming`, for that). */
  function listExams(
    auth: AuthContext,
    opts: ExamListOptions = {},
  ): { items: Array<ExamView & { daysRemaining: number }>; nextCursor: string | null } {
    const limit = Math.min(200, Math.max(1, opts.limit ?? DEFAULT_LIMIT));
    const where = ["user_id = @user", "trashed_at IS NULL"];
    const params: Record<string, unknown> = { user: auth.userId };
    if (opts.courseId) {
      where.push("course_node_id = @course");
      params.course = opts.courseId;
    }
    if (opts.from) {
      where.push("exam_date >= @from");
      params.from = opts.from;
    }
    if (opts.to) {
      where.push("exam_date <= @to");
      params.to = opts.to;
    }
    if (opts.cursor !== undefined) {
      const after = Number(Buffer.from(opts.cursor, "base64url").toString("utf8").split(":")[1]);
      const date = Buffer.from(opts.cursor, "base64url").toString("utf8").split(":")[0];
      if (!Number.isInteger(after) || !date) {
        throw new AppError("invalid_input", "The cursor is not valid.", {
          hint: "Pass the nextCursor value from the previous page unchanged, or omit cursor.",
        });
      }
      where.push("(exam_date > @cdate OR (exam_date = @cdate AND seq > @cseq))");
      params.cdate = date;
      params.cseq = after;
    }
    const rows = db
      .prepare(
        `SELECT * FROM exams WHERE ${where.join(" AND ")} ORDER BY exam_date, seq LIMIT ${limit + 1}`,
      )
      .all(params) as ExamRow[];
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const tree = loadTree(db, auth.userId);
    const today = localDay(deps.now());
    return {
      items: page.map((r) => ({
        ...view(r, tree),
        daysRemaining: daysBetween(today, r.exam_date),
      })),
      nextCursor:
        rows.length > limit && last
          ? Buffer.from(`${last.exam_date}:${last.seq}`, "utf8").toString("base64url")
          : null,
    };
  }

  /** Exams from today on with a countdown and review progress: what the home screen shows (M2). */
  function upcoming(
    auth: AuthContext,
    opts: {
      limit?: number | undefined;
      withinDays?: number | undefined;
      utcOffsetMinutes?: number | undefined;
    } = {},
  ): { items: ExamDetail[] } {
    const offset = opts.utcOffsetMinutes ?? 0;
    const today = localDay(deps.now(), offset);
    const limit = Math.min(50, Math.max(1, opts.limit ?? 10));
    const rows = db
      .prepare(
        `SELECT * FROM exams WHERE user_id = ? AND trashed_at IS NULL AND exam_date >= ?
         ORDER BY exam_date, seq`,
      )
      .all(auth.userId, today) as ExamRow[];
    const tree = loadTree(db, auth.userId);
    const items = rows
      .filter(
        (r) => opts.withinDays === undefined || daysBetween(today, r.exam_date) <= opts.withinDays,
      )
      .slice(0, limit)
      .map((r) => detail(r, tree, offset));
    return { items };
  }

  function updateExam(auth: AuthContext, id: string, rawInput: unknown): ExamDetail {
    assertWrite(auth);
    const input = parse(UpdateExamInput, rawInput, { title: "Exam 2 (moved)", date: "2026-12-16" });
    const row = liveRow(auth.userId, id);
    const tree = loadTree(db, auth.userId);
    const nodeIds = input.nodeIds ? checkPlacement(tree, row.course_node_id, input.nodeIds) : null;
    db.transaction(() => {
      repo.update({
        id,
        user_id: auth.userId,
        title: input.title ?? row.title,
        exam_date: input.date ?? row.exam_date,
        notes: input.notes ?? row.notes,
        updated_at: nowIso(),
      });
      if (nodeIds) repo.setCoverage(id, auth.userId, nodeIds);
      const changed = [
        input.title !== undefined && input.title !== row.title ? `renamed to "${input.title}"` : "",
        input.date !== undefined && input.date !== row.exam_date ? `moved to ${input.date}` : "",
        nodeIds ? `now covers ${plural(nodeIds.length, "item")}` : "",
        input.notes !== undefined && input.notes !== row.notes ? "notes changed" : "",
      ].filter(Boolean);
      leaveTrace(ports, auth.userId, auth.actor, {
        action: "exam.updated",
        objectType: "exam",
        objectIds: [id],
        nodeId: row.course_node_id,
        summary: `Changed the exam "${row.title}": ${changed.join(", ") || "no visible change"}`,
      });
    })();
    return detail(liveRow(auth.userId, id), tree);
  }

  /** Delete an exam. Only her browser session; the material it covered is untouched. */
  function deleteExam(auth: AuthContext, id: string): void {
    assertWrite(auth);
    if (auth.via !== "session" || auth.actor.type !== "user") {
      throw new AppError("forbidden", "Deleting an exam needs her signed-in browser session.", {
        hint: "An agent can create and change exams; ask her to delete one.",
      });
    }
    const row = liveRow(auth.userId, id);
    repo.delete(auth.userId, id);
    leaveTrace(ports, auth.userId, auth.actor, {
      action: "exam.deleted",
      objectType: "exam",
      objectIds: [id],
      nodeId: row.course_node_id,
      summary: `Deleted the exam "${row.title}" (${row.exam_date})`,
    });
  }

  // ---- node hooks (the integrator calls these from the library routes) ----

  const ids = (nodeIds: readonly string[]) => JSON.stringify([...new Set(nodeIds)]);

  /** A course went to the trash: its exams are hidden (and out of every list). */
  function onNodeTrashed(userId: string, nodeIds: readonly string[]): void {
    db.prepare(
      "UPDATE exams SET trashed_at = ? WHERE user_id = ? AND trashed_at IS NULL AND course_node_id IN (SELECT value FROM json_each(?))",
    ).run(nowIso(), userId, ids(nodeIds));
  }

  /** The course came back: its exams return. */
  function onNodeRestored(userId: string, nodeIds: readonly string[]): void {
    db.prepare(
      "UPDATE exams SET trashed_at = NULL WHERE user_id = ? AND course_node_id IN (SELECT value FROM json_each(?))",
    ).run(userId, ids(nodeIds));
  }

  /** Nodes were deleted for good: exams of a deleted course go; covered nodes that are gone drop out of the list. */
  function onNodeDeleted(userId: string, nodeIds: readonly string[]): void {
    db.transaction(() => {
      db.prepare(
        "DELETE FROM exams WHERE user_id = ? AND course_node_id IN (SELECT value FROM json_each(?))",
      ).run(userId, ids(nodeIds));
      db.prepare(
        "DELETE FROM exam_coverage WHERE user_id = ? AND node_id IN (SELECT value FROM json_each(?))",
      ).run(userId, ids(nodeIds));
    })();
  }

  /**
   * A course was duplicated: its exams are copied onto the copy. `nodeMap`
   * says which node of the copy stands for each node of the original; covered
   * nodes with no entry are left out. Other nodes have no exams of their own.
   */
  function onNodeDuplicated(
    userId: string,
    fromNodeId: string,
    toNodeId: string,
    nodeMap: Readonly<Record<string, string>> = {},
  ): number {
    return db.transaction(() => {
      const rows = db
        .prepare(
          "SELECT * FROM exams WHERE user_id = ? AND course_node_id = ? AND trashed_at IS NULL ORDER BY seq",
        )
        .all(userId, fromNodeId) as ExamRow[];
      const now = nowIso();
      for (const row of rows) {
        const id = newId("exam", Date.parse(now));
        repo.insert({
          id,
          user_id: userId,
          course_node_id: toNodeId,
          title: row.title,
          exam_date: row.exam_date,
          notes: row.notes,
          created_by: row.created_by,
          created_at: now,
          updated_at: now,
        });
        repo.setCoverage(
          id,
          userId,
          repo.coverage(row.id).flatMap((n) => (nodeMap[n] ? [nodeMap[n] as string] : [])),
        );
      }
      return rows.length;
    })();
  }

  return {
    createExam,
    getExam,
    listExams,
    upcoming,
    updateExam,
    deleteExam,
    onNodeTrashed,
    onNodeRestored,
    onNodeDeleted,
    onNodeDuplicated,
  };
}

export type ExamsService = ReturnType<typeof createExamsService>;
