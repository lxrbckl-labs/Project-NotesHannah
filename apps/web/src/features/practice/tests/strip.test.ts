import { expect, test } from "vitest";
import { BANK } from "../store/bank";
import { serveQuestion } from "../store/strip";
import { newStore } from "./fixtures";

const FORBIDDEN_KEYS = [
  "correct",
  "rationale",
  "explanation",
  "answers",
  "answer",
  "expression",
  "variables",
  "modelAnswer",
  "rubric",
  "back",
  "tolerance",
  "convertUnits",
  "pairs",
  "sources",
  "strict",
  "allowTypos",
  "units",
  "shuffle",
  "passFraction",
];

function keysDeep(x: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(x)) for (const v of x) keysDeep(v, out);
  else if (x && typeof x === "object")
    for (const [k, v] of Object.entries(x)) {
      out.add(k);
      keysDeep(v, out);
    }
  return out;
}

test("the bank covers every question type with about forty questions", () => {
  expect(BANK.length).toBeGreaterThanOrEqual(38);
  expect(new Set(BANK.map((q) => q.type)).size).toBe(8);
  // matching has brand/generic pairs and distractors; calculations have variants and units
  expect(BANK.some((q) => q.type === "matching" && q.distractors.length > 0)).toBe(true);
  expect(BANK.some((q) => q.type === "calculation" && q.answer.kind === "expression")).toBe(true);
});

test("a served question carries no answer material, for every question and several seeds", () => {
  for (const q of BANK) {
    for (const seed of [1, 2, 3]) {
      const served = serveQuestion(q, { variantSeed: seed, shuffleSeed: seed + 10 }, 0);
      const keys = keysDeep(served);
      for (const bad of FORBIDDEN_KEYS) expect(keys.has(bad), `${q.id} leaks "${bad}"`).toBe(false);
      const json = JSON.stringify(served);
      if (q.type === "flashcard") expect(json).not.toContain(q.back);
      if (q.type === "free_response") {
        expect(json).not.toContain(q.modelAnswer);
        for (const r of q.rubric) expect(json).not.toContain(r.point);
      }
      if (q.type === "matching") {
        // the pairing is not recoverable from the order the lefts and rights are sent in
        expect(keys.has("right")).toBe(false);
      }
      expect(json).not.toContain(q.explanation === "" ? "\u0000" : q.explanation);
    }
  }
});

test("what the mock store hands the player for a whole session has no answer material", async () => {
  const store = newStore();
  const session = await store.startSession({
    scope: { kind: "all" },
    formats: [
      "multiple_choice",
      "select_all",
      "matching",
      "fill_blank",
      "calculation",
      "flashcard",
      "case",
      "free_response",
    ],
    length: 40,
  });
  expect(session.total).toBe(40);
  for (let i = 0; i < session.total; i++) {
    const s = await store.getSession(session.id);
    const keys = keysDeep(s);
    for (const bad of FORBIDDEN_KEYS) expect(keys.has(bad), `session leaks "${bad}"`).toBe(false);
    await store.skip(session.id, s.current?.index ?? i);
  }
});

test("a calculation shows this variant's numbers and its rounding instruction", async () => {
  const store = newStore();
  const s = await store.startSession({
    scope: { kind: "all" },
    formats: ["calculation"],
    length: 6,
  });
  const seen = new Set<string>();
  for (const it of s.items) seen.add(it.type);
  expect(seen).toEqual(new Set(["calculation"]));
  const cur = s.current;
  expect(cur?.type).toBe("calculation");
  if (cur?.type === "calculation") {
    expect(cur.prompt).not.toMatch(/\{[a-zA-Z]+\}/);
    expect(cur.unitChoices.length).toBeGreaterThan(2);
  }
});
