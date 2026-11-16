import { practice } from "@notes/schema";
import { BANK } from "../store/bank";
import { createMockStore } from "../store/mock";
import { serveQuestion } from "../store/strip";
import type { GradeResult, ServedQuestion } from "../types";

export const SEEDS = { variantSeed: 5, shuffleSeed: 9 };

/** The first bank question of a type whose text contains `needle`. */
export function find(type: string, needle = "") {
  const q = BANK.find(
    (x) => x.type === type && JSON.stringify(x).toLowerCase().includes(needle.toLowerCase()),
  );
  if (!q) throw new Error(`no ${type} question with "${needle}"`);
  return q;
}

export function serve(type: string, needle = ""): ServedQuestion {
  return serveQuestion(find(type, needle), SEEDS, 0);
}

export function graded(type: string, needle: string, answer: unknown): GradeResult {
  return practice.grade(find(type, needle), answer, { variantSeed: SEEDS.variantSeed });
}

/** A mock store with a fixed clock that advances one second per call. */
export function newStore(start: "empty" | "demo" = "empty") {
  let t = Date.parse("2026-11-15T10:00:00");
  return createMockStore({
    start,
    seed: 4,
    now: () => {
      t += 1000;
      return new Date(t);
    },
  });
}
