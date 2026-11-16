import { describe, expect, it } from "vitest";
import {
  CardState,
  currentRetrievability,
  dueCards,
  FSRS_WEIGHTS,
  MAXIMUM_INTERVAL_DAYS,
  newCard,
  nextIntervals,
  ratingFromGrade,
  retrievability,
  reviewCard,
} from "../src/practice/scheduler.js";

const T0 = "2026-11-15T09:00:00.000Z";
const days = (n: number, from = T0) => new Date(Date.parse(from) + n * 86_400_000).toISOString();

describe("FSRS-6 parameters and curve", () => {
  it("uses the 21 published default weights", () => {
    expect(FSRS_WEIGHTS).toHaveLength(21);
    expect(FSRS_WEIGHTS.slice(0, 4)).toEqual([0.212, 1.2931, 2.3065, 8.2956]);
    expect(FSRS_WEIGHTS[20]).toBe(0.1542);
  });
  it("recall is 90% when elapsed time equals stability (the definition of stability)", () => {
    for (const s of [0.5, 1, 7, 30, 365]) expect(retrievability(s, s)).toBeCloseTo(0.9, 12);
  });
  it("recall is 100% at time zero and falls with time", () => {
    expect(retrievability(0, 5)).toBe(1);
    expect(retrievability(10, 5)).toBeLessThan(retrievability(5, 5));
    expect(retrievability(100, 5)).toBeGreaterThan(0);
  });
  it("matches a hand-computed point", () => {
    // R(3, 2.3065) = (1 + 0.9803464944 * 3 / 2.3065) ^ -0.1542
    expect(retrievability(3, 2.3065)).toBeCloseTo(0.8809479557659419, 10);
  });
});

describe("first review of a new card", () => {
  const card = newCard(T0);
  it("starts new and due now", () => {
    expect(card).toMatchObject({ phase: "new", reps: 0, lapses: 0, lastReview: null, due: T0 });
    expect(CardState.safeParse(card).success).toBe(true);
  });
  it.each([
    ["again", 0.212, 6.4133],
    ["hard", 1.2931, 5.11217071],
    ["good", 2.3065, 2.11810397],
    ["easy", 8.2956, 1],
  ] as const)("%s sets stability and difficulty from the weights", (rating, s, d) => {
    const { card: next, retrievabilityBefore } = reviewCard(card, rating, T0);
    expect(next.stability).toBeCloseTo(s, 8);
    expect(next.difficulty).toBeCloseTo(d, 8);
    expect(next).toMatchObject({ phase: "review", reps: 1, lapses: 0, lastReview: T0 });
    expect(retrievabilityBefore).toBeNull();
  });
  it("gives increasing whole-day intervals, at least a day", () => {
    expect(nextIntervals(card, T0)).toEqual({ again: 1, hard: 2, good: 3, easy: 8 });
  });
  it("sets the due date from the interval", () => {
    expect(reviewCard(card, "good", T0).card.due).toBe(days(3));
    expect(reviewCard(card, "easy", T0).card.due).toBe(days(8));
    expect(reviewCard(card, "again", T0).card.due).toBe(days(1));
  });
  it("does not change the card it was given", () => {
    const frozen = JSON.stringify(card);
    reviewCard(card, "good", T0);
    expect(JSON.stringify(card)).toBe(frozen);
  });
});

describe("later reviews (hand-computed with the published formulas)", () => {
  // New card, Good at T0 (S 2.3065, D 2.11810397), reviewed again 3 days later.
  const first = reviewCard(newCard(T0), "good", T0).card;
  const at3 = days(3);

  it("recall just before the review is about 88%", () => {
    expect(reviewCard(first, "good", at3).retrievabilityBefore).toBeCloseTo(0.8809479557659419, 10);
  });
  it.each([
    ["good", 13.82690369, 2.11121424],
    ["hard", 9.23487078, 4.75285849],
    ["easy", 23.88306408, 1],
  ] as const)("%s on day 3", (rating, stability, difficulty) => {
    const { card } = reviewCard(first, rating, at3);
    expect(card.stability).toBeCloseTo(stability, 7);
    expect(card.difficulty).toBeCloseTo(difficulty, 7);
    expect(card.reps).toBe(2);
    expect(card.lapses).toBe(0);
  });
  it("again on day 3 is a lapse with a much smaller stability and higher difficulty", () => {
    const { card } = reviewCard(first, "again", at3);
    expect(card.stability).toBeCloseTo(0.6368507, 7);
    expect(card.difficulty).toBeCloseTo(7.39450274, 7);
    expect(card.lapses).toBe(1);
    expect(card.due).toBe(days(1, at3));
  });
  it("intervals follow stability: good is 14 days after day 3", () => {
    const out = reviewCard(first, "good", at3);
    expect(out.intervalDays).toBe(14);
    expect(out.card.due).toBe(days(14, at3));
  });
  it("keeps again < hard < good < easy", () => {
    const iv = nextIntervals(first, at3);
    expect(iv.again).toBeLessThan(iv.hard);
    expect(iv.hard).toBeLessThan(iv.good);
    expect(iv.good).toBeLessThan(iv.easy);
    expect(iv).toEqual({ again: 1, hard: 9, good: 14, easy: 24 });
  });
  it("a same-day review uses the short-term rule and does not lapse", () => {
    const again = reviewCard(first, "again", T0).card;
    expect(again.stability).toBeCloseTo(0.77508398, 7);
    expect(again.lapses).toBe(0);
    expect(reviewCard(first, "good", T0).card.stability).toBeCloseTo(2.3065, 7);
    expect(reviewCard(first, "hard", T0).card.stability).toBeCloseTo(1.33337872, 7);
    expect(reviewCard(first, "easy", T0).card.stability).toBeCloseTo(3.94605407, 7);
  });
  it("reviewing late counts the days since the last review, not the due date", () => {
    const { retrievabilityBefore } = reviewCard(first, "good", days(30));
    expect(retrievabilityBefore).toBeCloseTo(retrievability(30, 2.3065), 10);
  });
  it("difficulty stays between 1 and 10 however she answers", () => {
    let card = newCard(T0);
    let t = T0;
    for (let i = 0; i < 60; i++) {
      const r = reviewCard(card, i % 2 ? "again" : "hard", t);
      card = r.card;
      t = days(r.intervalDays, t);
      expect(card.difficulty).toBeGreaterThanOrEqual(1);
      expect(card.difficulty).toBeLessThanOrEqual(10);
    }
    let easy = newCard(T0);
    for (let i = 0; i < 60; i++) {
      const r = reviewCard(easy, "easy", t);
      easy = r.card;
      t = days(r.intervalDays, t);
      expect(easy.difficulty).toBeGreaterThanOrEqual(1);
    }
  });
  it("stability grows when she keeps answering good on time, and intervals never pass the cap", () => {
    let card = newCard(T0);
    let t = T0;
    let last = 0;
    for (let i = 0; i < 40; i++) {
      const r = reviewCard(card, "good", t);
      expect(r.card.stability).toBeGreaterThanOrEqual(last);
      expect(r.intervalDays).toBeLessThanOrEqual(MAXIMUM_INTERVAL_DAYS);
      last = r.card.stability;
      card = r.card;
      t = days(r.intervalDays, t);
    }
    expect(card.stability).toBeGreaterThan(1000);
  });
  it("is deterministic: the same inputs give the same card", () => {
    const a = reviewCard(first, "good", at3);
    const b = reviewCard(first, "good", at3);
    expect(a).toEqual(b);
  });
  it("accepts a Date or a millisecond clock", () => {
    const a = reviewCard(first, "good", new Date(at3));
    const b = reviewCard(first, "good", Date.parse(at3));
    expect(a).toEqual(reviewCard(first, "good", at3));
    expect(b).toEqual(a);
  });
  it("shows current recall for display", () => {
    expect(currentRetrievability(newCard(T0), T0)).toBe(0);
    expect(currentRetrievability(first, T0)).toBe(1);
    expect(currentRetrievability(first, days(2.3065))).toBeCloseTo(0.9, 6);
  });
});

describe("due cards", () => {
  const mk = (id: string, due: string | null) => ({
    id,
    card: due === null ? newCard(T0) : { ...reviewCard(newCard(T0), "good", T0).card, due },
  });
  const now = days(10);
  const cards = [
    mk("c", days(9)),
    mk("a", days(2)),
    mk("later", days(11)),
    mk("n2", null),
    mk("b", days(2)),
    mk("n1", null),
    mk("exact", now),
  ];
  it("lists overdue reviews first (most overdue first, ties by id), then new cards", () => {
    expect(dueCards(cards, now).map((c) => c.id)).toEqual(["a", "b", "c", "exact", "n1", "n2"]);
  });
  it("does not list cards due in the future", () => {
    expect(dueCards(cards, now).some((c) => c.id === "later")).toBe(false);
    expect(dueCards(cards, days(11)).some((c) => c.id === "later")).toBe(true);
  });
  it("limits new cards and the total", () => {
    expect(dueCards(cards, now, { newLimit: 1 }).map((c) => c.id)).toEqual([
      "a",
      "b",
      "c",
      "exact",
      "n1",
    ]);
    expect(dueCards(cards, now, { newLimit: 0 }).map((c) => c.id)).toEqual([
      "a",
      "b",
      "c",
      "exact",
    ]);
    expect(dueCards(cards, now, { limit: 2 }).map((c) => c.id)).toEqual(["a", "b"]);
  });
  it("is empty when nothing is due", () => {
    expect(dueCards([mk("x", days(50))], now)).toEqual([]);
    expect(dueCards([], now)).toEqual([]);
  });
});

describe("other question types", () => {
  it("maps a grade to a rating", () => {
    expect(ratingFromGrade({ correct: true, score: 1 })).toBe("good");
    expect(ratingFromGrade({ correct: false, score: 0.6 })).toBe("hard");
    expect(ratingFromGrade({ correct: false, score: 0.5 })).toBe("hard");
    expect(ratingFromGrade({ correct: false, score: 0.49 })).toBe("again");
    expect(ratingFromGrade({ correct: false, score: 0 })).toBe("again");
  });
});
