/**
 * In-memory PracticeStore over the invented bank. Grading, scheduling, notebook and weak areas come
 * from the shared pure functions in @notes/schema; the answer key stays inside this file's state and
 * only the stripped shape (see strip.ts) is ever handed to the player, like the real server.
 */
import { practice } from "@notes/schema";
import type { CoverageNode, ExamInput, ExamProgress, ExamSummary } from "../../exams/types";
import { addDays, daysBetween, localDate, parseLocalDate, startOfDay } from "../lib/dates";
import type {
  Answer,
  AreaRow,
  DueByDay,
  NotebookItem,
  PracticeOverview,
  PracticeScopeOption,
  PracticeStore,
  QuestionOutcome,
  QuestionType,
  ResultItem,
  Reveal,
  SessionResults,
  SessionScope,
  SessionState,
  StartRequest,
  WeakAreasView,
} from "../types";
import { PracticeApiError, QUESTION_TYPES } from "../types";
import { BANK, CONCEPTS, fid, NODE_COURSE, NODE_L7, NODE_L8, NODES, nodeOf, nodesOf } from "./bank";
import { type AnswerKey, answerKey, buildAnswer } from "./key";
import { serveQuestion } from "./strip";

type Question = practice.Question;
type Attempt = practice.Attempt;
type CardState = practice.CardState;
type ItemStatus = "pending" | "answered" | "skipped";

/** New flashcards introduced per day. */
export const NEW_CARDS_PER_DAY = 5;

interface SessionRec {
  session: practice.PracticeSession;
  scopeLabel: string;
  dueOnly: boolean;
  status: ItemStatus[];
  answers: (Answer | null)[];
  outcomes: (QuestionOutcome | null)[];
  times: number[];
  abandoned: boolean;
}

interface Exam extends ExamInput {
  id: string;
  createdAt: string;
}

interface State {
  attempts: Attempt[];
  sessions: SessionRec[];
  cards: Record<string, CardState>;
  exams: Exam[];
  examSeq: number;
  sessionSeq: number;
}

export interface MockOptions {
  /** The clock. Default: real time. */
  now?: () => Date;
  /** Base seed for sessions. Default 20261115. */
  seed?: number;
  /** "demo" starts with a week of invented history, flashcard schedules and two exams. */
  start?: "empty" | "demo";
  /** Persist state here (localStorage in the demo) so a reload resumes. */
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  storageKey?: string;
}

export interface MockPracticeStore extends PracticeStore {
  /** Test support: the UI-level answer key for a session's question. Not part of PracticeStore. */
  debugKey(sessionId: string, index: number): AnswerKey;
  /** Test support: wipe everything back to the starting state. */
  reset(): void;
  /** The shared bank, for tests. */
  readonly bank: readonly Question[];
}

const byId = new Map(BANK.map((q) => [q.id, q]));
const hasVariants = (q: Question) =>
  q.type === "calculation" ||
  (q.type === "case" && q.questions.some((p) => p.type === "calculation"));

function emptyState(): State {
  return { attempts: [], sessions: [], cards: {}, exams: [], examSeq: 0, sessionSeq: 0 };
}

// ----------------------------------------------------------------- seeding
function seedDemo(state: State, now: Date) {
  const rng = practice.makeRng(7);
  const bias = (q: Question) => {
    if (q.tags.includes("adverse-effects")) return 0.45;
    if (q.tags.includes("dosing")) return 0.5;
    if (q.tags.includes("mechanism") || q.tags.includes("names")) return 0.88;
    return 0.72;
  };
  let tick = 0;
  for (const q of BANK) {
    if (q.type === "flashcard") continue;
    const lecture = nodesOf(q.id)[0] === NODE_L7 ? 7 : 8;
    const n = lecture === 7 ? 2 : Number(q.id.slice(-2)) % 3 === 0 ? 1 : 0;
    for (let k = 0; k < n; k++) {
      const ok = rng() < bias(q);
      const seed = practice.deriveSeed(99, q.id, k);
      const answer = buildAnswer(q, seed, ok ? "right" : "wrong");
      const at = new Date(now.getTime() - (9 - k * 3 - (tick % 3)) * 86_400_000 + tick * 61_000);
      tick++;
      state.attempts.push({
        id: fid("att", tick),
        sessionId: null,
        questionId: q.id,
        variantSeed: hasVariants(q) ? seed : null,
        answer,
        result: practice.grade(q, answer, { variantSeed: seed }),
        timeTakenMs: 20_000 + Math.floor(rng() * 40_000),
        at: at.toISOString(),
      });
    }
  }
  // Flashcards: a spread of schedules over the next two weeks, two due today, two new.
  const flash = BANK.filter((q) => q.type === "flashcard");
  flash.forEach((q, i) => {
    if (i >= flash.length - 2) return;
    let t = addDays(now, -(9 + (i % 3)));
    let card = practice.newCard(t);
    const stopEarly = i % 4 === 0;
    for (let step = 0; step < 6; step++) {
      const out = practice.reviewCard(card, i % 2 ? "easy" : "good", t);
      const due = new Date(out.card.due);
      if (stopEarly && due.getTime() > now.getTime()) break;
      card = out.card;
      t = due;
      if (due.getTime() > now.getTime()) break;
    }
    state.cards[q.id] = card;
  });
  const day = (n: number) => localDate(addDays(now, n));
  state.exams.push(
    {
      id: fid("exm", 1),
      course: "Cardiovascular Pharmacology",
      title: "Quiz 3: Beta-blockers",
      date: day(3),
      nodeIds: [NODE_L7],
      createdAt: now.toISOString(),
    },
    {
      id: fid("exm", 2),
      course: "Cardiovascular Pharmacology",
      title: "Midterm",
      date: day(12),
      nodeIds: [NODE_L7, NODE_L8],
      createdAt: now.toISOString(),
    },
  );
  state.examSeq = 2;
}

// ------------------------------------------------------------------- store
export function createMockStore(options: MockOptions = {}): MockPracticeStore {
  const clock = options.now ?? (() => new Date());
  const baseSeed = options.seed ?? 20261115;
  const storage = options.storage ?? null;
  const key = options.storageKey ?? "notes-practice-mock";
  const start = options.start ?? "empty";

  const fresh = (): State => {
    const s = emptyState();
    if (start === "demo") seedDemo(s, clock());
    return s;
  };
  const load = (): State => {
    try {
      const text = storage?.getItem(key);
      if (text) return JSON.parse(text) as State;
    } catch {
      // unreadable saved state: start fresh
    }
    return fresh();
  };
  let state: State = load();
  const save = () => {
    try {
      storage?.setItem(key, JSON.stringify(state));
    } catch {
      // storage full or blocked: carry on in memory
    }
  };
  const wait = async () => {
    await Promise.resolve();
  };

  const question = (id: string): Question => {
    const q = byId.get(id);
    if (!q) throw new PracticeApiError(404, `No question ${id}`);
    return q;
  };
  const rec = (id: string): SessionRec => {
    const r = state.sessions.find((s) => s.session.id === id);
    if (!r) throw new PracticeApiError(404, `No session ${id}`);
    return r;
  };

  // ---------------------------------------------------------------- exams
  const examIdsOf = (questionId: string): string[] => {
    const nodes = nodesOf(questionId);
    return state.exams.filter((e) => e.nodeIds.some((n) => nodes.includes(n))).map((e) => e.id);
  };
  const pool = (): practice.PoolQuestion[] =>
    BANK.map((question) => ({
      question,
      nodeIds: nodesOf(question.id),
      examIds: examIdsOf(question.id),
    }));
  const questionsIn = (nodeIds: readonly string[]): Question[] =>
    BANK.filter((q) => nodesOf(q.id).some((n) => nodeIds.includes(n)));

  const cardOf = (q: Question, now: Date): CardState => state.cards[q.id] ?? practice.newCard(now);
  const isDueCard = (q: Question, now: Date, newBudget: { left: number }): boolean => {
    const c = state.cards[q.id];
    if (!c || c.phase === "new") {
      if (newBudget.left <= 0) return false;
      newBudget.left--;
      return true;
    }
    return startOfDay(new Date(c.due)).getTime() <= startOfDay(now).getTime();
  };
  const dueQuestionIds = (now: Date, within?: ReadonlySet<string>): string[] => {
    const budget = { left: NEW_CARDS_PER_DAY };
    return BANK.filter(
      (q) => q.type === "flashcard" && (!within || within.has(q.id)) && isDueCard(q, now, budget),
    ).map((q) => q.id);
  };

  const countsOf = (qs: readonly Question[]) => {
    const counts = Object.fromEntries(QUESTION_TYPES.map((t) => [t, 0])) as Record<
      QuestionType,
      number
    >;
    for (const q of qs) counts[q.type]++;
    return counts;
  };

  const coverage = (e: Exam): CoverageNode[] =>
    e.nodeIds.flatMap((id) => {
      const n = nodeOf(id);
      return n
        ? [{ id, title: n.title, path: n.path, questionCount: questionsIn([id]).length }]
        : [];
    });

  const progressOf = (e: Exam): ExamProgress => {
    const qs = questionsIn(e.nodeIds);
    const ids = new Set(qs.map((q) => q.id));
    const mine = state.attempts.filter((a) => ids.has(a.questionId));
    const correct = mine.filter((a) => a.result.correct).length;
    const missed = new Set(practice.notebookQuestionIds(state.attempts));
    return {
      questionCount: qs.length,
      attempted: new Set(mine.map((a) => a.questionId)).size,
      accuracy: mine.length ? correct / mine.length : null,
      inNotebook: qs.filter((q) => missed.has(q.id)).length,
      dueCards: dueQuestionIds(clock(), ids).length,
    };
  };

  const summary = (e: Exam): ExamSummary => ({
    ...e,
    daysRemaining: daysBetween(clock(), parseLocalDate(e.date)),
    coverage: coverage(e),
    progress: progressOf(e),
  });

  const checkExam = (input: Partial<ExamInput>, partial: boolean) => {
    if (!partial || input.title !== undefined) {
      if (!input.title?.trim()) throw new PracticeApiError(400, "Give the exam a title.");
    }
    if (!partial || input.date !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date ?? ""))
        throw new PracticeApiError(400, "Pick a date.");
    }
    if (!partial || input.course !== undefined) {
      if (!input.course?.trim()) throw new PracticeApiError(400, "Name the course.");
    }
  };

  // ------------------------------------------------------------- sessions
  const stateOf = (r: SessionRec): SessionState => {
    const items = r.session.items;
    let cursor = r.status.findIndex((s) => s === "pending");
    if (cursor < 0) cursor = r.status.findIndex((s) => s === "skipped");
    const pendingLeft = r.status.some((s) => s === "pending");
    const skippedLeft = r.status.some((s) => s === "skipped");
    const item = items[cursor];
    return {
      id: r.session.id,
      scopeLabel: r.scopeLabel,
      total: items.length,
      shortfall: practice.sessionShortfall(r.session),
      items: items.map((it, index) => ({
        index,
        type: it.type,
        status: r.status[index] as ItemStatus,
      })),
      status: r.session.finishedAt ? "finished" : "active",
      current:
        item && cursor >= 0 && !r.session.finishedAt
          ? serveQuestion(question(item.questionId), item, cursor)
          : null,
      answered: r.status.filter((s) => s === "answered").length,
      skipped: r.status.filter((s) => s === "skipped").length,
      onlySkippedLeft: !pendingLeft && skippedLeft,
      elapsedMs: r.times.reduce((a, b) => a + b, 0),
      startedAt: r.session.startedAt,
    };
  };

  const scopeLabel = (scope: SessionScope, dueOnly: boolean): string => {
    if (dueOnly) return "Flashcards due today";
    switch (scope.kind) {
      case "nodes":
        return scope.nodeIds.map((n) => nodeOf(n)?.title ?? "Folder").join(", ");
      case "concepts":
        return scope.conceptIds.map((c) => CONCEPTS[c] ?? "Topic").join(", ");
      case "exam":
        return state.exams.find((e) => e.id === scope.examId)?.title ?? "Exam";
      case "missed":
        return "Missed questions";
      case "all":
        return "Everything";
    }
  };

  const leaveRule = (type: QuestionType, entry: practice.NotebookEntry): string => {
    const need = practice.NOTEBOOK_CORRECT_RUN[type];
    if (need <= 1) return "Answer it correctly once and it leaves the notebook.";
    return entry.correctRun > 0
      ? `Answer it correctly ${need} times in a row to clear it (${entry.correctRun} of ${need} so far). A miss starts the count again.`
      : `Answer it correctly ${need} times in a row to clear it. A miss starts the count again.`;
  };

  const notebook = (): practice.NotebookEntry[] => practice.notebookEntries(state.attempts);

  const labels = (): practice.QuestionLabels[] =>
    BANK.map((q) => ({
      questionId: q.id,
      tags: q.tags,
      conceptIds: q.conceptIds,
      nodeIds: nodesOf(q.id),
    }));

  const store: MockPracticeStore = {
    bank: BANK,

    reset() {
      state = fresh();
      save();
    },

    debugKey(sessionId, index) {
      const r = rec(sessionId);
      const item = r.session.items[index];
      if (!item) throw new PracticeApiError(404, "No such question");
      return answerKey(question(item.questionId), item.variantSeed);
    },

    async getOverview(opts = {}) {
      await wait();
      const now = clock();
      const scopes: PracticeScopeOption[] = [];
      const dueIds = dueQuestionIds(now);
      const dueQs = dueIds.map(question);
      if (dueQs.length > 0) {
        scopes.push({
          id: "due",
          kind: "due",
          label: "Flashcards due today",
          detail: `${dueQs.length} ${dueQs.length === 1 ? "card" : "cards"}`,
          scope: { kind: "all" },
          dueOnly: true,
          counts: countsOf(dueQs),
          total: dueQs.length,
        });
      }
      const missedIds = new Set(notebook().map((e) => e.questionId));
      if (missedIds.size > 0) {
        const qs = BANK.filter((q) => missedIds.has(q.id));
        scopes.push({
          id: "missed",
          kind: "missed",
          label: "Missed questions",
          detail: "Your notebook",
          scope: { kind: "missed" },
          counts: countsOf(qs),
          total: qs.length,
        });
      }
      const nodeOption = (id: string): PracticeScopeOption | null => {
        const n = nodeOf(id);
        if (!n) return null;
        const qs = questionsIn([id]);
        return {
          id: `node:${id}`,
          kind: "node",
          label: n.title,
          detail: n.parent ? "Lecture" : "Folder, all lectures",
          scope: { kind: "nodes", nodeIds: [id] },
          counts: countsOf(qs),
          total: qs.length,
        };
      };
      const here = opts.currentNodeId ? nodeOption(opts.currentNodeId) : null;
      if (here) scopes.push({ ...here, detail: "Where you are now" });
      const upcoming = [...state.exams]
        .filter((e) => daysBetween(now, parseLocalDate(e.date)) >= 0)
        .sort((a, b) => (a.date < b.date ? -1 : 1));
      for (const e of upcoming) {
        const qs = questionsIn(e.nodeIds);
        const days = daysBetween(now, parseLocalDate(e.date));
        scopes.push({
          id: `exam:${e.id}`,
          kind: "exam",
          label: e.title,
          detail: days === 0 ? "Exam today" : `Exam in ${days} ${days === 1 ? "day" : "days"}`,
          scope: { kind: "exam", examId: e.id },
          counts: countsOf(qs),
          total: qs.length,
        });
      }
      for (const n of [NODE_L7, NODE_L8, NODE_COURSE]) {
        if (n === opts.currentNodeId) continue;
        const o = nodeOption(n);
        if (o) scopes.push(o);
      }
      scopes.push({
        id: "all",
        kind: "all",
        label: "Everything",
        detail: "All your material",
        scope: { kind: "all" },
        counts: countsOf(BANK),
        total: BANK.length,
      });
      return {
        scopes,
        dueToday: dueQs.length,
        notebookSize: missedIds.size,
        unfinished: await store.getUnfinishedSession(),
      } satisfies PracticeOverview;
    },

    async startSession(req: StartRequest) {
      await wait();
      const now = clock();
      let candidates = pool();
      if (req.dueOnly) {
        const due = new Set(dueQuestionIds(now));
        candidates = candidates.filter((p) => due.has(p.question.id));
      }
      if (req.questionIds) {
        const only = new Set(req.questionIds);
        candidates = candidates.filter((p) => only.has(p.question.id));
      }
      state.sessionSeq++;
      const session = practice.buildSession({
        id: fid("prs", state.sessionSeq),
        startedAt: now.toISOString(),
        scope: req.scope,
        formats: req.dueOnly ? ["flashcard"] : req.formats,
        length: req.length,
        seed: practice.deriveSeed(baseSeed, "session", state.sessionSeq),
        pool: candidates,
        history: state.attempts,
      });
      const n = session.items.length;
      const r: SessionRec = {
        session,
        scopeLabel: scopeLabel(req.scope, Boolean(req.dueOnly)),
        dueOnly: Boolean(req.dueOnly),
        status: Array<ItemStatus>(n).fill("pending"),
        answers: Array(n).fill(null),
        outcomes: Array(n).fill(null),
        times: Array(n).fill(0),
        abandoned: false,
      };
      state.sessions.push(r);
      save();
      return stateOf(r);
    },

    async getUnfinishedSession() {
      const r = [...state.sessions]
        .reverse()
        .find((s) => !s.session.finishedAt && !s.abandoned && s.session.items.length > 0);
      return r
        ? {
            id: r.session.id,
            scopeLabel: r.scopeLabel,
            total: r.session.items.length,
            answered: r.status.filter((s) => s === "answered").length,
            startedAt: r.session.startedAt,
          }
        : null;
    },

    async getSession(id) {
      await wait();
      return stateOf(rec(id));
    },

    async submitAnswer(sessionId, index, answer, timeTakenMs) {
      await wait();
      const r = rec(sessionId);
      const item = r.session.items[index];
      if (!item) throw new PracticeApiError(404, "No such question in this session.");
      const done = r.outcomes[index];
      if (done) return done;
      const q = question(item.questionId);
      const now = clock();
      const before = notebook().find((e) => e.questionId === q.id);
      const result = practice.grade(q, answer, { variantSeed: item.variantSeed });
      const attempt: Attempt = {
        id: fid("att", state.attempts.length + 1),
        sessionId: r.session.id,
        questionId: q.id,
        variantSeed: hasVariants(q) ? item.variantSeed : null,
        answer: answer as Attempt["answer"],
        result,
        timeTakenMs: Math.max(0, Math.round(timeTakenMs)),
        at: now.toISOString(),
      };
      state.attempts.push(attempt);
      if (q.type === "flashcard" && answer.type === "flashcard") {
        state.cards[q.id] = practice.reviewCard(cardOf(q, now), answer.rating, now).card;
      }
      const after = notebook().find((e) => e.questionId === q.id);
      let nb: QuestionOutcome["notebook"] = null;
      let note: string | undefined;
      if (!before && after) nb = "added";
      else if (before && after) nb = result.correct ? "progress" : "kept";
      else if (before && !after) nb = "cleared";
      if (nb === "added") note = "Added to your missed-questions notebook.";
      if (nb === "kept") note = "Still in your notebook.";
      if (nb === "progress" && after) note = leaveRule(q.type, after);
      if (nb === "cleared") note = "Out of your notebook. Nicely done.";

      let explanation =
        q.type === "calculation"
          ? practice.instantiateCalculation(q, item.variantSeed).explanation
          : q.explanation;
      let partExplanations: string[] | undefined;
      if (q.type === "case") {
        explanation = q.explanation;
        partExplanations = q.questions.map((p, i) =>
          p.type === "calculation"
            ? practice.instantiateCalculation(p, practice.deriveSeed(item.variantSeed, "part", i))
                .explanation
            : p.explanation,
        );
      }
      const outcome: QuestionOutcome = {
        index,
        questionId: q.id,
        result,
        explanation,
        ...(partExplanations ? { partExplanations } : {}),
        citations: q.sources,
        generalKnowledge: q.generalKnowledge,
        notebook: nb,
        ...(note ? { notebookNote: note } : {}),
      };
      r.status[index] = "answered";
      r.answers[index] = answer;
      r.outcomes[index] = outcome;
      r.times[index] = attempt.timeTakenMs;
      save();
      return outcome;
    },

    async reveal(sessionId, index, partIndex) {
      await wait();
      const r = rec(sessionId);
      const item = r.session.items[index];
      if (!item) throw new PracticeApiError(404, "No such question in this session.");
      const q = question(item.questionId);
      const part = q.type === "case" ? q.questions[partIndex ?? -1] : q;
      if (!part) throw new PracticeApiError(400, "Nothing to reveal here.");
      if (part.type === "flashcard") {
        const card = q.type === "flashcard" ? cardOf(q, clock()) : practice.newCard(clock());
        return {
          type: "flashcard",
          back: part.back,
          explanation: part.explanation,
          intervals: practice.nextIntervals(card, clock()),
        } satisfies Reveal;
      }
      if (part.type === "free_response") {
        return {
          type: "free_response",
          modelAnswer: part.modelAnswer,
          rubric: part.rubric.map((x) => ({ point: x.point, points: x.points })),
        } satisfies Reveal;
      }
      throw new PracticeApiError(400, "This question has nothing to reveal.");
    },

    async skip(sessionId, index) {
      await wait();
      const r = rec(sessionId);
      if (r.status[index] === "pending") r.status[index] = "skipped";
      save();
      return stateOf(r);
    },

    async finishSession(sessionId) {
      await wait();
      const r = rec(sessionId);
      r.session = { ...r.session, finishedAt: r.session.finishedAt ?? clock().toISOString() };
      save();
      return store.getResults(sessionId);
    },

    async abandonSession(sessionId) {
      await wait();
      rec(sessionId).abandoned = true;
      save();
    },

    async getResults(sessionId) {
      await wait();
      const r = rec(sessionId);
      const items: ResultItem[] = r.session.items.map((item, index) => ({
        index,
        question: serveQuestion(question(item.questionId), item, index),
        status: r.status[index] as ItemStatus,
        answer: r.answers[index] ?? null,
        outcome: r.outcomes[index] ?? null,
        timeTakenMs: r.times[index] ?? 0,
      }));
      const report = practice.weakAreas(state.attempts, labels());
      const inSession = new Set(
        r.session.items.flatMap((it) => question(it.questionId).conceptIds),
      );
      const weak = report.byConcept.find((a) => a.status === "weak" && inSession.has(a.key));
      return {
        sessionId,
        scopeLabel: r.scopeLabel,
        startedAt: r.session.startedAt,
        finishedAt: r.session.finishedAt,
        items,
        weakest: weak
          ? {
              label: CONCEPTS[weak.key] ?? "this topic",
              accuracy: weak.accuracy,
              scope: { kind: "concepts", conceptIds: [weak.key] },
            }
          : null,
      } satisfies SessionResults;
    },

    async listNotebook() {
      await wait();
      return notebook().map((entry): NotebookItem => {
        const q = question(entry.questionId);
        const last = [...state.attempts]
          .reverse()
          .find((a) => a.questionId === q.id && !a.result.correct);
        const seed = last?.variantSeed ?? 0;
        let promptText: string;
        if (q.type === "calculation") promptText = practice.instantiateCalculation(q, seed).prompt;
        else promptText = practice.questionText(q);
        const bad = last?.result.feedback.find((f) => !f.correct);
        const node = nodeOf(nodesOf(q.id)[0] as string);
        return {
          entry,
          promptText,
          tags: [...q.tags],
          reason: bad ? bad.message : null,
          leaveRule: leaveRule(q.type, entry),
          origin: node?.title ?? "",
        };
      });
    },

    async getWeakAreas() {
      await wait();
      const report = practice.weakAreas(state.attempts, labels());
      const rows = (kind: AreaRow["kind"], stats: practice.AreaStat[]): AreaRow[] =>
        stats.map((stat) => ({
          kind,
          key: stat.key,
          label:
            kind === "concept"
              ? (CONCEPTS[stat.key] ?? stat.key)
              : kind === "node"
                ? (nodeOf(stat.key)?.title ?? stat.key)
                : stat.key.replaceAll("-", " "),
          stat,
          practiceScope:
            kind === "concept"
              ? { kind: "concepts", conceptIds: [stat.key] }
              : kind === "node"
                ? { kind: "nodes", nodeIds: [stat.key] }
                : null,
        }));
      return {
        byTag: rows("tag", report.byTag),
        byConcept: rows("concept", report.byConcept),
        byNode: rows("node", report.byNode),
        unmatchedAttempts: report.unmatchedAttempts,
        totalAttempts: state.attempts.length,
        thresholds: { minAttempts: 5, minQuestions: 3, weakBelow: 0.7 },
      } satisfies WeakAreasView;
    },

    async getDueByDay(days = 14) {
      await wait();
      const now = clock();
      const counts = Array<number>(days).fill(0);
      let never = 0;
      for (const q of BANK) {
        if (q.type !== "flashcard") continue;
        const c = state.cards[q.id];
        if (!c || c.phase === "new") {
          never++;
          continue;
        }
        const off = Math.max(0, daysBetween(now, new Date(c.due)));
        if (off < days) counts[off] = (counts[off] as number) + 1;
      }
      const intro = Math.min(never, NEW_CARDS_PER_DAY);
      counts[0] = (counts[0] as number) + intro;
      return {
        today: counts[0] as number,
        newCards: never,
        totalCards: BANK.filter((q) => q.type === "flashcard").length,
        days: counts.map((count, i) => ({ date: localDate(addDays(now, i)), count })),
      } satisfies DueByDay;
    },

    // ---------------------------------------------------------------- exams
    async listExams() {
      await wait();
      return [...state.exams].sort((a, b) => (a.date < b.date ? -1 : 1)).map(summary);
    },
    async createExam(input) {
      await wait();
      checkExam(input, false);
      state.examSeq++;
      const e: Exam = {
        ...input,
        title: input.title.trim(),
        course: input.course.trim(),
        nodeIds: [...new Set(input.nodeIds)],
        id: fid("exm", state.examSeq),
        createdAt: clock().toISOString(),
      };
      state.exams.push(e);
      save();
      return summary(e);
    },
    async updateExam(id, patch) {
      await wait();
      const e = state.exams.find((x) => x.id === id);
      if (!e) throw new PracticeApiError(404, "No such exam.");
      checkExam(patch, true);
      Object.assign(e, {
        ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
        ...(patch.course !== undefined ? { course: patch.course.trim() } : {}),
        ...(patch.date !== undefined ? { date: patch.date } : {}),
        ...(patch.nodeIds !== undefined ? { nodeIds: [...new Set(patch.nodeIds)] } : {}),
      });
      save();
      return summary(e);
    },
    async deleteExam(id) {
      await wait();
      state.exams = state.exams.filter((e) => e.id !== id);
      save();
    },
    async examProgress(id) {
      await wait();
      const e = state.exams.find((x) => x.id === id);
      if (!e) throw new PracticeApiError(404, "No such exam.");
      return progressOf(e);
    },
  };

  return store;
}

export { NODES };
