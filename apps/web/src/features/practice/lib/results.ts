import type { QuestionType, ResultItem, ServedQuestion } from "../types";

export interface ResultSummary {
  total: number;
  answered: number;
  skipped: number;
  /** Questions fully right (a flashcard counts unless she said "again"). */
  correct: number;
  points: number;
  maxPoints: number;
  /** correct / answered, or null when nothing was answered. */
  accuracy: number | null;
  timeMs: number;
  byType: { type: QuestionType; total: number; correct: number }[];
  notebookAdded: ResultItem[];
  notebookCleared: ResultItem[];
  missed: ResultItem[];
}

/** The numbers on the results screen. Skipped and unanswered questions are not counted as wrong. */
export function summarise(items: readonly ResultItem[]): ResultSummary {
  const answered = items.filter((i) => i.outcome);
  const byType = new Map<QuestionType, { total: number; correct: number }>();
  let points = 0;
  let maxPoints = 0;
  let correct = 0;
  for (const item of answered) {
    const r = (item.outcome as NonNullable<ResultItem["outcome"]>).result;
    points += r.points;
    maxPoints += r.maxPoints;
    if (r.correct) correct++;
    const t = byType.get(item.question.type) ?? { total: 0, correct: 0 };
    t.total++;
    if (r.correct) t.correct++;
    byType.set(item.question.type, t);
  }
  return {
    total: items.length,
    answered: answered.length,
    skipped: items.length - answered.length,
    correct,
    points,
    maxPoints,
    accuracy: answered.length ? correct / answered.length : null,
    timeMs: items.reduce((s, i) => s + i.timeTakenMs, 0),
    byType: [...byType.entries()].map(([type, v]) => ({ type, ...v })),
    notebookAdded: answered.filter(
      (i) => i.outcome?.notebook === "added" || i.outcome?.notebook === "kept",
    ),
    notebookCleared: answered.filter((i) => i.outcome?.notebook === "cleared"),
    missed: answered.filter((i) => !i.outcome?.result.correct),
  };
}

/** A one-line version of a question for lists. Strips the light markdown and turns blanks into ___. */
export function shortPrompt(q: ServedQuestion, max = 140): string {
  const raw =
    q.type === "case"
      ? q.vignette
      : q.type === "flashcard"
        ? q.front
        : q.type === "fill_blank"
          ? q.text.replace(/\{\{\d+\}\}/g, "___")
          : q.prompt;
  const plain = raw.replace(/[*`]/g, "").replace(/\s+/g, " ").trim();
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
}

export function percent(x: number | null): string {
  return x === null ? "–" : `${Math.round(x * 100)}%`;
}
