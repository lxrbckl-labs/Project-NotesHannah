import type { QuestionType } from "./content.js";
import type { Attempt } from "./session.js";

/**
 * The missed-questions notebook (G11).
 *
 * THE RULE. Look at one question's attempts in time order.
 *  - An incorrect attempt puts the question in the notebook (or keeps it
 *    there) and resets its run of correct answers to zero.
 *  - While it is in the notebook, each correct attempt adds one to the run;
 *    an incorrect attempt resets the run to zero.
 *  - When the run reaches the number the question type needs, it leaves.
 *  - A correct attempt on a question that is not in the notebook changes nothing.
 *
 * The run a type needs: 1 correct answer for most types; 2 consecutive for
 * calculation (a first success can be luck or a memorised variant). Flashcards
 * never enter the notebook: they have their own review deck and schedule, and
 * "again" on a card is not a miss. Attempts count only when they carry a
 * result (self-graded types use her self-assessment).
 */
export const NOTEBOOK_CORRECT_RUN: Record<QuestionType, number> = {
  multiple_choice: 1,
  select_all: 1,
  matching: 1,
  fill_blank: 1,
  calculation: 2,
  flashcard: 0,
  case: 1,
  free_response: 1,
};

export interface NotebookEntry {
  questionId: string;
  type: QuestionType;
  /** How many times it has been missed in total. */
  timesMissed: number;
  firstMissedAt: string;
  lastMissedAt: string;
  /** Consecutive correct answers since the last miss. */
  correctRun: number;
  /** How many consecutive correct answers it still needs to leave. */
  stillNeeds: number;
}

type AttemptLike = Pick<Attempt, "questionId" | "at" | "answer" | "result">;

/** The questions currently in the notebook, most recently missed first. */
export function notebookEntries(
  attempts: ReadonlyArray<AttemptLike>,
  runs: Record<QuestionType, number> = NOTEBOOK_CORRECT_RUN,
): NotebookEntry[] {
  const ordered = attempts
    .map((a, i) => ({ a, i }))
    .sort((x, y) => (x.a.at < y.a.at ? -1 : x.a.at > y.a.at ? 1 : x.i - y.i))
    .map((x) => x.a);
  const state = new Map<string, NotebookEntry & { inside: boolean }>();
  for (const a of ordered) {
    const type = a.answer.type;
    const need = runs[type];
    if (need <= 0) continue;
    let s = state.get(a.questionId);
    if (!s) {
      s = {
        questionId: a.questionId,
        type,
        timesMissed: 0,
        firstMissedAt: a.at,
        lastMissedAt: a.at,
        correctRun: 0,
        stillNeeds: need,
        inside: false,
      };
      state.set(a.questionId, s);
    }
    if (!a.result.correct) {
      if (!s.inside) s.firstMissedAt = a.at;
      s.inside = true;
      s.timesMissed++;
      s.lastMissedAt = a.at;
      s.correctRun = 0;
      s.stillNeeds = need;
    } else if (s.inside) {
      s.correctRun++;
      s.stillNeeds = Math.max(0, need - s.correctRun);
      if (s.correctRun >= need) {
        s.inside = false;
        s.correctRun = 0;
      }
    }
  }
  return [...state.values()]
    .filter((s) => s.inside)
    .sort((x, y) =>
      x.lastMissedAt < y.lastMissedAt ? 1 : x.lastMissedAt > y.lastMissedAt ? -1 : 0,
    )
    .map(({ inside: _inside, ...entry }) => entry);
}

/** Just the ids of the questions in the notebook. */
export function notebookQuestionIds(attempts: ReadonlyArray<AttemptLike>): string[] {
  return notebookEntries(attempts).map((e) => e.questionId);
}
