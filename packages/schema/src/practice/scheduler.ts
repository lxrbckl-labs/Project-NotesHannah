/**
 * Spaced repetition (G9): FSRS-6 with its published default parameters.
 *
 * Why FSRS and not SM-2: FSRS models memory with two numbers per card
 * (stability: how long until recall drops to 90%; difficulty: 1 to 10), and
 * it beats SM-2 for the same number of reviews. Its formulas are published and
 * short enough to implement faithfully (this follows the open-spaced-repetition
 * reference implementations, ts-fsrs and py-fsrs, with their 21 default weights).
 *
 * Choices made here, all deterministic and pure:
 *  - No learning steps: a card's first review gives a whole-day interval of at
 *    least 1 day (the "long-term scheduler"). The client may show a card
 *    again in the same sitting; that review counts as a same-day review.
 *  - No interval fuzz (fuzz is random; this must be reproducible).
 *  - Target retention 0.9, longest interval 36,500 days.
 *  - Elapsed days are whole days (floored), as in the reference code.
 *  - The clock is passed in; nothing here reads the time.
 *
 * The same scheduler can drive any question type: use `ratingFromGrade` to turn
 * a grade into a rating.
 */
import { z } from "zod";
import { Timestamp } from "../common.js";
import { type ReviewRating as RatingT, ReviewRating } from "./answers.js";
import type { GradeResult } from "./grade-result.js";

/** The 21 default FSRS-6 parameters. */
export const FSRS_WEIGHTS: readonly number[] = [
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835,
  0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
];

export const REQUEST_RETENTION = 0.9;
export const MAXIMUM_INTERVAL_DAYS = 36_500;
const S_MIN = 0.001;
const DAY_MS = 86_400_000;

const w = (i: number): number => FSRS_WEIGHTS[i] as number;
const DECAY = -w(20);
const FACTOR = 0.9 ** (1 / DECAY) - 1;

/** What the scheduler remembers about one card (or question). */
export const CardState = z.strictObject({
  /** "new" until the first review. */
  phase: z.enum(["new", "review"]),
  /** Days until recall probability falls to 90%. 0 for a new card. */
  stability: z.number().min(0),
  /** 1 (easy) to 10 (hard). 0 for a new card. */
  difficulty: z.number().min(0).max(10),
  /** When the card is next due. */
  due: Timestamp,
  lastReview: Timestamp.nullable(),
  /** Reviews so far. */
  reps: z.number().int().min(0),
  /** Times it was forgotten ("again" on a review card). */
  lapses: z.number().int().min(0),
});
export type CardState = z.infer<typeof CardState>;

export type ClockValue = Date | string | number;

function toMs(t: ClockValue): number {
  return t instanceof Date ? t.getTime() : typeof t === "number" ? t : Date.parse(t);
}
const iso = (ms: number): string => new Date(ms).toISOString();

const round8 = (x: number): number => Math.round(x * 1e8) / 1e8;
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const GRADE: Record<RatingT, number> = { again: 1, hard: 2, good: 3, easy: 4 };

/** A card nobody has reviewed yet, due now. */
export function newCard(now: ClockValue): CardState {
  return {
    phase: "new",
    stability: 0,
    difficulty: 0,
    due: iso(toMs(now)),
    lastReview: null,
    reps: 0,
    lapses: 0,
  };
}

/** Probability of recall after `elapsedDays` for a card of this stability. */
export function retrievability(elapsedDays: number, stability: number): number {
  return (1 + (FACTOR * elapsedDays) / stability) ** DECAY;
}

/** Probability she can recall the card right now (new cards: 0). Uses fractional days; for display and sorting. */
export function currentRetrievability(card: CardState, now: ClockValue): number {
  if (card.phase === "new" || !card.lastReview) return 0;
  const elapsed = Math.max(0, (toMs(now) - Date.parse(card.lastReview)) / DAY_MS);
  return retrievability(elapsed, card.stability);
}

function initStability(g: number): number {
  return Math.max(w(g - 1), 0.1);
}
function initDifficulty(g: number): number {
  return round8(w(4) - Math.exp((g - 1) * w(5)) + 1);
}
function nextDifficulty(d: number, g: number): number {
  const delta = -w(6) * (g - 3);
  const damped = d + round8((delta * (10 - d)) / 9);
  const reverted = round8(w(7) * initDifficulty(4) + (1 - w(7)) * damped);
  return clamp(reverted, 1, 10);
}
function recallStability(d: number, s: number, r: number, g: number): number {
  const hardPenalty = g === 2 ? w(15) : 1;
  const easyBonus = g === 4 ? w(16) : 1;
  return round8(
    clamp(
      s *
        (1 +
          Math.exp(w(8)) *
            (11 - d) *
            s ** -w(9) *
            (Math.exp((1 - r) * w(10)) - 1) *
            hardPenalty *
            easyBonus),
      S_MIN,
      MAXIMUM_INTERVAL_DAYS,
    ),
  );
}
function forgetStability(d: number, s: number, r: number): number {
  const fresh = w(11) * d ** -w(12) * ((s + 1) ** w(13) - 1) * Math.exp((1 - r) * w(14));
  const ceiling = s / Math.exp(w(17) * w(18));
  return round8(clamp(Math.min(fresh, ceiling), S_MIN, MAXIMUM_INTERVAL_DAYS));
}
function sameDayStability(s: number, g: number): number {
  const sinc = s ** -w(19) * Math.exp(w(17) * (g - 3 + w(18)));
  return round8(clamp(s * (g >= 3 ? Math.max(sinc, 1) : sinc), S_MIN, MAXIMUM_INTERVAL_DAYS));
}

/** Whole days until recall falls to the target retention. At 0.9 this is the stability itself, rounded. */
function intervalFromStability(s: number): number {
  const modifier = (REQUEST_RETENTION ** (1 / DECAY) - 1) / FACTOR;
  return Math.min(Math.max(1, Math.round(s * modifier)), MAXIMUM_INTERVAL_DAYS);
}

interface Memory {
  stability: number;
  difficulty: number;
  lapse: boolean;
}

function nextMemory(card: CardState, rating: RatingT, now: number): Memory {
  const g = GRADE[rating];
  if (card.phase === "new" || !card.lastReview) {
    return {
      stability: initStability(g),
      difficulty: clamp(initDifficulty(g), 1, 10),
      lapse: false,
    };
  }
  const elapsed = Math.max(0, Math.floor((now - Date.parse(card.lastReview)) / DAY_MS));
  const r = retrievability(elapsed, card.stability);
  const difficulty = nextDifficulty(card.difficulty, g);
  if (elapsed === 0)
    return { stability: sameDayStability(card.stability, g), difficulty, lapse: false };
  if (g === 1)
    return {
      stability: forgetStability(card.difficulty, card.stability, r),
      difficulty,
      lapse: true,
    };
  return {
    stability: recallStability(card.difficulty, card.stability, r, g),
    difficulty,
    lapse: false,
  };
}

/**
 * The interval in days for each rating, kept in order (again, then hard, then
 * good, then easy, each at least a day longer than the one before except that
 * again and hard may tie at the minimum).
 */
export function nextIntervals(card: CardState, now: ClockValue): Record<RatingT, number> {
  const t = toMs(now);
  const raw = {
    again: intervalFromStability(nextMemory(card, "again", t).stability),
    hard: intervalFromStability(nextMemory(card, "hard", t).stability),
    good: intervalFromStability(nextMemory(card, "good", t).stability),
    easy: intervalFromStability(nextMemory(card, "easy", t).stability),
  };
  const again = Math.min(raw.again, raw.hard);
  const hard = Math.max(raw.hard, again + 1);
  const good = Math.max(raw.good, hard + 1);
  const easy = Math.max(raw.easy, good + 1);
  const cap = (n: number) => Math.min(n, MAXIMUM_INTERVAL_DAYS);
  return { again: cap(again), hard: cap(hard), good: cap(good), easy: cap(easy) };
}

export interface ReviewOutcome {
  card: CardState;
  /** Days until the next review. */
  intervalDays: number;
  /** Recall probability just before this review (null for a new card). */
  retrievabilityBefore: number | null;
}

/** Apply one review. Returns the new card state; the input is not changed. */
export function reviewCard(card: CardState, rating: RatingT, now: ClockValue): ReviewOutcome {
  const t = toMs(now);
  const memory = nextMemory(card, rating, t);
  const intervalDays = nextIntervals(card, now)[rating];
  const before =
    card.phase === "new" || !card.lastReview
      ? null
      : retrievability(
          Math.max(0, Math.floor((t - Date.parse(card.lastReview)) / DAY_MS)),
          card.stability,
        );
  return {
    card: {
      phase: "review",
      stability: memory.stability,
      difficulty: memory.difficulty,
      due: iso(t + intervalDays * DAY_MS),
      lastReview: iso(t),
      reps: card.reps + 1,
      lapses: card.lapses + (memory.lapse ? 1 : 0),
    },
    intervalDays,
    retrievabilityBefore: before,
  };
}

export interface DueOptions {
  /** Most cards to return in all. */
  limit?: number;
  /** Most new (never reviewed) cards to include. Default: no limit. */
  newLimit?: number;
}

/**
 * Cards due at `now`: reviews whose due time has passed, most overdue first,
 * then new cards in id order. Ties break by id so the order is stable.
 */
export function dueCards<T extends { id: string; card: CardState }>(
  cards: readonly T[],
  now: ClockValue,
  options: DueOptions = {},
): T[] {
  const t = toMs(now);
  const reviews = cards
    .filter((c) => c.card.phase === "review" && Date.parse(c.card.due) <= t)
    .sort((a, b) => Date.parse(a.card.due) - Date.parse(b.card.due) || (a.id < b.id ? -1 : 1));
  const fresh = cards
    .filter((c) => c.card.phase === "new")
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .slice(0, options.newLimit ?? Number.POSITIVE_INFINITY);
  return [...reviews, ...fresh].slice(0, options.limit ?? Number.POSITIVE_INFINITY);
}

/**
 * Turn a grade into a rating, so any question type can be scheduled:
 * correct is "good"; partly right (score at least 0.5) is "hard"; the rest is "again".
 */
export function ratingFromGrade(result: Pick<GradeResult, "correct" | "score">): RatingT {
  if (result.correct) return "good";
  return result.score >= 0.5 ? "hard" : "again";
}

export { ReviewRating };
