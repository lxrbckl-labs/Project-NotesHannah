import { ExamId, NodeId } from "@notes/schema";
import { z } from "zod";
import { CreateExamInput, type ExamDetail, UpdateExamInput } from "../../domains/exams/index.js";
import { AppError } from "../../http/errors.js";
import { exampleId } from "../errors.js";
import type { ExamsToolPort } from "../ports.js";
import { describe, flattenActions, jsonOf } from "../schema.js";
import { defineTool, parseAction, type ToolContext } from "../tool.js";

const EXM = exampleId("exam");
const NODE = exampleId("node");

function port(ctx: ToolContext): ExamsToolPort {
  const p = ctx.backend.exams;
  if (!p) throw new AppError("internal", "Exams are not available.");
  return p;
}

const pct = (x: number | null) => (x === null ? "n/a" : `${Math.round(x * 100)}%`);

export function examLines(e: ExamDetail): string[] {
  const p = e.progress;
  return [
    `- ${e.id} "${e.title}" (${e.courseName ?? e.courseId}) on ${e.date}, in ${e.daysRemaining} day(s). Covers: ${e.coverage.map((c) => `${c.name ?? c.nodeId} (${c.nodeId})`).join(", ") || "nothing yet"}.`,
    `  Progress: ${p.questions} question(s) under it, ${pct(p.attemptedShare)} attempted, accuracy ${pct(p.accuracy)}, ${p.dueCards} card(s) due, ${p.notebook} in the missed notebook.`,
  ];
}

const BRANCHES = {
  list: z.strictObject({
    courseId: NodeId.optional(),
    withinDays: z.number().int().min(1).max(366).optional(),
    limit: z.number().int().min(1).max(50).default(10),
  }),
  create: z.strictObject({ ...CreateExamInput.shape }),
  update: z.strictObject({ examId: ExamId, ...UpdateExamInput.shape }),
};
type Action = keyof typeof BRANCHES;

const EXAMPLES: Record<Action, Record<string, unknown>> = {
  list: { action: "list" },
  create: {
    action: "create",
    courseId: NODE,
    title: "Exam 2",
    date: "2026-12-14",
    nodeIds: [NODE],
  },
  update: { action: "update", examId: EXM, date: "2026-12-16" },
};

export const examsTool = defineTool({
  name: "exams",
  title: "Her exams: dates, coverage and progress",
  description:
    '"list" her upcoming exams, soonest first, with what each covers and her progress on it (questions, attempted share, accuracy, due cards, missed notebook), to plan review backwards from the date. "create" an exam for a course (title, date YYYY-MM-DD, the lectures, folders or documents it covers, all inside the course) when she asks for one or when her material states an exam date; "update" one (date moved, coverage changed). Deleting an exam is hers only. Open one with get_item {"id":"exm_…"}.',
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  inputSchema: describe(
    flattenActions(
      "action",
      Object.fromEntries(Object.entries(BRANCHES).map(([k, v]) => [k, jsonOf(v)])),
      '"list" upcoming exams; "create" one; "update" one.',
    ),
    {
      courseId: `list: only this course. create: the course node, e.g. "${NODE}".`,
      withinDays: "list: only exams in the next N days.",
      limit: "list: how many (default 10).",
      title: 'create, update: e.g. "Exam 2".',
      date: 'create, update: the day, "YYYY-MM-DD".',
      nodeIds: "create, update: the lectures, folders or documents it covers, inside the course.",
      notes: "create, update: anything she said about it (format, rooms), up to 2000 characters.",
      examId: `update: the exam, e.g. "${EXM}".`,
    },
  ),
  parse: (raw) => parseAction("exams", "action", BRANCHES, EXAMPLES, raw),
  writes: (input) => (input as { action: string }).action !== "list",
  action: (input) => (input as { action: string }).action,
  run(ctx, input) {
    const p = port(ctx);
    const { action, value } = input as unknown as {
      action: Action;
      value: Record<string, unknown>;
    };
    if (action === "list") {
      const v = value as unknown as z.output<typeof BRANCHES.list>;
      let items = p.upcoming(ctx.auth, { limit: 50, withinDays: v.withinDays }).items;
      if (v.courseId) items = items.filter((e) => e.courseId === v.courseId);
      items = items.slice(0, v.limit);
      const lines = [`${items.length} upcoming exam(s).`, ...items.flatMap(examLines)];
      return { text: lines.join("\n"), structured: { items } };
    }
    const e =
      action === "create"
        ? p.createExam(ctx.auth, value)
        : (() => {
            const { examId, ...rest } = value;
            return p.updateExam(ctx.auth, examId as string, rest);
          })();
    return {
      text: [`${action === "create" ? "Created" : "Updated"}:`, ...examLines(e)].join("\n"),
      structured: { action, exam: e },
    };
  },
});

/** get_item on an exm_ ID. */
export function getExam(ctx: ToolContext, id: string) {
  const e = port(ctx).getExam(ctx.auth, id);
  return {
    text: [`Exam ${e.id}${e.notes ? `, notes: ${e.notes}` : ""}`, ...examLines(e)].join("\n"),
    structured: { kind: "exam", exam: e },
  };
}
