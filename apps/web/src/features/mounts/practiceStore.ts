import { practice } from "@notes/schema";
import type { AppHttp } from "../../lib/api";
import type { ExamInput, ExamProgress, ExamSummary } from "../exams/types";
import {
  type AreaRow,
  type DueByDay,
  type ItemStatus,
  type NotebookItem,
  type PracticeOverview,
  type PracticeScopeOption,
  type PracticeStore,
  QUESTION_TYPES,
  type QuestionOutcome,
  type QuestionType,
  type Reveal,
  type ServedBody,
  type ServedPart,
  type ServedQuestion,
  type SessionResults,
  type SessionScope,
  type SessionState,
  type StartRequest,
  type UnfinishedSession,
  type WeakAreasView,
} from "../practice/types";

/**
 * The practice module's `PracticeStore` over the REAL routes (docs/api.md, "Practice" and
 * "Exams"). The module was written against assumed routes and shapes; this adapter is the only
 * place that knows the difference:
 *
 * - the server serves a question as `{ view, selfGraded }`; skipping is the server's
 *   (`POST .../skip`), so a session resumes the same on another device;
 * - the key of a flashcard or free response comes from `POST .../reveal`, after which she rates;
 * - there is no overview route: the start screen's scopes are assembled from the question list,
 *   the exams, the notebook and the due deck;
 * - exams belong to a course node (`courseId`), found from the covered nodes.
 */

// ---------------------------------------------------------------- server shapes (the parts used)

type View =
  | {
      type: "multiple_choice" | "select_all";
      prompt: string;
      image?: ServedBody["image"];
      options: Array<{ id: string; text: string }>;
    }
  | {
      type: "matching";
      prompt: string;
      image?: ServedBody["image"];
      left: Array<{ id: string; text: string }>;
      right: string[];
    }
  | { type: "fill_blank"; text: string; image?: ServedBody["image"]; blankCount: number }
  | { type: "calculation"; prompt: string; image?: ServedBody["image"] }
  | { type: "flashcard"; front: string; image?: ServedBody["image"] }
  | { type: "free_response"; prompt: string; image?: ServedBody["image"] }
  | { type: "case"; vignette: string; image?: ServedBody["image"]; parts: View[] };

interface Presented {
  position: number;
  total: number;
  questionId: string;
  type: QuestionType;
  view: View;
  selfGraded: boolean;
}

interface SessionView {
  id: string;
  scope: { kind: string; [k: string]: unknown };
  status: "active" | "finished" | "abandoned";
  startedAt: string;
  finishedAt: string | null;
  total: number;
  answered: number;
  shortfall: number;
  items: Array<{
    position: number;
    questionId: string;
    type: QuestionType;
    answered: boolean;
    skipped: boolean;
  }>;
}

interface ServerReveal {
  type: string;
  explanation: string;
  back?: string;
  modelAnswer?: string;
  rubric?: Array<{ point: string; points: number }>;
  parts?: Array<ServerReveal | null>;
}

interface QuestionSummary {
  id: string;
  type: QuestionType;
  text: string;
  tags: string[];
  nodeIds: string[];
}

const UNIT_CHOICES = [
  "mg",
  "g",
  "kg",
  "mcg",
  "mL",
  "L",
  "mg/mL",
  "mg/kg",
  "mcg/kg/min",
  "mg/min",
  "mL/hr",
  "mEq",
  "units",
  "%",
  "hr",
  "min",
];

const FLASH_INTERVALS = { again: 0, hard: 1, good: 3, easy: 7 } as const;

const part = (view: View): ServedPart => servedBody(view) as ServedPart;

/** Server question view to the module's served question body. */
function servedBody(view: View): ServedBody {
  const image = view.image ? { image: view.image } : {};
  switch (view.type) {
    case "multiple_choice":
    case "select_all":
      return { type: view.type, prompt: view.prompt, options: view.options, ...image };
    case "matching":
      return {
        type: "matching",
        prompt: view.prompt,
        lefts: view.left,
        rights: view.right,
        ...image,
      };
    case "fill_blank":
      return {
        type: "fill_blank",
        text: view.text,
        blanks: Array.from({ length: view.blankCount }, () => ({ width: 14 })),
        ...image,
      };
    case "calculation":
      return {
        type: "calculation",
        prompt: view.prompt,
        unitChoices: UNIT_CHOICES,
        allowFractions: true,
        ...image,
      };
    case "flashcard":
      return { type: "flashcard", front: view.front, ...image };
    case "free_response":
      return { type: "free_response", prompt: view.prompt, rubricSize: 0, ...image };
    case "case":
      return { type: "case", vignette: view.vignette, parts: view.parts.map(part), ...image };
  }
}

const served = (p: Presented): ServedQuestion => ({
  ...servedBody(p.view),
  index: p.position,
  questionId: p.questionId,
  tags: [],
  difficulty: 3,
  generalKnowledge: false,
});

/** Minimal question for a result row when the original view is no longer at hand (after a reload). */
function placeholder(
  position: number,
  questionId: string,
  type: QuestionType,
  text: string | null,
): ServedQuestion {
  const base = { index: position, questionId, tags: [], difficulty: 3, generalKnowledge: false };
  const prompt = text ?? "This question was deleted.";
  if (type === "flashcard") return { ...base, type: "flashcard", front: prompt };
  return { ...base, type: "free_response", prompt, rubricSize: 0 };
}

export function createRealPracticeStore(http: AppHttp): PracticeStore {
  const seen = new Map<string, ServedQuestion>(); // `${session}:${position}` -> what she saw
  const outcomes = new Map<string, QuestionOutcome>();
  const names = new Map<string, Promise<string>>();
  const nodeName = (id: string): Promise<string> => {
    let found = names.get(id);
    if (!found) {
      found = http
        .get<{ node: { name: string } }>(`/nodes/${id}`)
        .then((r) => r.node.name)
        .catch(() => "Library");
      names.set(id, found);
    }
    return found;
  };

  async function scopeLabel(scope: SessionView["scope"]): Promise<string> {
    switch (scope.kind) {
      case "nodes": {
        const ids = scope.nodeIds as string[];
        const first = ids[0] ? await nodeName(ids[0]) : "Library";
        return ids.length > 1 ? `${first} and ${ids.length - 1} more` : first;
      }
      case "exam": {
        try {
          const r = await http.get<{ exam: { title: string } }>(`/exams/${scope.examId}`);
          return r.exam.title;
        } catch {
          return "Exam";
        }
      }
      case "missed":
        return "Missed questions";
      case "due":
        return "Cards due today";
      case "concepts":
        return "Concepts";
      default:
        return "Everything";
    }
  }

  async function sessionState(id: string): Promise<SessionState> {
    const { session } = await http.get<{ session: SessionView }>(`/practice/sessions/${id}`);
    const items = session.items.map((i) => ({
      index: i.position,
      type: i.type,
      status: (i.answered ? "answered" : i.skipped ? "skipped" : "pending") as ItemStatus,
    }));
    const finished = session.status !== "active";
    const pending = items.filter((i) => i.status === "pending");
    const skippedLeft = items.filter((i) => i.status === "skipped");
    const nextIndex = (pending[0] ?? skippedLeft[0])?.index;
    let current: ServedQuestion | null = null;
    if (!finished && nextIndex !== undefined) {
      const r = await http.get<{ answered: boolean; question?: Presented }>(
        `/practice/sessions/${id}/items/${nextIndex}`,
      );
      if (r.question) {
        current = served(r.question);
        seen.set(`${id}:${nextIndex}`, current);
      }
    }
    return {
      id,
      scopeLabel: await scopeLabel(session.scope),
      total: session.total,
      shortfall: session.shortfall,
      items,
      status: finished ? "finished" : "active",
      current,
      answered: session.answered,
      skipped: skippedLeft.length,
      onlySkippedLeft: pending.length === 0 && skippedLeft.length > 0,
      elapsedMs:
        Date.parse(session.finishedAt ?? new Date().toISOString()) - Date.parse(session.startedAt),
      startedAt: session.startedAt,
    };
  }

  async function mapResults(id: string): Promise<SessionResults> {
    const r = await http.get<{
      session: SessionView;
      items: Array<{
        position: number;
        questionId: string;
        type: QuestionType;
        text: string | null;
        answered: boolean;
        answer: practice.Answer | null;
        result: QuestionOutcome["result"] | null;
        timeTakenMs: number | null;
      }>;
    }>(`/practice/sessions/${id}/results`);
    return {
      sessionId: id,
      scopeLabel: await scopeLabel(r.session.scope),
      startedAt: r.session.startedAt,
      finishedAt: r.session.finishedAt,
      items: r.items.map((i) => ({
        index: i.position,
        question:
          seen.get(`${id}:${i.position}`) ?? placeholder(i.position, i.questionId, i.type, i.text),
        status: (i.answered ? "answered" : "skipped") as ItemStatus,
        answer: i.answer,
        outcome:
          outcomes.get(`${id}:${i.position}`) ??
          (i.result
            ? {
                index: i.position,
                questionId: i.questionId,
                result: i.result,
                explanation: "",
                citations: [],
                generalKnowledge: false,
                notebook: null,
              }
            : null),
        timeTakenMs: i.timeTakenMs ?? 0,
      })),
      weakest: null,
    };
  }

  const countsOf = (items: Array<{ type: QuestionType }>): Record<QuestionType, number> => {
    const out = Object.fromEntries(QUESTION_TYPES.map((t) => [t, 0])) as Record<
      QuestionType,
      number
    >;
    for (const q of items) out[q.type] += 1;
    return out;
  };

  const listQuestions = (query: Record<string, string | number>) =>
    http
      .get<{ items: QuestionSummary[] }>("/practice/questions", { limit: 200, ...query })
      .then((r) => r.items);

  // ---------------------------------------------------------------------------------- exams
  type ExamDetail = {
    id: string;
    courseId: string;
    courseName: string;
    title: string;
    date: string;
    nodeIds: string[];
    createdAt?: string;
    daysRemaining: number;
    coverage: Array<{ nodeId: string; name: string; path: string }>;
    progress: {
      questions: number;
      attempted: number;
      accuracy: number | null;
      dueCards: number;
      notebook: number;
    };
  };

  async function toSummary(e: ExamDetail): Promise<ExamSummary> {
    const coverage = await Promise.all(
      e.coverage.map(async (c) => ({
        id: c.nodeId,
        title: c.name,
        path: c.path,
        questionCount: (await listQuestions({ nodeId: c.nodeId })).length,
      })),
    );
    return {
      id: e.id,
      course: e.courseName,
      title: e.title,
      date: e.date,
      nodeIds: e.nodeIds,
      createdAt: e.createdAt ?? "",
      daysRemaining: e.daysRemaining,
      coverage,
      progress: progressOf(e),
    };
  }
  const progressOf = (e: ExamDetail): ExamProgress => ({
    questionCount: e.progress.questions,
    attempted: e.progress.attempted,
    accuracy: e.progress.accuracy,
    inNotebook: e.progress.notebook,
    dueCards: e.progress.dueCards,
  });
  const examDetail = (id: string) =>
    http.get<{ exam: ExamDetail }>(`/exams/${id}`).then((r) => r.exam);

  /** The course that holds these nodes: the exam must belong to one. */
  async function courseOf(nodeIds: readonly string[], fallbackName?: string): Promise<string> {
    for (const id of nodeIds) {
      const { node } = await http.get<{ node: { kind: string; id: string; ancestors: string[] } }>(
        `/nodes/${id}`,
      );
      if (node.kind === "course") return node.id;
      for (const ancestor of node.ancestors) {
        const a = await http.get<{ node: { kind: string; id: string } }>(`/nodes/${ancestor}`);
        if (a.node.kind === "course") return a.node.id;
      }
    }
    if (fallbackName) {
      const found = await http.get<{
        items: Array<{ kind: string; node?: { id: string; kind: string; name: string } }>;
      }>("/search", { q: fallbackName, kinds: "node", limit: 10 });
      const hit = found.items.find((h) => h.kind === "node" && h.node?.kind === "course");
      if (hit?.node) return hit.node.id;
    }
    throw new Error(
      "Pick at least one lecture or folder, so the exam can be placed in its course.",
    );
  }

  return {
    // ------------------------------------------------------------------------- start screen
    async getOverview(options) {
      const [all, notebook, due, exams, active] = await Promise.all([
        listQuestions({}),
        http.get<{ counts: { total: number } }>("/practice/notebook"),
        http.get<{ counts: { due: number } }>("/practice/due", { limit: 1 }),
        http.get<{ items: ExamDetail[] }>("/exams", { limit: 20 }),
        http.get<{ items: SessionView[] }>("/practice/sessions", { status: "active", limit: 1 }),
      ]);
      const scopes: PracticeScopeOption[] = [];
      const nodeScope = async (nodeId: string): Promise<PracticeScopeOption | null> => {
        const qs = await listQuestions({ nodeId });
        if (qs.length === 0) return null;
        return {
          id: `node:${nodeId}`,
          kind: "node",
          label: await nodeName(nodeId),
          scope: { kind: "nodes", nodeIds: [nodeId] },
          counts: countsOf(qs),
          total: qs.length,
        };
      };
      if (options?.currentNodeId) {
        const here = await nodeScope(options.currentNodeId);
        if (here) scopes.push({ ...here, detail: "What you are looking at" });
      }
      for (const e of exams.items) {
        const qs = await listQuestions({ examId: e.id });
        scopes.push({
          id: `exam:${e.id}`,
          kind: "exam",
          label: e.title,
          detail: e.daysRemaining >= 0 ? `In ${e.daysRemaining} days` : undefined,
          scope: { kind: "exam", examId: e.id },
          counts: countsOf(qs),
          total: qs.length,
        } as PracticeScopeOption);
      }
      const missedQuestions = notebook.counts.total;
      scopes.push({
        id: "missed",
        kind: "missed",
        label: "Missed questions",
        detail: "Your notebook",
        scope: { kind: "missed" },
        counts: countsOf([]),
        total: missedQuestions,
      });
      scopes.push({
        id: "due",
        kind: "due",
        label: "Cards due today",
        scope: { kind: "all" },
        dueOnly: true,
        counts: { ...countsOf([]), flashcard: due.counts.due },
        total: due.counts.due,
      });
      const seenNodes = new Set(options?.currentNodeId ? [options.currentNodeId] : []);
      for (const q of all) {
        for (const nodeId of q.nodeIds) {
          if (seenNodes.has(nodeId) || seenNodes.size > 8) continue;
          seenNodes.add(nodeId);
          const s = await nodeScope(nodeId);
          if (s) scopes.push(s);
        }
      }
      scopes.push({
        id: "all",
        kind: "all",
        label: "Everything",
        scope: { kind: "all" },
        counts: countsOf(all),
        total: all.length,
      });
      const first = active.items[0];
      const unfinished: UnfinishedSession | null = first
        ? {
            id: first.id,
            scopeLabel: await scopeLabel(first.scope),
            total: first.total,
            answered: first.answered,
            startedAt: first.startedAt,
          }
        : null;
      return {
        scopes,
        dueToday: due.counts.due,
        notebookSize: missedQuestions,
        unfinished,
      } satisfies PracticeOverview;
    },

    async startSession(request: StartRequest) {
      let scope: Record<string, unknown> = request.scope as Record<string, unknown>;
      if (request.dueOnly) {
        scope = { kind: "due" };
        if (request.scope.kind === "exam") scope = { kind: "due", examId: request.scope.examId };
        if (request.scope.kind === "nodes") scope = { kind: "due", nodeIds: request.scope.nodeIds };
      }
      const r = await http.post<{ session: SessionView }>("/practice/sessions", {
        scope,
        formats: request.formats,
        length: request.length,
      });
      return sessionState(r.session.id);
    },

    async getUnfinishedSession() {
      const r = await http.get<{ items: SessionView[] }>("/practice/sessions", {
        status: "active",
        limit: 1,
      });
      const s = r.items[0];
      return s
        ? {
            id: s.id,
            scopeLabel: await scopeLabel(s.scope),
            total: s.total,
            answered: s.answered,
            startedAt: s.startedAt,
          }
        : null;
    },

    getSession: sessionState,

    async submitAnswer(sessionId, index, answer, timeTakenMs) {
      const r = await http.post<{
        result: QuestionOutcome["result"];
        reveal: ServerReveal;
        citations: QuestionOutcome["citations"];
        generalKnowledge: boolean;
      }>(`/practice/sessions/${sessionId}/answer`, { position: index, answer, timeTakenMs });
      const outcome: QuestionOutcome = {
        index,
        questionId: seen.get(`${sessionId}:${index}`)?.questionId ?? "",
        result: r.result,
        explanation: r.reveal.explanation ?? "",
        ...(r.reveal.parts
          ? { partExplanations: r.reveal.parts.map((p) => p?.explanation ?? "") }
          : {}),
        citations: r.citations,
        generalKnowledge: r.generalKnowledge,
        notebook: null,
      };
      outcomes.set(`${sessionId}:${index}`, outcome);
      return outcome;
    },

    async reveal(sessionId, index, partIndex) {
      const r = await http.post<{ reveal: ServerReveal }>(
        `/practice/sessions/${sessionId}/reveal`,
        { position: index },
      );
      const key = partIndex !== undefined ? (r.reveal.parts?.[partIndex] ?? r.reveal) : r.reveal;
      if (key.type === "flashcard") {
        return {
          type: "flashcard",
          back: key.back ?? "",
          explanation: key.explanation,
          intervals: { ...FLASH_INTERVALS },
        } as Reveal;
      }
      return {
        type: "free_response",
        modelAnswer: key.modelAnswer ?? "",
        rubric: key.rubric ?? [],
      } as Reveal;
    },

    async skip(sessionId, index) {
      await http.post(`/practice/sessions/${sessionId}/skip`, { position: index });
      return sessionState(sessionId);
    },

    async finishSession(sessionId) {
      await http.post(`/practice/sessions/${sessionId}/finish`);
      return mapResults(sessionId);
    },

    async abandonSession(sessionId) {
      await http.post(`/practice/sessions/${sessionId}/abandon`);
    },

    getResults: mapResults,

    async listNotebook() {
      const r = await http.get<{
        items: Array<{
          questionId: string;
          type: QuestionType;
          timesMissed: number;
          firstMissedAt: string;
          lastMissedAt: string;
          correctRun: number;
          stillNeeds: number;
          question: QuestionSummary;
          reason?: string | null;
        }>;
      }>("/practice/notebook");
      return Promise.all(
        r.items.map(
          async (i): Promise<NotebookItem> => ({
            entry: {
              questionId: i.questionId,
              type: i.type,
              timesMissed: i.timesMissed,
              firstMissedAt: i.firstMissedAt,
              lastMissedAt: i.lastMissedAt,
              correctRun: i.correctRun,
              stillNeeds: i.stillNeeds,
            },
            promptText: practice.blanksAsGaps(i.question.text),
            tags: i.question.tags,
            reason: i.reason ?? null,
            leaveRule:
              i.type === "calculation"
                ? "Two correct answers in a row take it out."
                : "One correct answer takes it out.",
            origin: i.question.nodeIds[0] ? await nodeName(i.question.nodeIds[0]) : "Library",
          }),
        ),
      );
    },

    async getWeakAreas() {
      const r = await http.get<{
        byTag: Array<AreaRow["stat"] & { label: string }>;
        byConcept: Array<AreaRow["stat"] & { label: string }>;
        byNode: Array<AreaRow["stat"] & { label: string }>;
        unmatchedAttempts: number;
        thresholds: { minAttempts: number; minQuestions: number; weakBelow: number };
      }>("/practice/weak-areas");
      const rows = (kind: AreaRow["kind"], list: typeof r.byTag): AreaRow[] =>
        list.map((s) => ({
          kind,
          key: s.key,
          label: s.label ?? s.key,
          stat: s,
          practiceScope:
            kind === "node"
              ? ({ kind: "nodes", nodeIds: [s.key] } as SessionScope)
              : kind === "concept"
                ? ({ kind: "concepts", conceptIds: [s.key] } as SessionScope)
                : null,
        }));
      const total = Math.max(
        0,
        ...[r.byTag, r.byConcept, r.byNode].map((l) => l.reduce((n, s) => n + s.attempts, 0)),
      );
      return {
        byTag: rows("tag", r.byTag),
        byConcept: rows("concept", r.byConcept),
        byNode: rows("node", r.byNode),
        unmatchedAttempts: r.unmatchedAttempts,
        totalAttempts: total,
        thresholds: r.thresholds,
      } satisfies WeakAreasView;
    },

    async getDueByDay() {
      const r = await http.get<{
        counts: {
          due: number;
          new: number;
          total: number;
          byDay: Array<{ date: string; count: number }>;
        };
      }>("/practice/due", { limit: 1 });
      return {
        today: r.counts.due,
        newCards: r.counts.new,
        totalCards: r.counts.total,
        days: r.counts.byDay,
      } satisfies DueByDay;
    },

    // ---------------------------------------------------------------------------------- exams
    async listExams() {
      const list = await http.get<{ items: Array<{ id: string }> }>("/exams", { limit: 50 });
      return Promise.all(list.items.map(async (e) => toSummary(await examDetail(e.id))));
    },
    async createExam(input: ExamInput) {
      const courseId = await courseOf(input.nodeIds, input.course);
      const r = await http.post<{ exam: ExamDetail }>("/exams", {
        courseId,
        title: input.title,
        date: input.date,
        nodeIds: input.nodeIds,
      });
      return toSummary(r.exam);
    },
    async updateExam(id, patch) {
      const body: Record<string, unknown> = {};
      if (patch.title !== undefined) body.title = patch.title;
      if (patch.date !== undefined) body.date = patch.date;
      if (patch.nodeIds !== undefined) body.nodeIds = patch.nodeIds;
      const r = await http.patch<{ exam: ExamDetail }>(`/exams/${id}`, body);
      return toSummary(r.exam);
    },
    async deleteExam(id) {
      await http.del(`/exams/${id}`);
    },
    async examProgress(id) {
      return progressOf(await examDetail(id));
    },
  };
}
