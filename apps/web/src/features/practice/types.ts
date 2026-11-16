import type { practice } from "@notes/schema";
import type { ExamsApi } from "../exams/types";

export type Answer = practice.Answer;
export type GradeResult = practice.GradeResult;
export type QuestionType = practice.QuestionType;
export type ReviewRating = practice.ReviewRating;
export type SessionScope = practice.SessionScope;
export type NotebookEntry = practice.NotebookEntry;
export type AreaStat = practice.AreaStat;
export type Rounding = practice.Rounding;
/** Where a question came from. The integrator swaps this for the shared Citation type. */
export type SourceCitation = practice.SourceRef;

export const QUESTION_TYPES = [
  "multiple_choice",
  "select_all",
  "matching",
  "fill_blank",
  "calculation",
  "flashcard",
  "case",
  "free_response",
] as const satisfies readonly QuestionType[];

export const TYPE_LABELS: Record<QuestionType, string> = {
  multiple_choice: "Multiple choice",
  select_all: "Select all",
  matching: "Matching",
  fill_blank: "Fill in the blank",
  calculation: "Calculation",
  flashcard: "Flashcards",
  case: "Cases",
  free_response: "Free response",
};

// ------------------------------------------------- the question WITHOUT answers
// What the server sends while she is answering. Correct options, accepted answers,
// expressions, tolerance, explanations and the rubric are never here.

export interface ServedOption {
  id: string;
  text: string;
}

interface ServedCommon {
  /** A page image shown with the question. */
  image?: { pageId: string; region?: { x: number; y: number; width: number; height: number } };
}

export interface ServedMultipleChoice extends ServedCommon {
  type: "multiple_choice";
  prompt: string;
  /** In the order to display (the session's shuffle seed is already applied). */
  options: ServedOption[];
}
export interface ServedSelectAll extends ServedCommon {
  type: "select_all";
  prompt: string;
  options: ServedOption[];
}
export interface ServedMatching extends ServedCommon {
  type: "matching";
  prompt: string;
  /** Left items, by pair id. */
  lefts: { id: string; text: string }[];
  /** The right-hand column in display order, including distractors. */
  rights: string[];
}
export interface ServedFillBlank extends ServedCommon {
  type: "fill_blank";
  /** Contains {{1}}, {{2}}, ... markers. */
  text: string;
  /** One per blank; `width` is a character count to size the field. */
  blanks: { width: number }[];
}
export interface ServedCalculation extends ServedCommon {
  type: "calculation";
  /** Already filled in with this variant's numbers. */
  prompt: string;
  /** Units to offer in the picker (same kind as the answer plus a few others). Any valid spelling is accepted. */
  unitChoices: string[];
  rounding?: Rounding | undefined;
  allowFractions: boolean;
}
export interface ServedFlashcard extends ServedCommon {
  type: "flashcard";
  front: string;
}
export interface ServedFreeResponse extends ServedCommon {
  type: "free_response";
  prompt: string;
  /** How many rubric key points there are (the points themselves come with `reveal`). */
  rubricSize: number;
}

export type ServedPart =
  | ServedMultipleChoice
  | ServedSelectAll
  | ServedMatching
  | ServedFillBlank
  | ServedCalculation
  | ServedFlashcard
  | ServedFreeResponse;

export interface ServedCase extends ServedCommon {
  type: "case";
  vignette: string;
  parts: ServedPart[];
}

export type ServedBody = ServedPart | ServedCase;

export type ServedQuestion = ServedBody & {
  /** Position in the session. */
  index: number;
  questionId: string;
  tags: string[];
  difficulty: number;
  /** True for a question that is not from her notes. */
  generalKnowledge: boolean;
};

// ------------------------------------------------------ revealed on request

export type Reveal =
  | {
      type: "flashcard";
      back: string;
      explanation: string;
      /** Days until the next review for each button. */
      intervals: Record<ReviewRating, number>;
    }
  | {
      type: "free_response";
      modelAnswer: string;
      rubric: { point: string; points: number }[];
    };

// ------------------------------------------------------------ session state

export type ItemStatus = "pending" | "answered" | "skipped";

export interface SessionState {
  id: string;
  /** "Lecture 7: Beta-blockers", "Missed questions", ... */
  scopeLabel: string;
  total: number;
  /** How many fewer than she asked for the pool allowed. */
  shortfall: number;
  items: { index: number; type: QuestionType; status: ItemStatus }[];
  status: "active" | "finished";
  /** The question to answer now; null when finished. */
  current: ServedQuestion | null;
  answered: number;
  skipped: number;
  /** True when every question left is one she skipped: skipping again makes no sense. */
  onlySkippedLeft: boolean;
  /** Time spent answering so far. */
  elapsedMs: number;
  startedAt: string;
}

export interface UnfinishedSession {
  id: string;
  scopeLabel: string;
  total: number;
  answered: number;
  startedAt: string;
}

export interface QuestionOutcome {
  index: number;
  questionId: string;
  result: GradeResult;
  /** Shown after answering. For a case, the overall takeaway ("" if none). */
  explanation: string;
  /** For a case, each sub-question's explanation in order. */
  partExplanations?: string[];
  citations: SourceCitation[];
  generalKnowledge: boolean;
  /** What happened to the missed-questions notebook: she entered it, is still in it, made progress, or left. */
  notebook: "added" | "kept" | "progress" | "cleared" | null;
  notebookNote?: string;
}

export interface ResultItem {
  index: number;
  question: ServedQuestion;
  status: ItemStatus;
  answer: Answer | null;
  outcome: QuestionOutcome | null;
  timeTakenMs: number;
}

export interface SessionResults {
  sessionId: string;
  scopeLabel: string;
  startedAt: string;
  finishedAt: string | null;
  items: ResultItem[];
  /** Weakest areas touched by this session that have enough data, for the next-steps card. */
  weakest: { label: string; accuracy: number; scope: SessionScope | null } | null;
}

export interface StartRequest {
  scope: SessionScope;
  formats: QuestionType[];
  length: number;
  /** Only flashcards that are due (plus a few new ones). */
  dueOnly?: boolean;
  /** Restrict to these questions (retry one from the notebook). */
  questionIds?: string[];
}

// ----------------------------------------------------------------- overview

export interface PracticeScopeOption {
  id: string;
  kind: "node" | "exam" | "missed" | "due" | "all";
  label: string;
  detail?: string;
  scope: SessionScope;
  dueOnly?: boolean;
  counts: Record<QuestionType, number>;
  total: number;
}

export interface PracticeOverview {
  scopes: PracticeScopeOption[];
  dueToday: number;
  notebookSize: number;
  unfinished: UnfinishedSession | null;
}

// ---------------------------------------------------------------- notebook

export interface NotebookItem {
  entry: NotebookEntry;
  /** The question as she saw it last (prompt, vignette or front). Light markdown. */
  promptText: string;
  tags: string[];
  /** Why it is here: the reason from the last wrong attempt ("1000 times too large", "unit missing"). */
  reason: string | null;
  /** How it leaves, in words. */
  leaveRule: string;
  /** Where it came from, for the row ("Lecture 7"). */
  origin: string;
}

// -------------------------------------------------------------- weak areas

export interface AreaRow {
  kind: "tag" | "concept" | "node";
  key: string;
  label: string;
  stat: AreaStat;
  /** Scope to practise just this area, when one exists. */
  practiceScope: SessionScope | null;
}

export interface WeakAreasView {
  byTag: AreaRow[];
  byConcept: AreaRow[];
  byNode: AreaRow[];
  unmatchedAttempts: number;
  totalAttempts: number;
  /** The rule behind "not enough attempts yet", so the screen can say it plainly. */
  thresholds: { minAttempts: number; minQuestions: number; weakBelow: number };
}

// ------------------------------------------------------------------- cards

export interface DueByDay {
  /** Due now (today and overdue). */
  today: number;
  /** Cards she has never reviewed. */
  newCards: number;
  totalCards: number;
  /** Fourteen entries starting today (day 0 includes overdue). */
  days: { date: string; count: number }[];
}

// ------------------------------------------------------------------- store

export interface PracticeStore extends ExamsApi {
  /** What she can practise, and counts. `currentNodeId` marks the lecture/folder she is looking at. */
  getOverview(options?: { currentNodeId?: string | null }): Promise<PracticeOverview>;
  startSession(request: StartRequest): Promise<SessionState>;
  /** The session she left unfinished, if any (resume it with getSession). */
  getUnfinishedSession(): Promise<UnfinishedSession | null>;
  /** The current question and progress (also how an unfinished session is resumed). */
  getSession(sessionId: string): Promise<SessionState>;
  /** Grade and record. For self-graded types the answer carries her rating or ticks. */
  submitAnswer(
    sessionId: string,
    index: number,
    answer: Answer,
    timeTakenMs: number,
  ): Promise<QuestionOutcome>;
  /** Back of a card, or the model answer and rubric of a free response (or of a case part). */
  reveal(sessionId: string, index: number, partIndex?: number): Promise<Reveal>;
  skip(sessionId: string, index: number): Promise<SessionState>;
  /** Mark finished (unanswered questions stay skipped) and return the results. */
  finishSession(sessionId: string): Promise<SessionResults>;
  /** Leave without results; answers already given are kept. */
  abandonSession(sessionId: string): Promise<void>;
  getResults(sessionId: string): Promise<SessionResults>;
  listNotebook(): Promise<NotebookItem[]>;
  getWeakAreas(): Promise<WeakAreasView>;
  getDueByDay(days?: number): Promise<DueByDay>;
}

/** Thrown by the HTTP store for a failed request. */
export class PracticeApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "PracticeApiError";
    this.status = status;
  }
}
