import {
  Citation,
  ConceptId,
  ExamId,
  NodeId,
  PageRequest,
  PracticeSessionId,
  practice,
  QuestionId,
} from "@notes/schema";
import { z } from "zod";
import type { QuestionSummary } from "../../domains/practice/index.js";
import { AppError } from "../../http/errors.js";
import { PublishedCitation } from "../citation.js";
import { exampleId } from "../errors.js";
import { clip, json } from "../format.js";
import type { PracticeToolPort } from "../ports.js";
import { checkQuotes } from "../quotes.js";
import { describe, flattenActions, jsonOf } from "../schema.js";
import { defineTool, parseAction, type ToolContext } from "../tool.js";

const QST = exampleId("question");
const NODE = exampleId("node");

function port(ctx: ToolContext): PracticeToolPort {
  const p = ctx.backend.practice;
  if (!p) throw new AppError("internal", "Practice is not available.");
  return p;
}

export function questionLine(q: QuestionSummary): string {
  const bits = [
    q.type,
    `difficulty ${q.difficulty}`,
    q.review,
    `by ${q.author.type === "agent" ? "an agent" : "her"}`,
    q.generalKnowledge ? "general knowledge" : `${q.citationCount} citation(s)`,
  ];
  if (q.tags.length) bits.push(`tags ${q.tags.join(", ")}`);
  if (q.trashedAt) bits.push("trashed");
  return `- ${q.id} [${bits.join("; ")}] ${clip(q.text.replace(/\s+/g, " "), 140).text}`;
}

/**
 * A question as published in the tool schema: the type and the shared fields;
 * each type's own fields are left open (the full union is large). The server
 * checks every question with validateQuestionInput and answers a wrong one
 * with the JSON path, the problem and a valid question of that type.
 */
const PublishedQuestion = z.looseObject({
  type: practice.QuestionType,
  sources: z.array(PublishedCitation).max(10).optional(),
  generalKnowledge: z.boolean().optional(),
  difficulty: practice.QuestionDifficulty.optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  conceptIds: z.array(ConceptId).max(20).optional(),
});
const questions = z.array(PublishedQuestion).min(1).max(100);

const BRANCHES = {
  create: z.strictObject({
    nodeIds: z.array(NodeId).min(1).max(10),
    questions,
    partial: z.boolean().default(false),
    validateOnly: z.boolean().default(false),
  }),
  list: z.strictObject({
    nodeId: NodeId.optional(),
    type: practice.QuestionType.optional(),
    tag: z.string().max(40).optional(),
    conceptId: ConceptId.optional(),
    examId: ExamId.optional(),
    author: z.enum(["agent", "user"]).optional(),
    trashed: z.boolean().optional(),
    cursor: PageRequest.shape.cursor,
    limit: z.number().int().min(1).max(100).default(50),
  }),
  update: z.strictObject({
    questionId: QuestionId,
    question: PublishedQuestion.optional(),
    nodeIds: z.array(NodeId).min(1).max(10).optional(),
  }),
  trash: z.strictObject({ questionId: QuestionId }),
  restore: z.strictObject({ questionId: QuestionId }),
};
type Action = keyof typeof BRANCHES;

const EXAMPLES: Record<Action, Record<string, unknown>> = {
  create: {
    action: "create",
    nodeIds: [NODE],
    questions: [practice.exampleFor("multiple_choice"), practice.exampleFor("flashcard")],
  },
  list: { action: "list", nodeId: NODE },
  update: { action: "update", questionId: QST, question: practice.exampleFor("flashcard") },
  trash: { action: "trash", questionId: QST },
  restore: { action: "restore", questionId: QST },
};

const QUESTION_DESCRIPTIONS: Record<string, string> = {
  "questions[].type": `The question type: ${practice.QUESTION_TYPES.join(", ")}. Each type's own fields and an example: start_here {"topic":"practice"}.`,
  "questions[].sources":
    "Where it came from: at least one citation (fileId, pageId, quote copied exactly from that page's transcript), or generalKnowledge: true.",
  "questions[].sources[].fileId": "The source file.",
  "questions[].sources[].pageId": "The source page.",
  "questions[].sources[].quote": "The supporting passage, character for character.",
  "questions[].sources[].label": 'Optional chip label, e.g. "Slide 10".',
  "questions[].generalKnowledge":
    'True when it is not from her notes (labelled "not from your notes").',
  "questions[].difficulty": "1 (easy), 2 (medium, the default) or 3 (hard).",
  "questions[].tags": 'Short topic tags, e.g. ["dosing"], used for her weak-area figures.',
  "questions[].conceptIds": "Concepts it tests (con_ IDs), used for her weak-area figures.",
};

export const practiceQuestions = defineTool({
  name: "practice_questions",
  title: "Write and manage practice questions",
  description: `Author her practice questions: multiple_choice, select_all, matching, fill_blank, calculation (numeric with units; can repeat with fresh numbers), flashcard (spaced repetition), case (vignette with sub-questions), free_response. "create" stores 1 to 100 under the lectures, folders or documents in nodeIds (atomic: any problem stores nothing and lists each one as questions[i] $.path: message, with a valid example of that type; "partial": true stores the valid ones; "validateOnly": true only checks). Every question cites the page it came from (quote copied exactly from the transcript or slide text; a wrong quote is refused with the closest passage to copy); generalKnowledge: true only for what is not in her material. "list" (filters), "update" (new content of the same type and/or new nodeIds), "trash", "restore"; open one with get_item {"id":"qst_…"}. You cannot rewrite a question she wrote or reviewed. Agents never take practice sessions or answer for her.`,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  inputSchema: describe(
    flattenActions(
      "action",
      Object.fromEntries(Object.entries(BRANCHES).map(([k, v]) => [k, jsonOf(v)])),
      '"create" questions (or validate them); "list" them; "update" one; "trash" or "restore" one.',
    ),
    {
      nodeIds: `create: the lectures, folders or documents they belong to (1 to 10), e.g. ["${NODE}"]. update: move it there.`,
      questions: "create: 1 to 100 questions.",
      ...QUESTION_DESCRIPTIONS,
      partial:
        "create: store the valid questions and report the rest (default false: all or nothing).",
      validateOnly: "create: only check the questions; nothing is stored.",
      nodeId: "list: questions under this node (and everything below it).",
      type: "list: only this type.",
      tag: "list: only questions with this tag.",
      conceptId: "list: only questions about this concept.",
      examId: "list: only questions an exam covers.",
      author: 'list: "agent" or "user" (hers).',
      trashed: "list: the trash instead.",
      cursor: "list: the nextCursor of the previous call.",
      limit: "list: 1 to 100 (default 50).",
      questionId: `The question, e.g. "${QST}".`,
      question:
        "update: the whole new question, same type (its fields replace the old ones); same shape as an item of questions.",
      "question.type": "The type; it cannot change.",
      "question.sources": "As for questions[].sources.",
      "question.sources[].fileId": "The source file.",
      "question.sources[].pageId": "The source page.",
      "question.sources[].quote": "The passage, character for character.",
      "question.sources[].label": "Optional.",
      "question.generalKnowledge": "As for questions[].",
      "question.difficulty": "1, 2 or 3.",
      "question.tags": "Topic tags.",
      "question.conceptIds": "Concepts it tests.",
    },
  ),
  parse: (raw) => parseAction("practice_questions", "action", BRANCHES, EXAMPLES, raw),
  writes: (input) => {
    const { action, value } = input as { action: string; value: { validateOnly?: boolean } };
    return action !== "list" && !(action === "create" && value.validateOnly);
  },
  action: (input) => (input as { action: string }).action,
  run(ctx, input) {
    const p = port(ctx);
    const { action, value } = input as unknown as {
      action: Action;
      value: Record<string, unknown>;
    };
    if (action === "create") {
      const v = value as unknown as z.output<typeof BRANCHES.create>;
      if (v.validateOnly) {
        const checked = p.validateQuestions(ctx.auth, v.questions);
        const lines = [
          `${checked.valid} of ${v.questions.length} question(s) are valid; nothing was stored.`,
          ...problemLines(checked.problems),
        ];
        return { text: lines.join("\n"), structured: { ...checked, validateOnly: true } };
      }
      ctx.claims.assertFree(ctx.userId, v.nodeIds, ctx.keyId);
      if (!v.partial) checkQuotes(ctx, v.questions, "$.questions");
      const r = p.createQuestions(ctx.auth, {
        nodeIds: v.nodeIds,
        questions: v.questions,
        partial: v.partial,
      });
      const lines = [
        `Stored ${r.stored} question(s) under ${v.nodeIds.join(", ")} (${countByType(r.created)}); they stay "unverified" until she reviews them.`,
        ...r.created.map(questionLine),
        ...(r.problems.length ? ["Refused:", ...problemLines(r.problems)] : []),
      ];
      return {
        text: lines.join("\n"),
        structured: {
          stored: r.stored,
          created: r.created.map((q) => q.id),
          problems: r.problems,
        },
      };
    }
    if (action === "list") {
      const v = value as unknown as z.output<typeof BRANCHES.list>;
      const page = p.listQuestions(ctx.auth, v);
      const items = page.items as QuestionSummary[];
      const lines = [`${items.length} question(s).`, ...items.map(questionLine)];
      if (page.nextCursor) {
        lines.push(
          `More: practice_questions ${json({ ...v, action: "list", cursor: page.nextCursor })}.`,
        );
      }
      return { text: lines.join("\n"), structured: { items, nextCursor: page.nextCursor } };
    }
    const id = value.questionId as string;
    if (action === "update") {
      const { questionId: _id, ...rest } = value;
      if (Array.isArray(rest.nodeIds)) ctx.claims.assertFree(ctx.userId, rest.nodeIds, ctx.keyId);
      checkQuotes(ctx, rest.question, "$.question");
      const d = p.updateQuestion(ctx.auth, id, rest);
      return {
        text: `Updated:\n${questionLine(d)}\nUnder ${d.nodeIds.join(", ")}.`,
        structured: { action, question: d },
      };
    }
    const q = action === "trash" ? p.trashQuestion(ctx.auth, id) : p.restoreQuestion(ctx.auth, id);
    return {
      text: `${action === "trash" ? "Trashed (restorable)" : "Restored"}:\n${questionLine(q)}`,
      structured: { action, question: q },
    };
  },
});

function countByType(list: readonly QuestionSummary[]): string {
  const counts = new Map<string, number>();
  for (const q of list) counts.set(q.type, (counts.get(q.type) ?? 0) + 1);
  return [...counts].map(([t, n]) => `${n} ${t}`).join(", ") || "none";
}

function problemLines(
  problems: ReadonlyArray<{ index: number; problems: practice.Problem[] }>,
): string[] {
  return problems.flatMap((item) =>
    item.problems.map(
      (pr, i) =>
        `- questions[${item.index}] ${pr.path}: ${pr.message}${i === 0 ? ` Example: ${json(pr.example)}` : ""}`,
    ),
  );
}

/** get_item on a qst_ ID. */
export function getQuestion(ctx: ToolContext, id: string) {
  const d = port(ctx).getQuestion(ctx.auth, id);
  return {
    text: `${questionLine(d).replace(/^- /, "Question ")}\nUnder ${d.nodeIds.join(", ")}; exams ${d.examIds.join(", ") || "none"}; ${d.stats.attempts} attempt(s), ${d.stats.correct} correct.\nFull question JSON is in "question". Change it with practice_questions {"action":"update","questionId":"${id}","question":{...}}.`,
    structured: { kind: "question", question: d },
  };
}

// ---------------------------------------------------------------------------
// study_progress: her results, read only
// ---------------------------------------------------------------------------

const PROGRESS = {
  weak_areas: z.strictObject({
    nodeId: NodeId.optional(),
    minAttempts: z.number().int().min(1).max(100).optional(),
    minQuestions: z.number().int().min(1).max(100).optional(),
    weakBelow: z.number().min(0).max(1).optional(),
  }),
  notebook: z.strictObject({
    nodeId: NodeId.optional(),
    type: practice.QuestionType.optional(),
  }),
  due: z.strictObject({
    nodeId: NodeId.optional(),
    examId: ExamId.optional(),
    type: practice.QuestionType.optional(),
    limit: z.number().int().min(1).max(100).default(20),
  }),
  sessions: z.strictObject({ limit: z.number().int().min(1).max(50).default(10) }),
  results: z.strictObject({ sessionId: PracticeSessionId }),
};
type ProgressAction = keyof typeof PROGRESS;

const PROGRESS_EXAMPLES: Record<ProgressAction, Record<string, unknown>> = {
  weak_areas: { action: "weak_areas", nodeId: NODE },
  notebook: { action: "notebook" },
  due: { action: "due" },
  sessions: { action: "sessions" },
  results: { action: "results", sessionId: exampleId("practiceSession") },
};

const pct = (x: number | null | undefined) => (x == null ? "n/a" : `${Math.round(x * 100)}%`);

export const studyProgress = defineTool({
  name: "study_progress",
  title: "Read her practice results",
  description:
    'How she is doing, to build targeted practice: "weak_areas" (accuracy by tag, concept and lecture, each weak, ok or insufficient_data), "notebook" (questions she missed and must still get right), "due" (spaced-repetition cards due now and the next 14 days), "sessions" (her recent practice sessions) and "results" of one session. Read only; scope any of them with nodeId (a course, lecture or folder).',
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: describe(
    flattenActions(
      "action",
      Object.fromEntries(Object.entries(PROGRESS).map(([k, v]) => [k, jsonOf(v)])),
      '"weak_areas", "notebook", "due", "sessions" or "results".',
    ),
    {
      nodeId: "Only questions under this node (a course, lecture or folder).",
      minAttempts: "weak_areas: attempts an area needs before it is judged (default 5).",
      minQuestions: "weak_areas: different questions an area needs (default 3).",
      weakBelow: "weak_areas: accuracy under this is weak (default 0.7).",
      type: "notebook, due: only this question type.",
      examId: "due: only cards an exam covers.",
      limit: "due: cards to list (default 20); sessions: how many (default 10).",
      sessionId: `results: the session, e.g. "${exampleId("practiceSession")}".`,
    },
  ),
  parse: (raw) => parseAction("study_progress", "action", PROGRESS, PROGRESS_EXAMPLES, raw),
  writes: () => false,
  action: (input) => (input as { action: string }).action,
  run(ctx, input) {
    const p = port(ctx);
    const { action, value } = input as unknown as {
      action: ProgressAction;
      value: Record<string, unknown>;
    };
    switch (action) {
      case "weak_areas": {
        const w = p.weakAreas(ctx.auth, value);
        const area = (a: {
          key: string;
          label?: string | null;
          status: string;
          accuracy: number | null;
          attempts: number;
        }) =>
          `- ${a.label ?? a.key}: ${a.status}, accuracy ${pct(a.accuracy)} over ${a.attempts} attempt(s)`;
        const lines = [
          "Weak areas (weak first):",
          "By concept:",
          ...sortWeak(w.byConcept).slice(0, 15).map(area),
          "By tag:",
          ...sortWeak(w.byTag).slice(0, 15).map(area),
          "By library area:",
          ...sortWeak(w.byNode).slice(0, 15).map(area),
        ];
        return { text: lines.join("\n"), structured: { ...w } };
      }
      case "notebook": {
        const n = p.notebook(ctx.auth, value);
        const lines = [
          `Missed-questions notebook: ${n.counts.total} question(s).`,
          ...n.items
            .slice(0, 50)
            .map(
              (e) =>
                `- ${e.questionId} ${e.type}, missed ${e.timesMissed}x, still needs ${e.stillNeeds} correct: ${clip(e.question.text, 100).text}`,
            ),
        ];
        return {
          text: lines.join("\n"),
          structured: { counts: n.counts, items: n.items.slice(0, 50) },
        };
      }
      case "due": {
        const d = p.dueList(ctx.auth, value);
        const lines = [
          `Due now: ${d.counts.due}, new: ${d.counts.new}, scheduled cards: ${d.counts.total}. Next days: ${d.counts.byDay.map((b) => `${b.date} ${b.count}`).join(", ")}.`,
          ...d.items.map(
            (i) =>
              `- ${i.question.id} ${i.question.type}, overdue ${i.overdueDays} day(s): ${clip(i.question.text, 100).text}`,
          ),
        ];
        return { text: lines.join("\n"), structured: { counts: d.counts, items: d.items } };
      }
      case "sessions": {
        const s = p.listSessions(ctx.auth, { limit: value.limit as number });
        const lines = [
          `${s.items.length} recent session(s):`,
          ...s.items.map(
            (x) =>
              `- ${x.id} ${x.status}, started ${x.startedAt}, ${x.correct} correct of ${x.length}`,
          ),
        ];
        return { text: lines.join("\n"), structured: { items: s.items } };
      }
      default: {
        const r = p.results(ctx.auth, value.sessionId as string);
        return { text: `Results of ${value.sessionId}:\n${json(r)}`, structured: { results: r } };
      }
    }
  },
});

function sortWeak<T extends { status: string; accuracy: number | null }>(list: readonly T[]): T[] {
  const rank = (s: string) => (s === "weak" ? 0 : s === "ok" ? 1 : 2);
  return [...list].sort(
    (a, b) => rank(a.status) - rank(b.status) || (a.accuracy ?? 1) - (b.accuracy ?? 1),
  );
}
