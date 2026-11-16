import type { Attempt } from "./session.js";

/** What the weak-areas view needs to know about a question: its labels and where it lives. */
export interface QuestionLabels {
  questionId: string;
  tags: readonly string[];
  conceptIds: readonly string[];
  /** The lecture and every folder above it. */
  nodeIds: readonly string[];
}

export interface WeakAreaOptions {
  /** Fewest attempts before an area can be called weak or fine. Default 5. */
  minAttempts?: number;
  /** Fewest different questions behind those attempts (or all the area has, if fewer). Default 3. */
  minQuestions?: number;
  /** Accuracy below this is weak. Default 0.7. */
  weakBelow?: number;
}

export type AreaStatus = "weak" | "ok" | "insufficient_data";

export interface AreaStat {
  key: string;
  attempts: number;
  correct: number;
  /** correct / attempts, 0 to 1. */
  accuracy: number;
  /** Average score (partial credit counts), 0 to 1. */
  meanScore: number;
  /** Different questions attempted. */
  questions: number;
  status: AreaStatus;
}

export interface WeakAreaReport {
  byTag: AreaStat[];
  byConcept: AreaStat[];
  byNode: AreaStat[];
  /** Attempts whose question is not in the labels given (deleted questions, say). */
  unmatchedAttempts: number;
}

type AttemptLike = Pick<Attempt, "questionId" | "result">;

function tally(
  rows: Array<{ keys: readonly string[]; attempt: AttemptLike }>,
  totalPerKey: Map<string, number>,
  opts: Required<WeakAreaOptions>,
): AreaStat[] {
  const acc = new Map<
    string,
    { attempts: number; correct: number; score: number; questions: Set<string> }
  >();
  for (const { keys, attempt } of rows) {
    for (const key of keys) {
      let s = acc.get(key);
      if (!s) {
        s = { attempts: 0, correct: 0, score: 0, questions: new Set() };
        acc.set(key, s);
      }
      s.attempts++;
      if (attempt.result.correct) s.correct++;
      s.score += attempt.result.score;
      s.questions.add(attempt.questionId);
    }
  }
  const stats: AreaStat[] = [...acc.entries()].map(([key, s]) => {
    const accuracy = s.correct / s.attempts;
    const needQuestions = Math.min(opts.minQuestions, totalPerKey.get(key) ?? opts.minQuestions);
    const enough = s.attempts >= opts.minAttempts && s.questions.size >= needQuestions;
    const status: AreaStatus = !enough
      ? "insufficient_data"
      : accuracy < opts.weakBelow
        ? "weak"
        : "ok";
    return {
      key,
      attempts: s.attempts,
      correct: s.correct,
      accuracy,
      meanScore: s.score / s.attempts,
      questions: s.questions.size,
      status,
    };
  });
  const rank = { weak: 0, ok: 1, insufficient_data: 2 } as const;
  return stats.sort(
    (a, b) =>
      rank[a.status] - rank[b.status] || a.accuracy - b.accuracy || (a.key < b.key ? -1 : 1),
  );
}

/**
 * Accuracy by tag, concept and lecture/folder. An area is only called weak
 * (or fine) once it has enough attempts across enough different questions, so
 * one wrong answer, or one question retried five times, never labels a topic.
 * Areas without enough data are listed as "insufficient_data", last.
 */
export function weakAreas(
  attempts: ReadonlyArray<AttemptLike>,
  labels: ReadonlyArray<QuestionLabels>,
  options: WeakAreaOptions = {},
): WeakAreaReport {
  const opts: Required<WeakAreaOptions> = {
    minAttempts: options.minAttempts ?? 5,
    minQuestions: options.minQuestions ?? 3,
    weakBelow: options.weakBelow ?? 0.7,
  };
  // Each question's keys once, without repeats: an attempt then costs one pass over them.
  const byId = new Map(
    labels.map((l) => [
      l.questionId,
      {
        tags: [...new Set(l.tags)],
        conceptIds: [...new Set(l.conceptIds)],
        nodeIds: [...new Set(l.nodeIds)],
      },
    ]),
  );
  const totals = {
    tag: new Map<string, number>(),
    concept: new Map<string, number>(),
    node: new Map<string, number>(),
  };
  for (const l of labels) {
    for (const k of new Set(l.tags)) totals.tag.set(k, (totals.tag.get(k) ?? 0) + 1);
    for (const k of new Set(l.conceptIds)) totals.concept.set(k, (totals.concept.get(k) ?? 0) + 1);
    for (const k of new Set(l.nodeIds)) totals.node.set(k, (totals.node.get(k) ?? 0) + 1);
  }
  let unmatched = 0;
  const tagRows: Array<{ keys: readonly string[]; attempt: AttemptLike }> = [];
  const conceptRows: typeof tagRows = [];
  const nodeRows: typeof tagRows = [];
  for (const attempt of attempts) {
    const l = byId.get(attempt.questionId);
    if (!l) {
      unmatched++;
      continue;
    }
    tagRows.push({ keys: l.tags, attempt });
    conceptRows.push({ keys: l.conceptIds, attempt });
    nodeRows.push({ keys: l.nodeIds, attempt });
  }
  return {
    byTag: tally(tagRows, totals.tag, opts),
    byConcept: tally(conceptRows, totals.concept, opts),
    byNode: tally(nodeRows, totals.node, opts),
    unmatchedAttempts: unmatched,
  };
}
