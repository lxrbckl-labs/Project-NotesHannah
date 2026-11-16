import { createEmptyCard, fsrs, generatorParameters, Rating } from "ts-fsrs";
import { describe, expect, it } from "vitest";
import { FSRS_WEIGHTS, newCard, reviewCard } from "../src/practice/scheduler.js";

/**
 * Cross-check our scheduler against the reference implementation (ts-fsrs),
 * configured the same way: default weights, no fuzz, no learning steps.
 */
const reference = fsrs(
  generatorParameters({
    w: [...FSRS_WEIGHTS],
    request_retention: 0.9,
    maximum_interval: 36_500,
    enable_fuzz: false,
    enable_short_term: false,
  }),
);

const RATINGS = ["again", "hard", "good", "easy"] as const;
const REF = { again: Rating.Again, hard: Rating.Hard, good: Rating.Good, easy: Rating.Easy };
const DAY = 86_400_000;

function lcg(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe("scheduler matches the reference FSRS implementation", () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`sequence ${seed}`, () => {
      const random = lcg(seed);
      let now = Date.UTC(2026, 10, 15, 12);
      let ours = newCard(now);
      let theirs = createEmptyCard(new Date(now));
      for (let step = 0; step < 40; step++) {
        const rating = RATINGS[Math.floor(random() * 4)] as (typeof RATINGS)[number];
        const outcome = reviewCard(ours, rating, now);
        const next = reference.next(theirs, new Date(now), REF[rating]);
        ours = outcome.card;
        theirs = next.card;
        const where = `seed ${seed} step ${step} rating ${rating}`;
        expect(ours.stability, `stability at ${where}`).toBeCloseTo(theirs.stability, 3);
        expect(ours.difficulty, `difficulty at ${where}`).toBeCloseTo(theirs.difficulty, 3);
        expect(outcome.intervalDays, `interval at ${where}`).toBe(theirs.scheduled_days);
        // Review on time, early or late, in whole days.
        const offset = Math.floor(random() * 5) - 1;
        now += Math.max(1, outcome.intervalDays + offset) * DAY;
      }
    });
  }
});
