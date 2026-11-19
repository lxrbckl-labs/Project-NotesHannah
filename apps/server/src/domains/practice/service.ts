import {
  type Actor,
  type Citation,
  type CitationBacklink,
  newId,
  type PageBacklinks,
  practice,
} from "@notes/schema";
import type { Db } from "../../db/client.js";
import type { AuthContext } from "../../http/auth-context.js";
import type { ServerDeps } from "../../http/deps.js";
import { AppError } from "../../http/errors.js";
import { leaveTrace, plural, type Trace } from "../activity/trace.js";
import { type SourceLookup, unknownSources } from "../documents/ports.js";
import { createExamsRepo } from "../exams/repo.js";
import {
  CreateQuestionsInput,
  type StartScope,
  StartSessionInput,
  UpdateQuestionInput,
} from "./inputs.js";
import { loadTree, nodeWords, type Tree } from "./tree.js";
import {
  hasSelfGraded,
  type QuestionView,
  questionView,
  type Reveal,
  revealOf,
  selfGradeKey,
  usesVariants,
} from "./views.js";

type Question = practice.Question;
type QuestionType = practice.QuestionType;
type CardState = practice.CardState;

export const DAY_MS = 86_400_000;
const DEFAULT_LIMIT = 50;
/** How many days ahead the due forecast looks. */
export const FORECAST_DAYS = 14;
/** Node kinds a question can live under (a practice-section folder, a lecture, a document). */
const ATTACHABLE_KINDS = ["lecture", "folder", "document"];

export interface PracticePorts extends Trace {
  /** Checks the pages and quotes that questions cite. Default: every source is allowed. */
  sources?: SourceLookup;
  /**
   * Told, inside the same transaction, when questions are deleted for good (by hand, or because
   * the last node they lived under was deleted). Her attempts stay as history.
   */
  onQuestionsDeleted?: (userId: string, questionIds: readonly string[]) => void;
}

const TYPE_WORDS: Record<string, string> = {
  multiple_choice: "multiple choice",
  select_all: "select-all",
  calculation: "calculation",
  case: "case",
  flashcard: "flashcard",
  fill_blank: "fill-in-the-blank",
  matching: "matching",
  free_response: "free-response",
};
const typeWords = (type: string) => TYPE_WORDS[type] ?? type.replaceAll("_", " ");
const snip = (text: string, max = 70) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

// ------------------------------------------------------------------ types

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface QuestionSummary {
  id: string;
  type: QuestionType;
  /** The question as a person reads it (prompt, card front, text with blanks, vignette). */
  text: string;
  difficulty: number;
  tags: string[];
  conceptIds: string[];
  /** The lectures, folders or documents it was filed under. */
  nodeIds: string[];
  review: practice.ReviewStatus;
  author: Actor;
  generalKnowledge: boolean;
  citationCount: number;
  /** Whether it has a spaced-repetition card. Flashcards always do. */
  scheduled: boolean;
  createdAt: string;
  updatedAt: string;
  trashedAt: string | null;
}

export interface QuestionDetail extends QuestionSummary {
  question: Question;
  /** Exams whose covered material includes this question. */
  examIds: string[];
  stats: { attempts: number; correct: number; lastAttemptAt: string | null };
  card: CardState | null;
}

export interface QuestionFilters {
  /** A lecture, folder or document, and everything below it. */
  nodeId?: string | undefined;
  type?: QuestionType | undefined;
  tag?: string | undefined;
  conceptId?: string | undefined;
  difficulty?: number | undefined;
  review?: practice.ReviewStatus | undefined;
  examId?: string | undefined;
  author?: "agent" | "user" | undefined;
  /** List the trash instead of live questions. */
  trashed?: boolean | undefined;
  /** Include each question's full content. */
  full?: boolean | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

export interface QuestionProblems {
  /** Position in the submitted list (0-based). */
  index: number;
  problems: practice.Problem[];
}

export interface CreateQuestionsResult {
  stored: number;
  created: QuestionSummary[];
  /** Questions that were refused (only ever non-empty when `partial` was set; otherwise the call throws). */
  problems: QuestionProblems[];
}

export interface SessionView {
  id: string;
  scope: StartScope;
  formats: QuestionType[];
  length: number;
  seed: number;
  status: "active" | "finished" | "abandoned";
  startedAt: string;
  finishedAt: string | null;
  abandonedAt: string | null;
  total: number;
  answered: number;
  /** How many questions short of the requested length the pool made it. */
  shortfall: number;
  items: Array<{
    position: number;
    questionId: string;
    type: QuestionType;
    answered: boolean;
    /** Skipped and not answered since: comes back after the questions not yet seen. */
    skipped: boolean;
  }>;
}

export interface PresentedQuestion {
  position: number;
  total: number;
  questionId: string;
  type: QuestionType;
  /** The question without its answer key. */
  view: QuestionView;
  /** She marks herself on this one (or on a part of it): ask for `reveal` before she does. */
  selfGraded: boolean;
}

export interface AttemptView {
  id: string;
  sessionId: string | null;
  position: number | null;
  questionId: string;
  variantSeed: number | null;
  answer: practice.Answer;
  result: practice.GradeResult;
  timeTakenMs: number;
  at: string;
}

export interface AnswerOutcome {
  attempt: AttemptView;
  result: practice.GradeResult;
  /** Explanation, option rationales and the like, shown now that she has answered. */
  reveal: Reveal;
  citations: Citation[];
  generalKnowledge: boolean;
  /** The new schedule when the question has a card. */
  schedule: { rating: practice.ReviewRating; intervalDays: number; due: string } | null;
  progress: { answered: number; total: number; finished: boolean };
  next: PresentedQuestion | null;
}

export interface SessionItemResult {
  position: number;
  questionId: string;
  type: QuestionType;
  /** Null when the question has been deleted for good. */
  text: string | null;
  answered: boolean;
  correct: boolean | null;
  score: number | null;
  points: number | null;
  maxPoints: number | null;
  timeTakenMs: number | null;
  answer: practice.Answer | null;
  result: practice.GradeResult | null;
  tags: string[];
  conceptIds: string[];
  nodeIds: string[];
}

export interface SessionResults {
  session: SessionView;
  summary: {
    total: number;
    answered: number;
    unanswered: number;
    correct: number;
    incorrect: number;
    /** Share of answered questions that were correct, 0 to 1; null when nothing was answered. */
    accuracy: number | null;
    points: number;
    maxPoints: number;
    /** Points over maximum points of the answered questions, 0 to 1; null when nothing was answered. */
    percent: number | null;
    /** Sum of the time spent on each answer. */
    timeTakenMs: number;
    /** Start to finish, null while the session is open. */
    durationMs: number | null;
  };
  items: SessionItemResult[];
}

export interface NotebookItem extends practice.NotebookEntry {
  question: QuestionSummary;
  /** Why it is here: the grader's first plain-language line from the last wrong attempt, or null. */
  reason: string | null;
}

export interface NotebookView {
  items: NotebookItem[];
  counts: { total: number; byType: Partial<Record<QuestionType, number>> };
}

export interface AreaView extends practice.AreaStat {
  /** For a library area: its readable path. */
  label: string | null;
}

export interface WeakAreasView {
  byTag: AreaView[];
  byConcept: AreaView[];
  byNode: AreaView[];
  unmatchedAttempts: number;
  thresholds: { minAttempts: number; minQuestions: number; weakBelow: number };
}

export interface WeakAreaOptions extends practice.WeakAreaOptions {
  /** Only questions in this lecture, folder or document (and below). */
  nodeId?: string | undefined;
}

export interface DueItem {
  question: QuestionSummary;
  card: CardState;
  /** Whole days overdue (0 when due today or new). */
  overdueDays: number;
  /** Days until the next review for each button. */
  intervals: Record<practice.ReviewRating, number>;
}

export interface DueView {
  items: DueItem[];
  counts: {
    /** Reviews due now. */
    due: number;
    /** Cards never reviewed. */
    new: number;
    /** Cards scheduled at all in this scope. */
    total: number;
    /** Reviews due on each of the next 14 days; today includes anything overdue. */
    byDay: Array<{ date: string; count: number }>;
  };
}

export interface DueOptions {
  nodeId?: string | undefined;
  examId?: string | undefined;
  type?: QuestionType | undefined;
  limit?: number | undefined;
  /** Minutes east of UTC, to decide where a day ends. Default 0. */
  utcOffsetMinutes?: number | undefined;
}

export interface CoverageStats {
  questions: number;
  attempted: number;
  attempts: number;
  correct: number;
  dueCards: number;
  newCards: number;
  notebook: number;
}

// ------------------------------------------------------------------ rows

interface QuestionRow {
  seq: number;
  id: string;
  user_id: string;
  type: QuestionType;
  difficulty: number;
  review_status: practice.ReviewStatus;
  author_type: "agent" | "user";
  author: string;
  general_knowledge: number;
  text: string;
  data: string;
  created_at: string;
  updated_at: string;
  trashed_at: string | null;
}

interface SessionRow {
  seq: number;
  id: string;
  user_id: string;
  scope: string;
  formats: string;
  length: number;
  seed: number;
  items: string;
  status: "active" | "finished" | "abandoned";
  started_at: string;
  finished_at: string | null;
  abandoned_at: string | null;
  skipped: string;
}

interface AttemptRow {
  seq: number;
  id: string;
  user_id: string;
  session_id: string | null;
  position: number | null;
  question_id: string;
  variant_seed: number | null;
  answer_type: string;
  answer: string;
  result: string;
  correct: number;
  score: number;
  time_taken_ms: number;
  at: string;
}

interface CardRow {
  seq: number;
  id: string;
  user_id: string;
  question_id: string;
  state: string;
  phase: "new" | "review";
  due: string;
  created_at: string;
  updated_at: string;
}

type AttemptLike = Parameters<typeof practice.notebookEntries>[0][number];

const VISIBLE = `q.trashed_at IS NULL AND EXISTS (
  SELECT 1 FROM question_nodes qn WHERE qn.question_id = q.id AND qn.node_trashed = 0)`;

const notFoundQuestion = () =>
  new AppError("not_found", "No such question.", {
    hint: "Question IDs look like qst_...; list them with GET /api/practice/questions.",
  });
const notFoundSession = () =>
  new AppError("not_found", "No such practice session.", {
    hint: "Session IDs look like prs_...; list yours with GET /api/practice/sessions.",
  });
const notFoundNode = (id: string) =>
  new AppError("not_found", `No such library item: ${id}.`, {
    hint: "Use the ID of a lecture, a folder or a document from GET /api/nodes.",
  });

const toIso = (ms: number) => new Date(ms).toISOString();
const json = (v: unknown) => JSON.stringify(v);

/** The calendar day of an instant, in a zone `offsetMinutes` east of UTC, as YYYY-MM-DD. */
export function localDay(ms: number, offsetMinutes = 0): string {
  return toIso(ms + offsetMinutes * 60_000).slice(0, 10);
}

export function createPracticeService(
  deps: Pick<ServerDeps, "db" | "now">,
  ports: PracticePorts = {},
) {
  const db: Db = deps.db;
  const sources = ports.sources ?? unknownSources;
  const examsRepo = createExamsRepo(db);
  const nowIso = () => toIso(deps.now());

  // ---- guards -----------------------------------------------------------

  function assertWrite(auth: AuthContext): void {
    if (auth.scope !== "write") {
      throw new AppError("read_only_key", "This API key is read-only.", {
        hint: "Create a read-write key in Settings to make changes.",
      });
    }
  }

  function assertSession(auth: AuthContext, what: string): void {
    assertWrite(auth);
    if (auth.via !== "session" || auth.actor.type !== "user") {
      throw new AppError("forbidden", `${what} needs her signed-in browser session.`, {
        hint: "Practice sessions are hers: an agent can read sessions and results, not take them.",
      });
    }
  }

  // ---- prepared statements ------------------------------------------------

  const q = {
    question: db.prepare("SELECT * FROM questions WHERE id = ? AND user_id = ?"),
    insertQuestion: db.prepare(
      `INSERT INTO questions (id, user_id, type, difficulty, review_status, author_type, author,
         general_knowledge, text, data, created_at, updated_at)
       VALUES (@id, @user_id, @type, @difficulty, @review_status, @author_type, @author,
         @general_knowledge, @text, @data, @created_at, @updated_at)`,
    ),
    updateQuestion: db.prepare(
      `UPDATE questions SET difficulty = @difficulty, review_status = @review_status,
         author_type = @author_type, author = @author, general_knowledge = @general_knowledge,
         text = @text, data = @data, updated_at = @updated_at
       WHERE id = @id AND user_id = @user_id`,
    ),
    nodesOf: db.prepare("SELECT node_id, node_trashed FROM question_nodes WHERE question_id = ?"),
    addNode: db.prepare(
      "INSERT INTO question_nodes (question_id, user_id, node_id) VALUES (?, ?, ?)",
    ),
    clearNodes: db.prepare("DELETE FROM question_nodes WHERE question_id = ?"),
    addTag: db.prepare("INSERT INTO question_tags (question_id, user_id, tag) VALUES (?, ?, ?)"),
    clearTags: db.prepare("DELETE FROM question_tags WHERE question_id = ?"),
    addConcept: db.prepare(
      "INSERT INTO question_concepts (question_id, user_id, concept_id) VALUES (?, ?, ?)",
    ),
    clearConcepts: db.prepare("DELETE FROM question_concepts WHERE question_id = ?"),
    addCitation: db.prepare(
      `INSERT INTO question_citations (question_id, user_id, file_id, page_id, quote, region)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ),
    clearCitations: db.prepare("DELETE FROM question_citations WHERE question_id = ?"),
    card: db.prepare("SELECT * FROM card_states WHERE user_id = ? AND question_id = ?"),
    insertCard: db.prepare(
      `INSERT INTO card_states (id, user_id, question_id, state, phase, due, created_at, updated_at)
       VALUES (@id, @user_id, @question_id, @state, @phase, @due, @created_at, @updated_at)`,
    ),
    updateCard: db.prepare(
      "UPDATE card_states SET state = @state, phase = @phase, due = @due, updated_at = @updated_at WHERE id = @id",
    ),
    deleteCard: db.prepare("DELETE FROM card_states WHERE user_id = ? AND question_id = ?"),
    session: db.prepare("SELECT * FROM practice_sessions WHERE id = ? AND user_id = ?"),
    insertSession: db.prepare(
      `INSERT INTO practice_sessions (id, user_id, scope, formats, length, seed, items, status, started_at)
       VALUES (@id, @user_id, @scope, @formats, @length, @seed, @items, 'active', @started_at)`,
    ),
    sessionAttempts: db.prepare("SELECT * FROM attempts WHERE session_id = ? ORDER BY position"),
    insertAttempt: db.prepare(
      `INSERT INTO attempts (id, user_id, session_id, position, question_id, variant_seed, answer_type,
         answer, result, correct, score, time_taken_ms, at)
       VALUES (@id, @user_id, @session_id, @position, @question_id, @variant_seed, @answer_type,
         @answer, @result, @correct, @score, @time_taken_ms, @at)`,
    ),
    history: db.prepare(
      "SELECT question_id, at, answer_type, correct, score FROM attempts WHERE user_id = ? ORDER BY at, seq",
    ),
  };

  const questionRow = (userId: string, id: string) =>
    q.question.get(id, userId) as QuestionRow | undefined;
  const parseQuestion = (row: QuestionRow): Question => JSON.parse(row.data) as Question;
  const nodeRowsOf = (id: string) =>
    q.nodesOf.all(id) as Array<{ node_id: string; node_trashed: number }>;

  /** A question she can see: not trashed, and filed under at least one live node. */
  function visibleRow(userId: string, id: string): QuestionRow {
    const row = questionRow(userId, id);
    if (!row) throw notFoundQuestion();
    if (row.trashed_at === null && !nodeRowsOf(id).some((n) => n.node_trashed === 0)) {
      throw notFoundQuestion();
    }
    return row;
  }

  // ---- summaries ----------------------------------------------------------

  function scheduledSet(userId: string, ids: readonly string[]): Set<string> {
    if (ids.length === 0) return new Set();
    const rows = db
      .prepare(
        "SELECT question_id FROM card_states WHERE user_id = ? AND question_id IN (SELECT value FROM json_each(?))",
      )
      .all(userId, json(ids)) as Array<{ question_id: string }>;
    return new Set(rows.map((r) => r.question_id));
  }

  function nodeMap(ids: readonly string[], liveOnly = false): Map<string, string[]> {
    const map = new Map<string, string[]>();
    if (ids.length === 0) return map;
    const rows = db
      .prepare(
        `SELECT question_id, node_id FROM question_nodes WHERE question_id IN (SELECT value FROM json_each(?))${
          liveOnly ? " AND node_trashed = 0" : ""
        } ORDER BY rowid`,
      )
      .all(json(ids)) as Array<{ question_id: string; node_id: string }>;
    for (const r of rows) {
      const list = map.get(r.question_id) ?? [];
      list.push(r.node_id);
      map.set(r.question_id, list);
    }
    return map;
  }

  function summaries(userId: string, rows: readonly QuestionRow[]): QuestionSummary[] {
    const ids = rows.map((r) => r.id);
    const nodes = nodeMap(ids);
    const cards = scheduledSet(userId, ids);
    return rows.map((row) => {
      const data = parseQuestion(row);
      return {
        id: row.id,
        type: row.type,
        text: row.text,
        difficulty: row.difficulty,
        tags: data.tags,
        conceptIds: data.conceptIds,
        nodeIds: nodes.get(row.id) ?? [],
        review: row.review_status,
        author: JSON.parse(row.author) as Actor,
        generalKnowledge: row.general_knowledge === 1,
        citationCount: data.sources.length,
        scheduled: cards.has(row.id),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        trashedAt: row.trashed_at,
      };
    });
  }

  // ---- the pool: every question she can see, with where it lives -----------

  interface PoolEntry extends practice.PoolQuestion {
    row: QuestionRow;
    /** The nodes it was filed under (live ones), before adding their ancestors. */
    direct: string[];
  }

  function loadPool(userId: string, tree: Tree, types?: readonly QuestionType[]): PoolEntry[] {
    const rows = db
      .prepare(
        `SELECT q.* FROM questions q WHERE q.user_id = ? AND ${VISIBLE}
         ${types ? "AND q.type IN (SELECT value FROM json_each(?))" : ""} ORDER BY q.seq`,
      )
      .all(...(types ? [userId, json(types)] : [userId])) as QuestionRow[];
    const nodes = new Map<string, string[]>();
    for (const r of db
      .prepare(
        "SELECT question_id, node_id FROM question_nodes WHERE user_id = ? AND node_trashed = 0",
      )
      .all(userId) as Array<{ question_id: string; node_id: string }>) {
      const list = nodes.get(r.question_id) ?? [];
      list.push(r.node_id);
      nodes.set(r.question_id, list);
    }
    const exams = examsRepo.liveCoverage(userId);
    return rows.map((row) => {
      const direct = nodes.get(row.id) ?? [];
      const chain = new Set(direct.flatMap((n) => tree.chain(n)));
      return {
        row,
        direct,
        question: parseQuestion(row),
        nodeIds: [...chain],
        examIds: exams.filter((e) => e.nodeIds.some((n) => chain.has(n))).map((e) => e.id),
      };
    });
  }

  /** All attempts, oldest first, as light records: all the pure functions need. */
  function history(userId: string): AttemptLike[] {
    const rows = q.history.all(userId) as Array<{
      question_id: string;
      at: string;
      answer_type: string;
      correct: number;
      score: number;
    }>;
    return rows.map(
      (r) =>
        ({
          questionId: r.question_id,
          at: r.at,
          answer: { type: r.answer_type },
          result: { correct: r.correct === 1, score: r.score },
        }) as unknown as AttemptLike,
    );
  }

  // ---- attaching questions to the library ------------------------------------

  function attachable(nodeIds: readonly string[], tree: Tree): string[] {
    const unique = [...new Set(nodeIds)];
    for (const id of unique) {
      const node = tree.nodes.get(id);
      if (!node) throw notFoundNode(id);
      if (node.trashed) {
        throw new AppError("invalid_input", `"${node.name}" is in the trash.`, {
          hint: "Restore it first, or file the questions somewhere else.",
        });
      }
      const ok =
        ATTACHABLE_KINDS.includes(node.kind) ||
        (node.kind === "section" && node.section === "practice");
      if (!ok) {
        throw new AppError(
          "invalid_input",
          `Questions cannot be filed under a ${node.kind} ("${node.name}").`,
          {
            hint: "File them under a lecture, a folder (for example in the Practice section) or a document.",
          },
        );
      }
    }
    return unique;
  }

  // ---- authoring checks ---------------------------------------------------------

  function sourceProblems(userId: string, input: practice.QuestionInput): practice.Problem[] {
    const citations = input.sources;
    if (citations.length === 0) return [];
    const info = sources.resolve(userId, citations);
    const out: practice.Problem[] = [];
    const example = practice.exampleFor(input.type);
    citations.forEach((_c, i) => {
      const s = info[i];
      if (!s) return;
      if (!s.exists) {
        out.push({
          path: `$.sources[${i}]`,
          message:
            "This file and page are not in her library (check both IDs; the page must belong to the file). Cite a page you read from her sources.",
          example,
        });
      } else if (s.trashed) {
        out.push({
          path: `$.sources[${i}]`,
          message: "The cited file is in the trash. Restore it, or cite another page.",
          example,
        });
      } else if (s.known && s.quoteFound === false) {
        out.push({
          path: `$.sources[${i}].quote`,
          message:
            "This quote does not occur character for character in the page's current transcript. Copy the supporting sentence exactly as it appears there.",
          example,
        });
      }
    });
    return out;
  }

  /** Check each submitted question (shape, authoring rules, cited sources). Stores nothing. */
  function validateQuestions(
    auth: AuthContext,
    inputs: readonly unknown[],
  ): {
    valid: Array<{ index: number; question: practice.QuestionInput }>;
    problems: QuestionProblems[];
  } {
    const valid: Array<{ index: number; question: practice.QuestionInput }> = [];
    const problems: QuestionProblems[] = [];
    inputs.forEach((input, index) => {
      const result = practice.validateQuestionInput(input);
      if (!result.ok) {
        problems.push({ index, problems: result.problems });
        return;
      }
      const bad = sourceProblems(auth.userId, result.question);
      if (bad.length > 0) problems.push({ index, problems: bad });
      else valid.push({ index, question: result.question });
    });
    return { valid, problems };
  }

  function problemLines(problems: readonly QuestionProblems[], max = 20): string[] {
    const lines = problems.flatMap((p) =>
      p.problems.map((x) => `questions[${p.index}] ${x.path}: ${x.message}`),
    );
    return lines.length > max
      ? [...lines.slice(0, max), `...and ${lines.length - max} more.`]
      : lines;
  }

  // ---- writing a question ---------------------------------------------------------

  function writeIndexes(userId: string, question: Question, nodeIds: readonly string[] | null) {
    if (nodeIds !== null) {
      q.clearNodes.run(question.id);
      for (const n of nodeIds) q.addNode.run(question.id, userId, n);
    }
    q.clearTags.run(question.id);
    for (const t of new Set(question.tags)) q.addTag.run(question.id, userId, t);
    q.clearConcepts.run(question.id);
    for (const c of new Set(question.conceptIds)) q.addConcept.run(question.id, userId, c);
    q.clearCitations.run(question.id);
    for (const s of question.sources) {
      q.addCitation.run(
        question.id,
        userId,
        s.fileId,
        s.pageId,
        s.quote,
        s.region ? json(s.region) : null,
      );
    }
  }

  function columns(userId: string, question: Question) {
    return {
      id: question.id,
      user_id: userId,
      type: question.type,
      difficulty: question.difficulty,
      review_status: question.review,
      author_type: question.author.type,
      author: json(question.author),
      general_knowledge: question.generalKnowledge ? 1 : 0,
      text: practice.questionText(question),
      data: json(question),
      created_at: question.createdAt,
      updated_at: question.updatedAt,
    };
  }

  /** A question as stored: provenance from the caller. Her own questions count as reviewed. */
  function stored(auth: AuthContext, input: practice.QuestionInput, now: string, id?: string) {
    const question = practice.toStoredQuestion(input, {
      author: auth.actor,
      now,
      ...(id !== undefined ? { id } : {}),
    });
    return auth.actor.type === "user" ? { ...question, review: "reviewed" as const } : question;
  }

  /** Put a question on the review schedule (a new card, due now) unless it already is. */
  function ensureCardAny(userId: string, questionId: string, now: string) {
    if (q.card.get(userId, questionId)) return;
    const card = practice.newCard(now);
    q.insertCard.run({
      id: newId("card", Date.parse(now)),
      user_id: userId,
      question_id: questionId,
      state: json(card),
      phase: card.phase,
      due: card.due,
      created_at: now,
      updated_at: now,
    });
  }

  /** Flashcards are always scheduled. */
  function ensureCard(userId: string, question: Question, now: string) {
    if (question.type === "flashcard") ensureCardAny(userId, question.id, now);
  }

  /** Create one or many questions under the given nodes. Atomic unless `partial`. */
  function createQuestions(auth: AuthContext, rawInput: unknown): CreateQuestionsResult {
    assertWrite(auth);
    const parsed = CreateQuestionsInput.safeParse(rawInput);
    if (!parsed.success) {
      throw new AppError("invalid_input", "The request is not valid.", {
        hint: parsed.error.issues
          .map((i) => `${i.path.join(".") || "(body)"}: ${i.message}`)
          .join("; "),
        example: { nodeIds: ["nod_..."], questions: [practice.exampleFor("multiple_choice")] },
      });
    }
    const input = parsed.data;
    const tree = loadTree(db, auth.userId);
    const nodeIds = attachable(input.nodeIds, tree);
    const { valid, problems } = validateQuestions(auth, input.questions);
    if (problems.length > 0 && !input.partial) {
      const first = problems[0]?.problems[0];
      throw new AppError(
        "invalid_input",
        `${problems.length} of ${input.questions.length} questions have problems; nothing was stored. First, at questions[${problems[0]?.index}] ${first?.path}: ${first?.message}`,
        {
          hint: `${problemLines(problems).join("\n")}\nFix them and send the batch again, or send "partial": true to store the valid ones.`,
          example: first?.example,
        },
      );
    }
    const now = nowIso();
    const rows = db.transaction(() => {
      const out: QuestionRow[] = [];
      for (const { question: item } of valid) {
        const question = stored(auth, item, now);
        q.insertQuestion.run(columns(auth.userId, question));
        writeIndexes(auth.userId, question, nodeIds);
        ensureCard(auth.userId, question, now);
        out.push(questionRow(auth.userId, question.id) as QuestionRow);
      }
      if (out.length > 0) {
        const byType = new Map<string, number>();
        for (const r of out) byType.set(r.type, (byType.get(r.type) ?? 0) + 1);
        const mix = [...byType].map(([t, n]) => `${n} ${typeWords(t)}`).join(", ");
        leaveTrace(ports, auth.userId, auth.actor, {
          action: "question.authored",
          objectType: "question",
          objectIds: out.map((r) => r.id),
          nodeId: nodeIds[0] ?? null,
          summary: `Wrote ${plural(out.length, "practice question")} (${mix}) for ${nodeIds
            .slice(0, 3)
            .map((n) => nodeWords(tree.nodes.get(n)))
            .join(", ")}${nodeIds.length > 3 ? " and more" : ""}`,
        });
      }
      return out;
    })();
    return { stored: rows.length, created: summaries(auth.userId, rows), problems };
  }

  // ---- reading questions ------------------------------------------------------------

  function detailOf(userId: string, row: QuestionRow): QuestionDetail {
    const [summary] = summaries(userId, [row]) as [QuestionSummary];
    const tree = loadTree(db, userId);
    const chain = new Set(
      nodeRowsOf(row.id)
        .filter((n) => n.node_trashed === 0)
        .flatMap((n) => tree.chain(n.node_id)),
    );
    const examIds = examsRepo
      .liveCoverage(userId)
      .filter((e) => e.nodeIds.some((n) => chain.has(n)))
      .map((e) => e.id);
    const stat = db
      .prepare(
        "SELECT COUNT(*) AS n, COALESCE(SUM(correct), 0) AS ok, MAX(at) AS last FROM attempts WHERE user_id = ? AND question_id = ?",
      )
      .get(userId, row.id) as { n: number; ok: number; last: string | null };
    const card = q.card.get(userId, row.id) as CardRow | undefined;
    return {
      ...summary,
      question: parseQuestion(row),
      examIds,
      stats: { attempts: stat.n, correct: stat.ok, lastAttemptAt: stat.last },
      card: card ? (JSON.parse(card.state) as CardState) : null,
    };
  }

  function getQuestion(auth: AuthContext, id: string): QuestionDetail {
    return detailOf(auth.userId, visibleRow(auth.userId, id));
  }

  function decodeSeq(cursor: string | undefined): number {
    if (cursor === undefined) return 0;
    const text = Buffer.from(cursor, "base64url").toString("utf8");
    if (!/^\d{1,15}$/.test(text)) {
      throw new AppError("invalid_input", "The cursor is not valid.", {
        hint: "Pass the nextCursor value from the previous page unchanged, or omit cursor.",
      });
    }
    return Number(text);
  }
  const encodeSeq = (seq: number) => Buffer.from(String(seq), "utf8").toString("base64url");

  /** Node ids of a node and everything below it; not_found for a node that is not hers. */
  function subtreeOf(tree: Tree, nodeId: string): string[] {
    if (!tree.nodes.has(nodeId)) throw notFoundNode(nodeId);
    return tree.subtree(nodeId);
  }

  function examNodes(userId: string, tree: Tree, examId: string): string[] {
    const exam = examsRepo.liveExam(userId, examId);
    if (!exam) {
      throw new AppError("not_found", "No such exam.", {
        hint: "Exam IDs look like exm_...; list them with GET /api/exams.",
      });
    }
    return [...new Set(exam.nodeIds.flatMap((n) => tree.subtree(n)))];
  }

  function listQuestions(
    auth: AuthContext,
    filters: QuestionFilters = {},
  ): Page<QuestionSummary | QuestionDetail> {
    const userId = auth.userId;
    const limit = Math.min(200, Math.max(1, filters.limit ?? DEFAULT_LIMIT));
    const where: string[] = ["q.user_id = @user"];
    const params: Record<string, unknown> = { user: userId, after: decodeSeq(filters.cursor) };
    where.push("q.seq > @after");
    where.push(filters.trashed ? "q.trashed_at IS NOT NULL" : VISIBLE);
    if (filters.type) {
      where.push("q.type = @type");
      params.type = filters.type;
    }
    if (filters.difficulty !== undefined) {
      where.push("q.difficulty = @difficulty");
      params.difficulty = filters.difficulty;
    }
    if (filters.review) {
      where.push("q.review_status = @review");
      params.review = filters.review;
    }
    if (filters.author) {
      where.push("q.author_type = @author");
      params.author = filters.author;
    }
    if (filters.tag) {
      where.push(
        "EXISTS (SELECT 1 FROM question_tags t WHERE t.question_id = q.id AND t.tag = @tag)",
      );
      params.tag = filters.tag.trim().toLowerCase();
    }
    if (filters.conceptId) {
      where.push(
        "EXISTS (SELECT 1 FROM question_concepts c WHERE c.question_id = q.id AND c.concept_id = @concept)",
      );
      params.concept = filters.conceptId;
    }
    const inNodes = (key: string, ids: readonly string[]) => {
      where.push(
        `EXISTS (SELECT 1 FROM question_nodes n WHERE n.question_id = q.id AND n.node_id IN (SELECT value FROM json_each(@${key})))`,
      );
      params[key] = json(ids);
    };
    if (filters.nodeId || filters.examId) {
      const tree = loadTree(db, userId);
      if (filters.nodeId) inNodes("underNode", subtreeOf(tree, filters.nodeId));
      if (filters.examId) inNodes("underExam", examNodes(userId, tree, filters.examId));
    }
    const rows = db
      .prepare(
        `SELECT q.* FROM questions q WHERE ${where.join(" AND ")} ORDER BY q.seq LIMIT ${limit + 1}`,
      )
      .all(params) as QuestionRow[];
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor = rows.length > limit && last ? encodeSeq(last.seq) : null;
    const items = filters.full ? page.map((r) => detailOf(userId, r)) : summaries(userId, page);
    return { items, nextCursor };
  }

  // ---- changing a question -----------------------------------------------------------

  function updateQuestion(auth: AuthContext, id: string, rawInput: unknown): QuestionDetail {
    assertWrite(auth);
    const parsed = UpdateQuestionInput.safeParse(rawInput);
    if (!parsed.success) {
      throw new AppError("invalid_input", "The request is not valid.", {
        hint: parsed.error.issues.map((i) => i.message).join("; "),
        example: { question: practice.exampleFor("multiple_choice") },
      });
    }
    const input = parsed.data;
    const row = visibleRow(auth.userId, id);
    const old = parseQuestion(row);
    const tree = loadTree(db, auth.userId);
    const nodeIds = input.nodeIds ? attachable(input.nodeIds, tree) : null;
    let next: Question | null = null;
    if (input.question !== undefined) {
      if (auth.actor.type === "agent" && row.review_status === "reviewed") {
        throw new AppError(
          "forbidden",
          "She has reviewed or written this question, so an agent cannot rewrite it.",
          {
            hint: "Ask her to mark it unreviewed in the app, or create a new question instead. Moving it to other nodes is allowed.",
          },
        );
      }
      const { valid, problems } = validateQuestions(auth, [input.question]);
      const first = problems[0]?.problems[0];
      if (first) {
        throw new AppError("invalid_input", `${first.path}: ${first.message}`, {
          hint: problemLines(problems).join("\n"),
          example: first.example,
        });
      }
      const item = (valid[0] as { question: practice.QuestionInput }).question;
      if (item.type !== old.type) {
        throw new AppError(
          "invalid_input",
          `A ${old.type} question cannot become a ${item.type}.`,
          { hint: "Create a new question of the other type and trash this one." },
        );
      }
      next = { ...stored(auth, item, nowIso(), old.id), createdAt: old.createdAt };
    }
    db.transaction(() => {
      if (next) {
        q.updateQuestion.run(columns(auth.userId, next));
        writeIndexes(auth.userId, next, nodeIds);
        ensureCard(auth.userId, next, nowIso());
      } else if (nodeIds) {
        q.clearNodes.run(id);
        for (const n of nodeIds) q.addNode.run(id, auth.userId, n);
        db.prepare("UPDATE questions SET updated_at = ? WHERE id = ?").run(nowIso(), id);
      }
      leaveTrace(ports, auth.userId, auth.actor, {
        action: "question.updated",
        objectType: "question",
        objectIds: [id],
        nodeId: (nodeIds ?? nodeRowsOf(id).map((n) => n.node_id))[0] ?? null,
        summary: next
          ? `Rewrote a ${typeWords(next.type)} question: "${snip(row.text)}"`
          : `Moved a ${typeWords(row.type)} question to ${(nodeIds ?? [])
              .slice(0, 3)
              .map((n) => nodeWords(tree.nodes.get(n)))
              .join(", ")}: "${snip(row.text)}"`,
      });
    })();
    return getQuestion(auth, id);
  }

  function trashQuestion(auth: AuthContext, id: string): QuestionSummary {
    assertWrite(auth);
    const row = visibleRow(auth.userId, id);
    if (row.trashed_at !== null) {
      throw new AppError("conflict", "This question is already in the trash.", {
        hint: `Restore it with POST /api/practice/questions/${id}/restore.`,
      });
    }
    db.prepare("UPDATE questions SET trashed_at = ? WHERE id = ?").run(nowIso(), id);
    leaveTrace(ports, auth.userId, auth.actor, {
      action: "question.trashed",
      objectType: "question",
      objectIds: [id],
      summary: `Moved a ${typeWords(row.type)} question to the trash: "${snip(row.text)}"`,
    });
    return summaries(auth.userId, [
      questionRow(auth.userId, id) as QuestionRow,
    ])[0] as QuestionSummary;
  }

  function restoreQuestion(auth: AuthContext, id: string): QuestionSummary {
    assertWrite(auth);
    const row = questionRow(auth.userId, id);
    if (!row) throw notFoundQuestion();
    if (row.trashed_at === null) {
      throw new AppError("conflict", "This question is not in the trash.", {
        hint: "Only trashed questions can be restored; list them with GET /api/practice/questions?trashed=true.",
      });
    }
    db.prepare("UPDATE questions SET trashed_at = NULL WHERE id = ?").run(id);
    leaveTrace(ports, auth.userId, auth.actor, {
      action: "question.restored",
      objectType: "question",
      objectIds: [id],
      summary: `Restored a ${typeWords(row.type)} question from the trash: "${snip(row.text)}"`,
    });
    return summaries(auth.userId, [
      questionRow(auth.userId, id) as QuestionRow,
    ])[0] as QuestionSummary;
  }

  /** Delete a trashed question for good. Her attempts stay as history. */
  function deleteQuestion(auth: AuthContext, id: string): void {
    assertSession(auth, "Deleting a question for good");
    const row = questionRow(auth.userId, id);
    if (!row) throw notFoundQuestion();
    if (row.trashed_at === null) {
      throw new AppError("conflict", "Only questions in the trash can be deleted for good.", {
        hint: `Trash it first with POST /api/practice/questions/${id}/trash.`,
      });
    }
    db.transaction(() => {
      db.prepare("DELETE FROM questions WHERE id = ? AND user_id = ?").run(id, auth.userId);
      leaveTrace(ports, auth.userId, auth.actor, {
        action: "question.deleted",
        objectType: "question",
        objectIds: [id],
        summary: `Deleted a ${typeWords(row.type)} question for good: "${snip(row.text)}"`,
      });
      ports.onQuestionsDeleted?.(auth.userId, [id]);
    })();
  }

  /** She marks questions reviewed (or takes it back). Only her browser session can. */
  function setReview(
    auth: AuthContext,
    ids: readonly string[],
    status: practice.ReviewStatus,
  ): { changed: number; items: QuestionSummary[] } {
    assertSession(auth, "Marking questions reviewed");
    const unique = [...new Set(ids)];
    const rows = unique.map((id) => visibleRow(auth.userId, id));
    let changed = 0;
    db.transaction(() => {
      for (const row of rows) {
        if (row.review_status === status) continue;
        const data = { ...parseQuestion(row), review: status };
        db.prepare("UPDATE questions SET review_status = ?, data = ? WHERE id = ?").run(
          status,
          json(data),
          row.id,
        );
        changed++;
      }
    })();
    return {
      changed,
      items: summaries(
        auth.userId,
        unique.map((id) => questionRow(auth.userId, id) as QuestionRow),
      ),
    };
  }

  /** Put a question of any type on the review schedule, or take it off. Flashcards always are. */
  function setSchedule(auth: AuthContext, id: string, enabled: boolean): QuestionDetail {
    assertWrite(auth);
    const row = visibleRow(auth.userId, id);
    if (row.type === "flashcard") {
      if (!enabled) {
        throw new AppError("conflict", "Flashcards are always on the review schedule.", {
          hint: "Trash the flashcard if you no longer want to see it.",
        });
      }
    } else if (enabled) {
      ensureCardAny(auth.userId, row.id, nowIso());
    } else {
      q.deleteCard.run(auth.userId, row.id);
    }
    return getQuestion(auth, id);
  }

  /** Questions that cite a page or any page of a file (K5). */
  function citedBy(
    auth: AuthContext,
    target: { pageId?: string; fileId?: string },
    opts: { cursor?: string | undefined; limit?: number | undefined } = {},
  ): PageBacklinks & { nextCursor: string | null } {
    const limit = Math.min(200, Math.max(1, opts.limit ?? DEFAULT_LIMIT));
    const after = decodeSeq(opts.cursor);
    const col = target.pageId ? "page_id" : "file_id";
    const value = target.pageId ?? target.fileId ?? "";
    const rows = db
      .prepare(
        `SELECT c.seq, c.question_id, c.file_id, c.page_id, c.quote, c.region FROM question_citations c
         JOIN questions q ON q.id = c.question_id
         WHERE c.user_id = ? AND c.${col} = ? AND c.seq > ? ORDER BY c.seq LIMIT ${limit + 1}`,
      )
      .all(auth.userId, value, after) as Array<{
      seq: number;
      question_id: string;
      file_id: string;
      page_id: string;
      quote: string;
      region: string | null;
    }>;
    const page = rows.slice(0, limit);
    const items: CitationBacklink[] = page.map((r) => {
      const row = questionRow(auth.userId, r.question_id) as QuestionRow;
      const live = nodeRowsOf(row.id).find((n) => n.node_trashed === 0);
      return {
        location: { kind: "question", questionId: row.id },
        title: row.text.slice(0, 120),
        nodeId: (live ?? nodeRowsOf(row.id)[0])?.node_id ?? null,
        itemType: "question",
        quote: r.quote,
        ...(r.region ? { region: JSON.parse(r.region) } : {}),
        trashed: row.trashed_at !== null || !live,
      } as CitationBacklink;
    });
    const last = page[page.length - 1];
    return {
      pageId: (target.pageId ?? "") as never,
      fileId: (target.fileId ?? page[0]?.file_id ?? "") as never,
      items,
      nextCursor: rows.length > limit && last ? encodeSeq(last.seq) : null,
    };
  }

  // ---- sessions -----------------------------------------------------------------------

  const sessionRow = (userId: string, id: string): SessionRow => {
    const row = q.session.get(id, userId) as SessionRow | undefined;
    if (!row) throw notFoundSession();
    return row;
  };
  const skippedOf = (row: SessionRow) => new Set(JSON.parse(row.skipped || "[]") as number[]);
  const itemsOf = (row: SessionRow) => JSON.parse(row.items) as practice.SessionItem[];
  const attemptsOf = (id: string) => q.sessionAttempts.all(id) as AttemptRow[];

  function viewOfSession(row: SessionRow, attempts = attemptsOf(row.id)): SessionView {
    const items = itemsOf(row);
    const answered = new Set(attempts.map((a) => a.position));
    const skips = skippedOf(row);
    return {
      id: row.id,
      scope: JSON.parse(row.scope) as StartScope,
      formats: JSON.parse(row.formats) as QuestionType[],
      length: row.length,
      seed: row.seed,
      status: row.status,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      abandonedAt: row.abandoned_at,
      total: items.length,
      answered: answered.size,
      shortfall: Math.max(0, row.length - items.length),
      items: items.map((it, position) => ({
        position,
        questionId: it.questionId,
        type: it.type,
        answered: answered.has(position),
        skipped: skips.has(position) && !answered.has(position),
      })),
    };
  }

  function attemptView(r: AttemptRow): AttemptView {
    return {
      id: r.id,
      sessionId: r.session_id,
      position: r.position,
      questionId: r.question_id,
      variantSeed: r.variant_seed,
      answer: JSON.parse(r.answer) as practice.Answer,
      result: JSON.parse(r.result) as practice.GradeResult,
      timeTakenMs: r.time_taken_ms,
      at: r.at,
    };
  }

  /** The pool a scope draws from, narrowed by an exam or nodes where the scope allows it. */
  function scopedPool(
    userId: string,
    tree: Tree,
    scope: StartScope,
    formats: readonly QuestionType[],
  ): PoolEntry[] {
    const pool = loadPool(userId, tree, formats);
    if (scope.kind === "nodes") {
      for (const n of scope.nodeIds) if (!tree.nodes.has(n)) throw notFoundNode(n);
    }
    if (scope.kind === "exam") examNodes(userId, tree, scope.examId);
    if (scope.kind === "missed" || scope.kind === "due") {
      let out = pool;
      if (scope.examId) {
        examNodes(userId, tree, scope.examId);
        out = out.filter((p) => p.examIds.includes(scope.examId as string));
      }
      if (scope.nodeIds) {
        for (const n of scope.nodeIds) if (!tree.nodes.has(n)) throw notFoundNode(n);
        out = out.filter((p) => p.nodeIds.some((n) => scope.nodeIds?.includes(n)));
      }
      return out;
    }
    return pool;
  }

  function presented(
    row: SessionRow,
    items: readonly practice.SessionItem[],
    position: number,
  ): PresentedQuestion | null {
    const item = items[position] as practice.SessionItem;
    const qrow = questionRow(row.user_id, item.questionId);
    if (!qrow) return null;
    const question = parseQuestion(qrow);
    return {
      position,
      total: items.length,
      questionId: item.questionId,
      type: item.type,
      view: questionView(question, item.shuffleSeed, item.variantSeed),
      selfGraded: hasSelfGraded(question),
    };
  }

  /** The first position that has no answer and whose question still exists. */
  function nextOpen(row: SessionRow, attempts: readonly AttemptRow[]): PresentedQuestion | null {
    const items = itemsOf(row);
    const done = new Set(attempts.map((a) => a.position));
    const skips = skippedOf(row);
    // not yet seen first, then what she skipped, each in session order
    for (const pass of [false, true]) {
      for (let i = 0; i < items.length; i++) {
        if (done.has(i) || skips.has(i) !== pass) continue;
        const p = presented(row, items, i);
        if (p) return p;
      }
    }
    return null;
  }

  /** Start a session. Hers only: an agent cannot take one. */
  function startSession(
    auth: AuthContext,
    rawInput: unknown,
  ): { session: SessionView; next: PresentedQuestion | null } {
    assertSession(auth, "Starting a practice session");
    const parsed = StartSessionInput.safeParse(rawInput);
    if (!parsed.success) {
      throw new AppError("invalid_input", "The request is not valid.", {
        hint: parsed.error.issues
          .map((i) => `${i.path.join(".") || "(body)"}: ${i.message}`)
          .join("; "),
        example: {
          scope: { kind: "nodes", nodeIds: ["nod_..."] },
          formats: ["multiple_choice", "fill_blank"],
          length: 10,
        },
      });
    }
    const input = parsed.data;
    const userId = auth.userId;
    const now = deps.now();
    const id = newId("practiceSession", now);
    const seed = input.seed ?? practice.hashSeed(id);
    const formats = [...new Set(input.formats ?? practice.QUESTION_TYPES)] as QuestionType[];
    const tree = loadTree(db, userId);
    let pool = scopedPool(userId, tree, input.scope, formats);
    const hist = history(userId);

    let scope: practice.SessionScope;
    switch (input.scope.kind) {
      case "due": {
        // Most overdue first, then new cards; the session takes the first `length` of them.
        const cards = (
          db.prepare("SELECT * FROM card_states WHERE user_id = ?").all(userId) as CardRow[]
        ).map((c) => ({ id: c.question_id, card: JSON.parse(c.state) as CardState }));
        const byId = new Map(pool.map((p) => [p.question.id, p]));
        const due = practice
          .dueCards(
            cards.filter((c) => byId.has(c.id)),
            now,
            { limit: input.length },
          )
          .map((c) => byId.get(c.id) as PoolEntry);
        pool = due;
        scope = { kind: "all" };
        break;
      }
      case "missed":
        scope = { kind: "missed" };
        break;
      case "exam":
        scope = input.scope;
        break;
      default:
        scope = input.scope as practice.SessionScope;
    }
    const built = practice.buildSession({
      id,
      startedAt: toIso(now),
      scope,
      formats,
      length: input.length,
      seed,
      pool,
      history: hist,
    });
    if (built.items.length === 0) {
      throw new AppError("invalid_input", "No questions match this scope and these formats.", {
        hint: hintForEmpty(input.scope),
        example: { scope: { kind: "all" }, length: 10 },
      });
    }
    q.insertSession.run({
      id,
      user_id: userId,
      scope: json(input.scope),
      formats: json(formats),
      length: input.length,
      seed,
      items: json(built.items),
      started_at: built.startedAt,
    });
    const row = sessionRow(userId, id);
    return { session: viewOfSession(row, []), next: nextOpen(row, []) };
  }

  function hintForEmpty(scope: StartScope): string {
    switch (scope.kind) {
      case "missed":
        return "Her missed-questions notebook is empty (or nothing in it matches the formats).";
      case "due":
        return "No flashcards or scheduled questions are due (or none match the formats).";
      case "exam":
        return "Nothing is filed under the lectures this exam covers yet, or none match the formats.";
      default:
        return "Nothing is filed there yet, or none of it matches the formats. Try other formats or a wider scope.";
    }
  }

  function getSession(auth: AuthContext, id: string): SessionView {
    return viewOfSession(sessionRow(auth.userId, id));
  }

  function listSessions(
    auth: AuthContext,
    opts: {
      status?: SessionView["status"] | undefined;
      cursor?: string | undefined;
      limit?: number | undefined;
    } = {},
  ): Page<SessionView & { correct: number }> {
    const limit = Math.min(200, Math.max(1, opts.limit ?? DEFAULT_LIMIT));
    const before = opts.cursor === undefined ? Number.MAX_SAFE_INTEGER : decodeSeq(opts.cursor);
    const rows = db
      .prepare(
        `SELECT * FROM practice_sessions WHERE user_id = ? AND seq < ? ${opts.status ? "AND status = ?" : ""}
         ORDER BY seq DESC LIMIT ${limit + 1}`,
      )
      .all(
        ...(opts.status ? [auth.userId, before, opts.status] : [auth.userId, before]),
      ) as SessionRow[];
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => {
        const attempts = attemptsOf(r.id);
        return {
          ...viewOfSession(r, attempts),
          correct: attempts.filter((a) => a.correct === 1).length,
        };
      }),
      nextCursor: rows.length > limit && last ? encodeSeq(last.seq) : null,
    };
  }

  /** The next question to answer, without its key. `null` when nothing is left. */
  function nextQuestion(
    auth: AuthContext,
    sessionId: string,
  ): { session: SessionView; next: PresentedQuestion | null } {
    const row = sessionRow(auth.userId, sessionId);
    const attempts = attemptsOf(row.id);
    return {
      session: viewOfSession(row, attempts),
      next: row.status === "active" ? nextOpen(row, attempts) : null,
    };
  }

  /** One position of a session. Unanswered: the question without its key. Answered: the question, her attempt and the key. */
  function getItem(
    auth: AuthContext,
    sessionId: string,
    position: number,
  ):
    | { answered: false; question: PresentedQuestion }
    | {
        answered: true;
        question: PresentedQuestion;
        attempt: AttemptView;
        reveal: Reveal;
        citations: Citation[];
        generalKnowledge: boolean;
      } {
    const row = sessionRow(auth.userId, sessionId);
    const items = itemsOf(row);
    const item = items[position];
    if (!item) throw badPosition(position, items.length);
    const question = presented(row, items, position);
    if (!question) throw questionGone();
    const attempt = attemptsOf(row.id).find((a) => a.position === position);
    if (!attempt) return { answered: false, question };
    const qrow = questionRow(auth.userId, item.questionId) as QuestionRow;
    const data = parseQuestion(qrow);
    return {
      answered: true,
      question,
      attempt: attemptView(attempt),
      reveal: revealOf(data, item.variantSeed),
      citations: data.sources,
      generalKnowledge: data.generalKnowledge,
    };
  }

  const badPosition = (position: number, total: number) =>
    new AppError("invalid_input", `There is no question at position ${position}.`, {
      hint: `This session has ${total} questions, at positions 0 to ${Math.max(0, total - 1)}.`,
    });
  const questionGone = () =>
    new AppError("conflict", "This question has been deleted.", {
      hint: "Skip it: ask for the next question, or finish the session.",
    });

  /** The answer key of a self-graded question, so she can mark herself. */
  function reveal(auth: AuthContext, sessionId: string, position: number): Reveal {
    assertSession(auth, "Revealing an answer key");
    const row = sessionRow(auth.userId, sessionId);
    const items = itemsOf(row);
    const item = items[position];
    if (!item) throw badPosition(position, items.length);
    const qrow = questionRow(auth.userId, item.questionId);
    if (!qrow) throw questionGone();
    const question = parseQuestion(qrow);
    if (!hasSelfGraded(question)) {
      throw new AppError(
        "invalid_input",
        "The answer to this question is shown after she answers it, not before.",
        {
          hint: "Only flashcards and free-response questions (and parts of a case) are marked by her; reveal is for those.",
        },
      );
    }
    return selfGradeKey(question, item.variantSeed);
  }

  function cardRating(
    question: Question,
    answer: practice.Answer,
    result: practice.GradeResult,
  ): practice.ReviewRating {
    return question.type === "flashcard" && answer.type === "flashcard"
      ? answer.rating
      : practice.ratingFromGrade(result);
  }

  /** Apply a review to the question's card, if it has one. */
  function reviewCardFor(
    userId: string,
    question: Question,
    answer: practice.Answer,
    result: practice.GradeResult,
    at: string,
  ): AnswerOutcome["schedule"] {
    const row = q.card.get(userId, question.id) as CardRow | undefined;
    if (!row) return null;
    const rating = cardRating(question, answer, result);
    const out = practice.reviewCard(JSON.parse(row.state) as CardState, rating, at);
    q.updateCard.run({
      id: row.id,
      state: json(out.card),
      phase: out.card.phase,
      due: out.card.due,
      updated_at: at,
    });
    return { rating, intervalDays: out.intervalDays, due: out.card.due };
  }

  /** Grade an answer on the server and store the attempt. */
  function submitAnswer(auth: AuthContext, sessionId: string, rawInput: unknown): AnswerOutcome {
    assertSession(auth, "Answering a practice question");
    const input = rawInput as {
      position?: number | undefined;
      answer?: unknown;
      timeTakenMs?: number | undefined;
    };
    const row = sessionRow(auth.userId, sessionId);
    if (row.status !== "active") {
      throw new AppError("conflict", `This session is ${row.status}; answers are closed.`, {
        hint: "Start a new session to keep practicing.",
      });
    }
    const items = itemsOf(row);
    const attempts = attemptsOf(row.id);
    const done = new Set(attempts.map((a) => a.position));
    let position = input.position;
    if (position === undefined) {
      const open = nextOpen(row, attempts);
      if (!open) {
        throw new AppError("conflict", "Every question in this session has been answered.", {
          hint: "Finish the session to see the results.",
        });
      }
      position = open.position;
    }
    const item = items[position];
    if (!item) throw badPosition(position, items.length);
    if (done.has(position)) {
      throw new AppError("conflict", `Question ${position + 1} was already answered.`, {
        hint: "Each question is answered once. Ask for the next question, or finish the session.",
      });
    }
    const qrow = questionRow(auth.userId, item.questionId);
    if (!qrow) throw questionGone();
    const question = parseQuestion(qrow);
    const variantSeed = usesVariants(question) ? item.variantSeed : null;
    // The grade is made here, from the stored question; nothing the client says about correctness is read.
    const result = practice.grade(question, input.answer, { variantSeed: item.variantSeed });
    if (result.malformed) {
      throw new AppError(
        "invalid_input",
        `That answer cannot be read for a ${question.type} question: ${result.feedback.map((f) => f.message).join(" ")}`,
        {
          hint: "Send the answer in the shape of the question type; the question view shows what it has.",
          example: result.correctAnswer.data,
        },
      );
    }
    const answer = input.answer as practice.Answer;
    const at = nowIso();
    let last = row.started_at;
    for (const a of attempts) if (a.at > last) last = a.at;
    const taken = input.timeTakenMs ?? Math.max(0, Date.parse(at) - Date.parse(last));
    const attemptId = newId("attempt", Date.parse(at));
    const outcome = db.transaction(() => {
      try {
        q.insertAttempt.run({
          id: attemptId,
          user_id: auth.userId,
          session_id: row.id,
          position,
          question_id: question.id,
          variant_seed: variantSeed,
          answer_type: answer.type,
          answer: json(answer),
          result: json(result),
          correct: result.correct ? 1 : 0,
          score: result.score,
          time_taken_ms: taken,
          at,
        });
      } catch (e) {
        if ((e as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") {
          throw new AppError(
            "conflict",
            `Question ${(position as number) + 1} was already answered.`,
            {
              hint: "Each question is answered once.",
            },
          );
        }
        throw e;
      }
      const schedule = reviewCardFor(auth.userId, question, answer, result, at);
      const after = attemptsOf(row.id);
      const open = nextOpen(row, after);
      const finished = open === null;
      if (finished) {
        db.prepare(
          "UPDATE practice_sessions SET status = 'finished', finished_at = ? WHERE id = ?",
        ).run(at, row.id);
      }
      return { schedule, answered: after.length, finished, next: open };
    })();
    const attempt = attemptView(
      q.sessionAttempts.all(row.id).find((a) => (a as AttemptRow).id === attemptId) as AttemptRow,
    );
    return {
      attempt,
      result,
      reveal: revealOf(question, item.variantSeed),
      citations: question.sources,
      generalKnowledge: question.generalKnowledge,
      schedule: outcome.schedule,
      progress: { answered: outcome.answered, total: items.length, finished: outcome.finished },
      next: outcome.next,
    };
  }

  function finishSession(auth: AuthContext, sessionId: string): SessionResults {
    assertSession(auth, "Finishing a practice session");
    const row = sessionRow(auth.userId, sessionId);
    if (row.status === "abandoned") {
      throw new AppError("conflict", "This session was abandoned.", {
        hint: "Start a new one; results of an abandoned session can still be read.",
      });
    }
    if (row.status === "active") {
      db.prepare(
        "UPDATE practice_sessions SET status = 'finished', finished_at = ? WHERE id = ?",
      ).run(nowIso(), row.id);
    }
    return results(auth, sessionId);
  }

  /** Set a question aside; it comes back after the others. Hers only. */
  function skipQuestion(auth: AuthContext, sessionId: string, position: number): SessionView {
    assertSession(auth, "Skipping a practice question");
    const row = sessionRow(auth.userId, sessionId);
    if (row.status !== "active") {
      throw new AppError("conflict", `This session is ${row.status}; nothing can be skipped.`, {
        hint: "Start a new session to keep practicing.",
      });
    }
    const items = itemsOf(row);
    if (!items[position]) throw badPosition(position, items.length);
    if (attemptsOf(row.id).some((a) => a.position === position)) {
      throw new AppError("conflict", `Question ${position + 1} was already answered.`, {
        hint: "Only a question not yet answered can be skipped.",
      });
    }
    const skips = skippedOf(row);
    if (!skips.has(position)) {
      skips.add(position);
      db.prepare("UPDATE practice_sessions SET skipped = ? WHERE id = ?").run(
        JSON.stringify([...skips].sort((a, b) => a - b)),
        row.id,
      );
    }
    return getSession(auth, sessionId);
  }

  function abandonSession(auth: AuthContext, sessionId: string): SessionView {
    assertSession(auth, "Abandoning a practice session");
    const row = sessionRow(auth.userId, sessionId);
    if (row.status === "finished") {
      throw new AppError("conflict", "This session is already finished.", {
        hint: "Finished sessions keep their results.",
      });
    }
    if (row.status === "active") {
      db.prepare(
        "UPDATE practice_sessions SET status = 'abandoned', abandoned_at = ? WHERE id = ?",
      ).run(nowIso(), row.id);
    }
    return getSession(auth, sessionId);
  }

  /** Score, per-question outcomes and time. Readable by agents (G8); unanswered questions show no key. */
  function results(auth: AuthContext, sessionId: string): SessionResults {
    const row = sessionRow(auth.userId, sessionId);
    const items = itemsOf(row);
    const attempts = attemptsOf(row.id);
    const byPosition = new Map(attempts.map((a) => [a.position, a]));
    const qrows = new Map<string, QuestionRow>();
    for (const it of items) {
      const r = questionRow(auth.userId, it.questionId);
      if (r) qrows.set(it.questionId, r);
    }
    const nodes = nodeMap([...qrows.keys()]);
    const out: SessionItemResult[] = items.map((it, position) => {
      const a = byPosition.get(position);
      const r = qrows.get(it.questionId);
      const data = r ? parseQuestion(r) : null;
      const result = a ? (JSON.parse(a.result) as practice.GradeResult) : null;
      return {
        position,
        questionId: it.questionId,
        type: it.type,
        text: r?.text ?? null,
        answered: a !== undefined,
        correct: a ? a.correct === 1 : null,
        score: a ? a.score : null,
        points: result ? result.points : null,
        maxPoints: result ? result.maxPoints : null,
        timeTakenMs: a ? a.time_taken_ms : null,
        answer: a ? (JSON.parse(a.answer) as practice.Answer) : null,
        result,
        tags: data?.tags ?? [],
        conceptIds: data?.conceptIds ?? [],
        nodeIds: nodes.get(it.questionId) ?? [],
      };
    });
    const answered = out.filter((i) => i.answered);
    const correct = answered.filter((i) => i.correct).length;
    const points = answered.reduce((s, i) => s + (i.points ?? 0), 0);
    const maxPoints = answered.reduce((s, i) => s + (i.maxPoints ?? 0), 0);
    return {
      session: viewOfSession(row, attempts),
      summary: {
        total: items.length,
        answered: answered.length,
        unanswered: items.length - answered.length,
        correct,
        incorrect: answered.length - correct,
        accuracy: answered.length === 0 ? null : correct / answered.length,
        points,
        maxPoints,
        percent: maxPoints === 0 ? null : points / maxPoints,
        timeTakenMs: answered.reduce((s, i) => s + (i.timeTakenMs ?? 0), 0),
        durationMs:
          row.finished_at === null && row.abandoned_at === null
            ? null
            : Date.parse((row.finished_at ?? row.abandoned_at) as string) -
              Date.parse(row.started_at),
      },
      items: out,
    };
  }

  /** Her answers to one question, newest first (G5). */
  function listAttempts(
    auth: AuthContext,
    questionId: string,
    opts: { cursor?: string | undefined; limit?: number | undefined } = {},
  ): Page<AttemptView> {
    if (!questionRow(auth.userId, questionId)) throw notFoundQuestion();
    const limit = Math.min(200, Math.max(1, opts.limit ?? DEFAULT_LIMIT));
    const before = opts.cursor === undefined ? Number.MAX_SAFE_INTEGER : decodeSeq(opts.cursor);
    const rows = db
      .prepare(
        `SELECT * FROM attempts WHERE user_id = ? AND question_id = ? AND seq < ? ORDER BY seq DESC LIMIT ${limit + 1}`,
      )
      .all(auth.userId, questionId, before) as AttemptRow[];
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map(attemptView),
      nextCursor: rows.length > limit && last ? encodeSeq(last.seq) : null,
    };
  }

  // ---- notebook, weak areas ----------------------------------------------------------

  /** Visible questions, optionally only those under a node (and below). */
  function scopedRows(userId: string, nodeId?: string): QuestionRow[] {
    const rows = db
      .prepare(`SELECT q.* FROM questions q WHERE q.user_id = ? AND ${VISIBLE} ORDER BY q.seq`)
      .all(userId) as QuestionRow[];
    if (!nodeId) return rows;
    const tree = loadTree(db, userId);
    const under = new Set(subtreeOf(tree, nodeId));
    const nodes = nodeMap(rows.map((r) => r.id));
    return rows.filter((r) => (nodes.get(r.id) ?? []).some((n) => under.has(n)));
  }

  /** The missed-questions notebook (G11), by the rule of the pure `notebookEntries`. */
  function notebook(
    auth: AuthContext,
    opts: { nodeId?: string | undefined; type?: QuestionType | undefined } = {},
  ): NotebookView {
    const rows = scopedRows(auth.userId, opts.nodeId).filter(
      (r) => !opts.type || r.type === opts.type,
    );
    const live = new Map(rows.map((r) => [r.id, r]));
    const entries = practice
      .notebookEntries(history(auth.userId))
      .filter((e) => live.has(e.questionId));
    const sums = new Map(
      summaries(
        auth.userId,
        entries.map((e) => live.get(e.questionId) as QuestionRow),
      ).map((s) => [s.id, s]),
    );
    const lastWrong = db.prepare(
      "SELECT result FROM attempts WHERE user_id = ? AND question_id = ? AND correct = 0 ORDER BY seq DESC LIMIT 1",
    );
    const reasonOf = (questionId: string): string | null => {
      const row = lastWrong.get(auth.userId, questionId) as { result: string } | undefined;
      if (!row) return null;
      try {
        const result = JSON.parse(row.result) as {
          feedback?: Array<{ correct: boolean; message: string }>;
        };
        return result.feedback?.find((f) => !f.correct && f.message)?.message ?? null;
      } catch {
        return null;
      }
    };
    const items = entries.map((e) => ({
      ...e,
      question: sums.get(e.questionId) as QuestionSummary,
      reason: reasonOf(e.questionId),
    }));
    const byType: Partial<Record<QuestionType, number>> = {};
    for (const e of entries) byType[e.type] = (byType[e.type] ?? 0) + 1;
    return { items, counts: { total: items.length, byType } };
  }

  /** Accuracy by tag, concept and lecture/folder (G6); thin areas say so instead of guessing. */
  function weakAreas(auth: AuthContext, opts: WeakAreaOptions = {}): WeakAreasView {
    const userId = auth.userId;
    const tree = loadTree(db, userId);
    const rows = scopedRows(userId, opts.nodeId);
    const direct = nodeMap(rows.map((r) => r.id));
    // Tags and concepts come from their own tables, not from parsing every question's JSON.
    const grouped = (sql: string) => {
      const map = new Map<string, string[]>();
      for (const r of db.prepare(sql).all(userId) as Array<{ id: string; v: string }>) {
        const list = map.get(r.id);
        if (list) list.push(r.v);
        else map.set(r.id, [r.v]);
      }
      return map;
    };
    const tagsOf = grouped(
      "SELECT question_id AS id, tag AS v FROM question_tags WHERE user_id = ?",
    );
    const conceptsOf = grouped(
      "SELECT question_id AS id, concept_id AS v FROM question_concepts WHERE user_id = ?",
    );
    const chains = new Map<string, string[]>();
    const chainOf = (n: string): string[] => {
      let c = chains.get(n);
      if (!c) {
        c = tree.chain(n);
        chains.set(n, c);
      }
      return c;
    };
    const labels: practice.QuestionLabels[] = rows.map((r) => ({
      questionId: r.id,
      tags: tagsOf.get(r.id) ?? [],
      conceptIds: conceptsOf.get(r.id) ?? [],
      nodeIds: [...new Set((direct.get(r.id) ?? []).flatMap(chainOf))],
    }));
    const limits = {
      minAttempts: opts.minAttempts ?? 5,
      minQuestions: opts.minQuestions ?? 3,
      weakBelow: opts.weakBelow ?? 0.7,
    };
    const ids = new Set(labels.map((l) => l.questionId));
    const attempts = history(userId).filter((a) => !opts.nodeId || ids.has(a.questionId));
    const report = practice.weakAreas(attempts, labels, limits);
    const plain = (a: practice.AreaStat): AreaView => ({ ...a, label: null });
    return {
      byTag: report.byTag.map(plain),
      byConcept: report.byConcept.map(plain),
      byNode: report.byNode.map((a) => ({
        ...a,
        label: tree.nodes.has(a.key) ? tree.path(a.key) : null,
      })),
      unmatchedAttempts: report.unmatchedAttempts,
      thresholds: limits,
    };
  }

  // ---- spaced repetition ----------------------------------------------------------------

  function allCards(userId: string): Array<{ id: string; card: CardState }> {
    return (
      db
        .prepare(
          `SELECT c.* FROM card_states c JOIN questions q ON q.id = c.question_id
           WHERE c.user_id = ? AND ${VISIBLE}`,
        )
        .all(userId) as CardRow[]
    ).map((c) => ({ id: c.question_id, card: JSON.parse(c.state) as CardState }));
  }

  /** Cards due now (most overdue first, then new ones), with counts and a two-week forecast (G7, G9). */
  function dueList(auth: AuthContext, opts: DueOptions = {}): DueView {
    const userId = auth.userId;
    const nowMs = deps.now();
    const offset = opts.utcOffsetMinutes ?? 0;
    const tree = loadTree(db, userId);
    let allowed: Set<string> | null = null;
    const restrict = (ids: Set<string>) => {
      allowed = allowed ? new Set([...allowed].filter((x) => ids.has(x))) : ids;
    };
    if (opts.nodeId || opts.examId) {
      const pool = loadPool(userId, tree);
      const under = opts.nodeId ? new Set(subtreeOf(tree, opts.nodeId)) : null;
      if (opts.examId) examNodes(userId, tree, opts.examId);
      restrict(
        new Set(
          pool
            .filter(
              (p) =>
                (!under || p.direct.some((n) => under.has(n))) &&
                (!opts.examId || p.examIds.includes(opts.examId)),
            )
            .map((p) => p.question.id),
        ),
      );
    }
    let cards = allCards(userId);
    if (allowed) cards = cards.filter((c) => (allowed as Set<string>).has(c.id));
    if (opts.type) {
      const typed = new Set(
        (
          db
            .prepare("SELECT id FROM questions WHERE user_id = ? AND type = ?")
            .all(userId, opts.type) as Array<{ id: string }>
        ).map((r) => r.id),
      );
      cards = cards.filter((c) => typed.has(c.id));
    }
    const today = localDay(nowMs, offset);
    const days = Array.from({ length: FORECAST_DAYS }, (_, i) =>
      localDay(nowMs + i * DAY_MS, offset),
    );
    const byDay = new Map(days.map((d) => [d, 0]));
    let dueNow = 0;
    let fresh = 0;
    for (const c of cards) {
      if (c.card.phase === "new") {
        fresh++;
        continue;
      }
      const day = localDay(Date.parse(c.card.due), offset);
      if (Date.parse(c.card.due) <= nowMs) dueNow++;
      let bucket = day;
      if (bucket < today) bucket = today;
      if (byDay.has(bucket)) byDay.set(bucket, (byDay.get(bucket) ?? 0) + 1);
    }
    const limit = Math.min(200, Math.max(1, opts.limit ?? DEFAULT_LIMIT));
    const picked = practice.dueCards(cards, nowMs, { limit });
    const rows = picked.map((p) => questionRow(userId, p.id) as QuestionRow);
    const sums = summaries(userId, rows);
    const items: DueItem[] = picked.map((p, i) => ({
      question: sums[i] as QuestionSummary,
      card: p.card,
      overdueDays:
        p.card.phase === "review"
          ? Math.max(0, Math.floor((nowMs - Date.parse(p.card.due)) / DAY_MS))
          : 0,
      intervals: practice.nextIntervals(p.card, nowMs),
    }));
    return {
      items,
      counts: {
        due: dueNow,
        new: fresh,
        total: cards.length,
        byDay: days.map((date) => ({ date, count: byDay.get(date) ?? 0 })),
      },
    };
  }

  // ---- progress for exams -----------------------------------------------------------------

  /** How much of the material under these nodes she has practised (M2). */
  function coverageStats(userId: string, nodeIds: readonly string[]): CoverageStats {
    const tree = loadTree(db, userId);
    const under = new Set(nodeIds.flatMap((n) => tree.subtree(n)));
    const nowMs = deps.now();
    const all = scopedRows(userId);
    const homes = nodeMap(
      all.map((r) => r.id),
      true,
    );
    const rows = all.filter((r) => (homes.get(r.id) ?? []).some((n) => under.has(n)));
    const ids = new Set(rows.map((r) => r.id));
    const mine = history(userId).filter((a) => ids.has(a.questionId));
    const cards = allCards(userId).filter((c) => ids.has(c.id));
    return {
      questions: rows.length,
      attempted: new Set(mine.map((a) => a.questionId)).size,
      attempts: mine.length,
      correct: mine.filter((a) => a.result.correct).length,
      dueCards: cards.filter((c) => c.card.phase === "review" && Date.parse(c.card.due) <= nowMs)
        .length,
      newCards: cards.filter((c) => c.card.phase === "new").length,
      notebook: practice.notebookEntries(mine).length,
    };
  }

  // ---- search ------------------------------------------------------------------------------

  /** Turn free text into a safe FTS5 query: every word a quoted prefix term. */
  function ftsQuery(text: string): string | null {
    const words = text.match(/[\p{L}\p{N}]+/gu)?.slice(0, 12) ?? [];
    return words.length === 0 ? null : words.map((w) => `"${w}"*`).join(" ");
  }

  /**
   * Questions whose prompt text matches, best first. Questions in the trash, and questions
   * filed only under nodes in the trash, are left out.
   */
  function searchQuestions(
    userId: string,
    text: string,
    options: { offset?: number | undefined; limit?: number | undefined } = {},
  ): Array<{
    questionId: string;
    questionType: string;
    nodeId: string | null;
    snippet: string;
  }> {
    const match = ftsQuery(text);
    if (match === null) return [];
    const rows = db
      .prepare(
        `SELECT q.id AS question_id, q.type,
                (SELECT n.node_id FROM question_nodes n
                 WHERE n.question_id = q.id AND n.node_trashed = 0 ORDER BY n.rowid LIMIT 1) AS node_id,
                snippet(questions_fts, 0, '', '', '…', 12) AS snippet
         FROM questions_fts JOIN questions q ON q.seq = questions_fts.rowid
         WHERE questions_fts MATCH ? AND q.user_id = ? AND q.trashed_at IS NULL
           AND EXISTS (SELECT 1 FROM question_nodes n WHERE n.question_id = q.id AND n.node_trashed = 0)
         ORDER BY questions_fts.rank, q.seq LIMIT ? OFFSET ?`,
      )
      .all(match, userId, options.limit ?? DEFAULT_LIMIT, options.offset ?? 0) as Array<{
      question_id: string;
      type: string;
      node_id: string | null;
      snippet: string;
    }>;
    return rows.map((r) => ({
      questionId: r.question_id,
      questionType: r.type,
      nodeId: r.node_id,
      snippet: r.snippet,
    }));
  }

  // ---- node hooks (the integrator calls these from the library routes) -------------------------

  const hookIds = (nodeIds: readonly string[]) => json([...new Set(nodeIds)]);

  /** A library node (and everything under it) went to the trash: questions filed only there are hidden. */
  function onNodeTrashed(userId: string, nodeIds: readonly string[]): void {
    db.prepare(
      "UPDATE question_nodes SET node_trashed = 1 WHERE user_id = ? AND node_id IN (SELECT value FROM json_each(?))",
    ).run(userId, hookIds(nodeIds));
  }

  /** The nodes came back: their questions return with their history and schedule. */
  function onNodeRestored(userId: string, nodeIds: readonly string[]): void {
    db.prepare(
      "UPDATE question_nodes SET node_trashed = 0 WHERE user_id = ? AND node_id IN (SELECT value FROM json_each(?))",
    ).run(userId, hookIds(nodeIds));
  }

  /**
   * The nodes were deleted for good: questions lose those homes, and a question
   * left with no home is deleted too (its attempts stay as history).
   */
  function onNodeDeleted(userId: string, nodeIds: readonly string[]): void {
    db.transaction(() => {
      const ids = hookIds(nodeIds);
      const affected = db
        .prepare(
          "SELECT DISTINCT question_id FROM question_nodes WHERE user_id = ? AND node_id IN (SELECT value FROM json_each(?))",
        )
        .all(userId, ids) as Array<{ question_id: string }>;
      db.prepare(
        "DELETE FROM question_nodes WHERE user_id = ? AND node_id IN (SELECT value FROM json_each(?))",
      ).run(userId, ids);
      const gone: string[] = [];
      for (const { question_id } of affected) {
        const left = db
          .prepare("SELECT COUNT(*) AS n FROM question_nodes WHERE question_id = ?")
          .get(question_id) as { n: number };
        if (left.n === 0) {
          db.prepare("DELETE FROM questions WHERE id = ?").run(question_id);
          gone.push(question_id);
        }
      }
      if (gone.length > 0) ports.onQuestionsDeleted?.(userId, gone);
    })();
  }

  /**
   * A node was duplicated: its questions are copied onto the copy (new IDs,
   * fresh schedule and history). Returns how many were copied.
   */
  function onNodeDuplicated(userId: string, fromNodeId: string, toNodeId: string): number {
    return db.transaction(() => {
      const rows = db
        .prepare(
          `SELECT q.* FROM questions q JOIN question_nodes n ON n.question_id = q.id
           WHERE q.user_id = ? AND n.node_id = ? AND n.node_trashed = 0 AND q.trashed_at IS NULL ORDER BY q.seq`,
        )
        .all(userId, fromNodeId) as QuestionRow[];
      const now = nowIso();
      for (const row of rows) {
        const copy = { ...parseQuestion(row), id: newId("question", Date.parse(now)) } as Question;
        q.insertQuestion.run({
          ...columns(userId, copy),
          created_at: row.created_at,
          updated_at: now,
        });
        writeIndexes(userId, copy, [toNodeId]);
        ensureCard(userId, copy, now);
      }
      return rows.length;
    })();
  }

  /** Several (original, copy) pairs at once, as a duplicated subtree gives. */
  function onNodesDuplicated(
    userId: string,
    pairs: ReadonlyArray<readonly [string, string]>,
  ): number {
    return pairs.reduce((n, [from, to]) => n + onNodeDuplicated(userId, from, to), 0);
  }

  return {
    // questions
    validateQuestions: (auth: AuthContext, inputs: readonly unknown[]) => {
      const { problems } = validateQuestions(auth, inputs);
      return { valid: inputs.length - problems.length, problems };
    },
    createQuestions,
    getQuestion,
    listQuestions,
    updateQuestion,
    trashQuestion,
    restoreQuestion,
    deleteQuestion,
    setReview,
    setSchedule,
    citedBy,
    listAttempts,
    searchQuestions,
    // sessions
    startSession,
    getSession,
    listSessions,
    nextQuestion,
    getItem,
    reveal,
    submitAnswer,
    finishSession,
    abandonSession,
    skipQuestion,
    results,
    // her progress
    notebook,
    weakAreas,
    dueList,
    coverageStats,
    // node hooks
    onNodeTrashed,
    onNodeRestored,
    onNodeDeleted,
    onNodeDuplicated,
    onNodesDuplicated,
  };
}

export type PracticeService = ReturnType<typeof createPracticeService>;
