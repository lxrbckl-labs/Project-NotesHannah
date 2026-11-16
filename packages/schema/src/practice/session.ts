import { z } from "zod";
import { Timestamp } from "../common.js";
import { AttemptId, ConceptId, ExamId, NodeId, PracticeSessionId, QuestionId } from "../ids.js";
import { Answer } from "./answers.js";
import { QUESTION_TYPES, type Question, QuestionType } from "./content.js";
import { GradeResult } from "./grade-result.js";
import { notebookQuestionIds } from "./notebook.js";
import { deriveSeed, makeRng, RandomSeed, shuffled } from "./rng.js";

/** What a practice session draws its questions from. */
export const SessionScope = z.discriminatedUnion(
  "kind",
  [
    z.strictObject({ kind: z.literal("nodes"), nodeIds: z.array(NodeId).min(1).max(50) }),
    z.strictObject({ kind: z.literal("concepts"), conceptIds: z.array(ConceptId).min(1).max(50) }),
    z.strictObject({ kind: z.literal("exam"), examId: ExamId }),
    /** The missed-questions notebook. */
    z.strictObject({ kind: z.literal("missed") }),
    /** Everything she has. */
    z.strictObject({ kind: z.literal("all") }),
  ],
  { error: 'scope needs kind "nodes", "concepts", "exam", "missed" or "all".' },
);
export type SessionScope = z.infer<typeof SessionScope>;

/** One question in a session, with the seeds that make its numbers and option order repeatable. */
export const SessionItem = z.strictObject({
  questionId: QuestionId,
  type: QuestionType,
  /** Seeds the numbers of a calculation with variables. */
  variantSeed: RandomSeed,
  /** Seeds the display order of options and the right-hand column of a matching question. */
  shuffleSeed: RandomSeed,
});
export type SessionItem = z.infer<typeof SessionItem>;

export const PracticeSession = z.strictObject({
  id: PracticeSessionId,
  scope: SessionScope,
  /** The question types she asked for. */
  formats: z.array(QuestionType).min(1).max(QUESTION_TYPES.length),
  /** How many questions she asked for; `items` may be fewer if there are not enough. */
  length: z.number().int().min(1).max(100),
  /** The seed the session was built from. */
  seed: RandomSeed,
  items: z.array(SessionItem).max(100),
  startedAt: Timestamp,
  finishedAt: Timestamp.nullable(),
});
export type PracticeSession = z.infer<typeof PracticeSession>;

/** One answer to one question, with its grade. */
export const Attempt = z.strictObject({
  id: AttemptId,
  /** The session it happened in; null for a one-off (a flashcard review, a single question). */
  sessionId: PracticeSessionId.nullable(),
  questionId: QuestionId,
  /** The seed the question was shown with; null when it has no variants. */
  variantSeed: RandomSeed.nullable(),
  answer: Answer,
  result: GradeResult,
  timeTakenMs: z.number().int().min(0),
  at: Timestamp,
});
export type Attempt = z.infer<typeof Attempt>;

/** A question plus where it lives, so a scope can be applied. The server fills this in from the document tree. */
export interface PoolQuestion {
  question: Question;
  /** The lecture and every folder above it that contain the question. */
  nodeIds: readonly string[];
  /** The exams whose covered material includes the question. */
  examIds: readonly string[];
}

export interface BuildSessionInput {
  id: string;
  startedAt: string;
  scope: SessionScope;
  formats: readonly QuestionType[];
  length: number;
  seed: number;
  pool: readonly PoolQuestion[];
  /** Past attempts; when given, weak questions are picked more often and the notebook scope works. */
  history?: ReadonlyArray<Pick<Attempt, "questionId" | "at" | "answer" | "result">> | undefined;
}

type History = NonNullable<BuildSessionInput["history"]>;

/**
 * How likely a question is to be picked, from her history: 1 for a question
 * never seen, up to 6 for one she always gets wrong and got wrong last time.
 */
export function questionWeight(questionId: string, history: History): number {
  const mine = history.filter((a) => a.questionId === questionId);
  if (mine.length === 0) return 1;
  const sorted = mine.slice().sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const correct = sorted.filter((a) => a.result.correct).length;
  const missRate = 1 - correct / sorted.length;
  const lastMissed = !(sorted[sorted.length - 1] as (typeof sorted)[number]).result.correct;
  return 1 + 3 * missRate + (lastMissed ? 2 : 0);
}

function inScope(p: PoolQuestion, scope: SessionScope, missed: ReadonlySet<string>): boolean {
  switch (scope.kind) {
    case "all":
      return true;
    case "nodes":
      return p.nodeIds.some((n) => scope.nodeIds.includes(n));
    case "concepts":
      return p.question.conceptIds.some((c) => scope.conceptIds.includes(c));
    case "exam":
      return p.examIds.includes(scope.examId);
    case "missed":
      return missed.has(p.question.id);
  }
}

/**
 * Build a practice session from a pool of questions. Pure and reproducible:
 * the same input (including the seed) gives the same session.
 *
 * Questions are chosen so the types are as balanced as the pool allows (each
 * requested type gets an equal share; a type with too few questions gives its
 * share to the others). Within a type, questions she has missed are more
 * likely to be picked when `history` is supplied. The final order is shuffled.
 * If the pool is too small, the session simply has fewer than `length` items.
 */
export function buildSession(input: BuildSessionInput): PracticeSession {
  const rng = makeRng(deriveSeed(input.seed, "build"));
  const history = input.history ?? [];
  const missed = new Set(input.scope.kind === "missed" ? notebookQuestionIds(history) : []);
  const formats = [...new Set(input.formats)];

  const byType = new Map<QuestionType, Question[]>();
  const seen = new Set<string>();
  for (const p of [...input.pool].sort((a, b) => (a.question.id < b.question.id ? -1 : 1))) {
    const q = p.question;
    if (seen.has(q.id) || !formats.includes(q.type) || !inScope(p, input.scope, missed)) continue;
    seen.add(q.id);
    const list = byType.get(q.type);
    if (list) list.push(q);
    else byType.set(q.type, [q]);
  }

  // Balanced quotas: hand out one question at a time to each type in turn.
  const types = shuffled([...byType.keys()].sort(), rng);
  const quota = new Map<QuestionType, number>(types.map((t) => [t, 0]));
  const capacity = types.reduce((s, t) => s + (byType.get(t) as Question[]).length, 0);
  const target = Math.min(input.length, capacity);
  let given = 0;
  while (given < target) {
    for (const t of types) {
      if (given >= target) break;
      if ((quota.get(t) as number) < (byType.get(t) as Question[]).length) {
        quota.set(t, (quota.get(t) as number) + 1);
        given++;
      }
    }
  }

  // Her attempts by question once, so weighing a question does not read the whole history.
  const attemptsOf = new Map<string, History[number][]>();
  for (const a of history) {
    const list = attemptsOf.get(a.questionId);
    if (list) list.push(a);
    else attemptsOf.set(a.questionId, [a]);
  }

  // Weighted sampling without replacement (Efraimidis-Spirakis): larger weight, larger key.
  const chosen: Question[] = [];
  for (const t of types) {
    const keyed = (byType.get(t) as Question[]).map((q) => ({
      q,
      key: rng() ** (1 / questionWeight(q.id, attemptsOf.get(q.id) ?? [])),
    }));
    keyed.sort((a, b) => b.key - a.key || (a.q.id < b.q.id ? -1 : 1));
    chosen.push(...keyed.slice(0, quota.get(t) as number).map((k) => k.q));
  }

  const items: SessionItem[] = shuffled(chosen, rng).map((q) => ({
    questionId: q.id,
    type: q.type,
    variantSeed: deriveSeed(input.seed, "variant", q.id),
    shuffleSeed: deriveSeed(input.seed, "shuffle", q.id),
  }));

  return {
    id: input.id,
    scope: input.scope,
    formats,
    length: input.length,
    seed: input.seed,
    items,
    startedAt: input.startedAt,
    finishedAt: null,
  };
}

/** How many questions short of the requested length a session is. */
export function sessionShortfall(session: PracticeSession): number {
  return Math.max(0, session.length - session.items.length);
}

/**
 * The display order of options (or the right-hand column of a matching
 * question) for a shuffle seed. Returns the ids in the order to show.
 * With `shuffle: false` the authored order is kept.
 */
export function displayOrder<T extends { id: string }>(
  items: readonly T[],
  shuffleSeed: number,
  shuffle: boolean,
): T[] {
  return shuffle ? shuffled(items, makeRng(shuffleSeed)) : items.slice();
}
