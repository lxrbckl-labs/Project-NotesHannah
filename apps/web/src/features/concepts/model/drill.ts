import type { BrandGenericPair } from "@notes/schema";

export type DrillMode = "brand_to_generic" | "generic_to_brand" | "drug_to_class";

export const DRILL_MODES: Array<{ mode: DrillMode; label: string; hint: string }> = [
  {
    mode: "brand_to_generic",
    label: "Brand to generic",
    hint: "Match each brand name to its generic drug.",
  },
  {
    mode: "generic_to_brand",
    label: "Generic to brand",
    hint: "Match each generic drug to a brand name.",
  },
  { mode: "drug_to_class", label: "Drug to class", hint: "Match each drug to its class." },
];

export interface DrillItem {
  /** Stable for a pair and a mode. */
  id: string;
  prompt: string;
  answer: string;
  conceptId: string;
}

export const ROUND_SIZE = 6;

function itemOf(pair: BrandGenericPair, mode: DrillMode): DrillItem | null {
  const base = { id: `${mode}:${pair.conceptId}:${pair.brand}`, conceptId: pair.conceptId };
  if (mode === "brand_to_generic") return { ...base, prompt: pair.brand, answer: pair.generic };
  if (mode === "generic_to_brand") return { ...base, prompt: pair.generic, answer: pair.brand };
  return pair.drugClass
    ? { ...base, id: `${mode}:${pair.conceptId}`, prompt: pair.generic, answer: pair.drugClass }
    : null;
}

/** All the questions a mode can ask of these pairs, one per prompt (no repeated prompts). */
export function itemsFor(pairs: BrandGenericPair[], mode: DrillMode): DrillItem[] {
  const seen = new Set<string>();
  const out: DrillItem[] = [];
  for (const pair of pairs) {
    const item = itemOf(pair, mode);
    if (!item || seen.has(item.prompt)) continue;
    seen.add(item.prompt);
    out.push(item);
  }
  return out;
}

export type Rng = () => number;

/** A small seedable generator, so a demo or a test can fix the round. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(list: readonly T[], rng: Rng = Math.random): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/** Items for a round: prefer distinct answers so each tile on the right has one partner. */
export function pickRound(
  items: DrillItem[],
  size = ROUND_SIZE,
  rng: Rng = Math.random,
): DrillItem[] {
  const chosen: DrillItem[] = [];
  const answers = new Set<string>();
  for (const item of shuffle(items, rng)) {
    if (chosen.length >= size) break;
    if (answers.has(item.answer)) continue;
    answers.add(item.answer);
    chosen.push(item);
  }
  for (const item of shuffle(items, rng)) {
    if (chosen.length >= Math.min(size, items.length)) break;
    if (!chosen.includes(item)) chosen.push(item);
  }
  return chosen;
}

export interface Round {
  items: DrillItem[];
  /** The tiles on the right: each answer once. */
  answers: string[];
  matched: string[];
  /** Items answered wrong at least once, in the order first missed. */
  missed: string[];
  attempts: number;
}

export function startRound(items: DrillItem[], rng: Rng = Math.random): Round {
  return {
    items,
    answers: shuffle([...new Set(items.map((i) => i.answer))], rng),
    matched: [],
    missed: [],
    attempts: 0,
  };
}

export type Attempt = { round: Round; correct: boolean };

/** Pair one prompt with one answer. A pair that is already matched changes nothing. */
export function attempt(round: Round, itemId: string, answer: string): Attempt {
  const item = round.items.find((i) => i.id === itemId);
  if (!item || round.matched.includes(itemId)) return { round, correct: false };
  const correct = item.answer === answer;
  return {
    correct,
    round: {
      ...round,
      attempts: round.attempts + 1,
      matched: correct ? [...round.matched, itemId] : round.matched,
      missed: correct || round.missed.includes(itemId) ? round.missed : [...round.missed, itemId],
    },
  };
}

export const isFinished = (round: Round) => round.matched.length === round.items.length;

/** An answer tile is used up once every prompt that wants it is matched. */
export function answerDone(round: Round, answer: string): boolean {
  const wanting = round.items.filter((i) => i.answer === answer);
  return wanting.every((i) => round.matched.includes(i.id));
}

export function score(round: Round): { firstTry: number; total: number } {
  return { firstTry: round.items.length - round.missed.length, total: round.items.length };
}

/** The items missed in a round, for "missed ones again". */
export function missedItems(round: Round): DrillItem[] {
  return round.items.filter((i) => round.missed.includes(i.id));
}
