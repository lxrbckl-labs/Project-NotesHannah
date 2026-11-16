import { describe, expect, it } from "vitest";
import { newId } from "../src/ids.js";
import { instantiateCalculation } from "../src/practice/calculation.js";
import type { Question, QuestionInput } from "../src/practice/content.js";
import { grade, isAppGraded, maxPointsOf } from "../src/practice/grading.js";
import { exampleFor } from "../src/practice/registry.js";
import {
  editDistance,
  matchBlank,
  normaliseLoose,
  normaliseStrict,
} from "../src/practice/text-match.js";
import { toStoredQuestion, validateQuestionInput } from "../src/practice/validate.js";

const SRC = exampleFor("multiple_choice").sources;

function store(input: Record<string, unknown>): Question {
  const v = validateQuestionInput({ sources: SRC, ...input });
  if (!v.ok) throw new Error(JSON.stringify(v.problems, null, 2));
  return toStoredQuestion(v.question as QuestionInput, {
    author: { type: "user", userId: newId("user") },
    now: "2026-11-15T12:00:00.000Z",
  });
}

describe("multiple choice", () => {
  const q = store({
    type: "multiple_choice",
    prompt: "Which?",
    options: [
      { text: "Alpha", rationale: "Alpha is wrong because..." },
      { text: "Beta", correct: true, rationale: "Beta is right because..." },
      { text: "Gamma" },
    ],
    explanation: "Because.",
  });
  const id = (text: string) =>
    (q as Extract<Question, { type: "multiple_choice" }>).options.find((o) => o.text === text)
      ?.id as string;

  it("grades the right option", () => {
    const r = grade(q, { type: "multiple_choice", optionId: id("Beta") });
    expect(r).toMatchObject({
      correct: true,
      score: 1,
      points: 1,
      maxPoints: 1,
      malformed: false,
      selfGraded: false,
    });
    expect(r.feedback[0]?.message).toContain("Beta is right");
    expect(r.correctAnswer.text).toBe("Beta");
    expect(r.correctAnswer.data).toEqual({ type: "multiple_choice", optionId: id("Beta") });
  });
  it("grades a wrong option and explains using both rationales", () => {
    const r = grade(q, { type: "multiple_choice", optionId: id("Alpha") });
    expect(r).toMatchObject({ correct: false, score: 0, points: 0 });
    expect(r.feedback[0]?.message).toContain("Alpha is wrong");
    expect(r.feedback[0]?.message).toContain("Beta is right");
  });
  it("works for an option without a rationale", () => {
    expect(grade(q, { type: "multiple_choice", optionId: id("Gamma") }).feedback[0]?.message).toBe(
      'Not correct. The correct answer is "Beta". Beta is right because...',
    );
  });
  it("is not thrown by an unknown option", () => {
    const r = grade(q, { type: "multiple_choice", optionId: "zz" });
    expect(r).toMatchObject({ correct: false, malformed: true, score: 0 });
    expect(r.feedback[0]?.message).toContain("zz");
    expect(r.correctAnswer.text).toBe("Beta");
  });
});

describe("select all", () => {
  const q = store({
    type: "select_all",
    prompt: "Select all.",
    options: [
      { text: "A", correct: true },
      { text: "B", correct: true },
      { text: "C", correct: true },
      { text: "D" },
      { text: "E" },
    ],
    explanation: "Because.",
  }) as Extract<Question, { type: "select_all" }>;
  const ids = (...texts: string[]) =>
    texts.map((t) => q.options.find((o) => o.text === t)?.id as string);
  const pick = (...texts: string[]) => grade(q, { type: "select_all", optionIds: ids(...texts) });

  it("all-or-nothing: perfect", () => {
    expect(pick("A", "B", "C")).toMatchObject({ correct: true, score: 1, partialScore: 1 });
  });
  it("order does not matter and duplicates do not count twice", () => {
    expect(pick("C", "A", "B", "A")).toMatchObject({ correct: true, score: 1 });
  });
  it("missing one is wrong with partial 2/3", () => {
    const r = pick("A", "B");
    expect(r.correct).toBe(false);
    expect(r.score).toBe(0);
    expect(r.partialScore).toBeCloseTo(2 / 3, 10);
    expect(r.feedback.find((f) => f.label === "C")?.code).toBe("missed");
  });
  it("an extra wrong pick is wrong and subtracts from partial", () => {
    const r = pick("A", "B", "C", "D");
    expect(r.correct).toBe(false);
    expect(r.score).toBe(0);
    expect(r.partialScore).toBeCloseTo(2 / 3, 10);
    expect(r.feedback.find((f) => f.label === "D")?.code).toBe("wrongly_selected");
  });
  it("partial credit never goes below zero", () => {
    const r = pick("D", "E");
    expect(r.partialScore).toBe(0);
    expect(pick("A", "D", "E").partialScore).toBe(0);
  });
  it("selecting nothing is a valid wrong answer", () => {
    const r = pick();
    expect(r).toMatchObject({ correct: false, malformed: false, partialScore: 0 });
  });
  it("an unknown id is malformed", () => {
    expect(grade(q, { type: "select_all", optionIds: ["nope"] })).toMatchObject({
      correct: false,
      malformed: true,
    });
  });
  it("feedback covers every option", () => {
    expect(pick("A").feedback).toHaveLength(5);
  });
});

describe("matching", () => {
  const q = store({
    type: "matching",
    prompt: "Match drug to class.",
    pairs: [
      { left: "Lorvanol", right: "Beta blocker" },
      { left: "Tenzolol", right: "Beta blocker" },
      { left: "Mirexapril", right: "ACE inhibitor" },
    ],
    distractors: ["Statin"],
    explanation: "Because.",
  }) as Extract<Question, { type: "matching" }>;
  const pid = (left: string) => q.pairs.find((p) => p.left === left)?.id as string;
  const answer = (m: Record<string, string>) => ({
    type: "matching",
    matches: Object.entries(m).map(([l, right]) => ({ pairId: pid(l), right })),
  });

  it("grades perfect", () => {
    const r = grade(
      q,
      answer({ Lorvanol: "Beta blocker", Tenzolol: "beta blocker", Mirexapril: "ACE inhibitor" }),
    );
    expect(r).toMatchObject({ correct: true, score: 1, points: 3, maxPoints: 3 });
  });
  it("gives partial credit, but is not correct", () => {
    const r = grade(
      q,
      answer({ Lorvanol: "Beta blocker", Tenzolol: "Statin", Mirexapril: "ACE inhibitor" }),
    );
    expect(r.correct).toBe(false);
    expect(r.points).toBe(2);
    expect(r.score).toBeCloseTo(2 / 3, 10);
    expect(r.feedback[1]?.code).toBe("incorrect");
  });
  it("shared right items are accepted for each left item", () => {
    const r = grade(q, answer({ Lorvanol: "Beta blocker", Tenzolol: "Beta blocker" }));
    expect(r.points).toBe(2);
    expect(r.feedback[2]?.code).toBe("unanswered");
  });
  it("blank choice is unanswered", () => {
    expect(grade(q, answer({ Lorvanol: "", Tenzolol: "x", Mirexapril: "y" })).points).toBe(0);
  });
  it("unknown or repeated pair ids are malformed", () => {
    expect(grade(q, { type: "matching", matches: [{ pairId: "zz", right: "x" }] }).malformed).toBe(
      true,
    );
    const twice = {
      type: "matching",
      matches: [
        { pairId: pid("Lorvanol"), right: "a" },
        { pairId: pid("Lorvanol"), right: "b" },
      ],
    };
    expect(grade(q, twice).malformed).toBe(true);
  });
  it("shows every pair as the correct answer", () => {
    expect(grade(q, answer({})).correctAnswer.text).toContain("Lorvanol → Beta blocker");
  });
});

describe("fill in the blank", () => {
  const q = store({
    type: "fill_blank",
    text: "{{1}} is a beta blocker and lowers {{2}}; the usual start dose is {{3}} mg.",
    blanks: [
      { answers: ["Lorvanol"], allowTypos: true },
      { answers: ["heart rate", "pulse"] },
      { answers: ["2.5"], allowTypos: false },
    ],
    explanation: "Because.",
  });
  const ans = (...blanks: string[]) => grade(q, { type: "fill_blank", blanks });

  it("accepts the answer, ignoring case, spaces and punctuation", () => {
    expect(ans("lorvanol", "Heart-Rate!", "2.5").correct).toBe(true);
    expect(ans("  LORVANOL ", "heart  rate", "2.5").correct).toBe(true);
    expect(ans("Lorvanol", "pulse", "2.5")).toMatchObject({ correct: true, score: 1, points: 3 });
  });
  it("scores partially but is only correct when every blank is", () => {
    const r = ans("Lorvanol", "pulse", "5");
    expect(r.correct).toBe(false);
    expect(r.points).toBe(2);
    expect(r.score).toBeCloseTo(2 / 3, 10);
    expect(r.feedback[2]?.message).toContain("2.5");
  });
  it("tolerates one typo only where allowed, for long words", () => {
    expect(ans("Lorvanoll", "pulse", "2.5").correct).toBe(true);
    expect(ans("Lorvanoll", "pulse", "2.5").feedback[0]?.code).toBe("typo_accepted");
    expect(ans("Lorvanlo", "pulse", "2.5").correct).toBe(true); // swap counts as one typo
    expect(ans("Lorvxnoll", "pulse", "2.5").correct).toBe(false); // two typos
    expect(ans("Lorvanol", "pules", "2.5").correct).toBe(false); // typos not allowed on blank 2
  });
  it("digits never get typo tolerance, even with allowTypos", () => {
    const withDigits = store({
      type: "fill_blank",
      text: "The dose is {{1}} and the drug is {{2}}.",
      blanks: [
        { answers: ["twelve-hundred"], allowTypos: true },
        { answers: ["vitamin B12", "cyanocobalamin"], allowTypos: true },
      ],
      explanation: "x",
    });
    const g = (...b: string[]) => grade(withDigits, { type: "fill_blank", blanks: b });
    expect(g("twelve-hundrd", "vitamin B12").correct).toBe(true);
    expect(g("twelve-hundred", "vitamin B13").correct).toBe(false);
    expect(g("twelve-hundred", "vitamin B2").correct).toBe(false);
  });
  it("a number answer is never off by one digit", () => {
    expect(matchBlank("2.6", { answers: ["2.5"], allowTypos: true }).match).toBe("none");
    expect(matchBlank("25", { answers: ["2.5"] }).match).toBe("none");
    expect(matchBlank("2,5", { answers: ["2.5"] }).match).toBe("exact");
    expect(matchBlank("1,000", { answers: ["1000"] }).match).toBe("exact");
    expect(matchBlank("-5", { answers: ["5"] }).match).toBe("none");
    expect(matchBlank("12345678", { answers: ["12345679"], allowTypos: true }).match).toBe("none");
  });
  it("short words get no typo tolerance", () => {
    expect(matchBlank("betta", { answers: ["beta"], allowTypos: true }).match).toBe("none");
    expect(matchBlank("lisinopri", { answers: ["lisinopril"], allowTypos: true }).match).toBe(
      "typo",
    );
    expect(matchBlank("atenolo", { answers: ["atenolol"], allowTypos: true }).match).toBe("typo");
    expect(matchBlank("aten", { answers: ["atenolol"], allowTypos: true }).match).toBe("none");
  });
  it("strict compares case and punctuation, but not outer or repeated spaces", () => {
    const rule = { answers: ["Na+"], strict: true };
    expect(matchBlank("Na+", rule).match).toBe("exact");
    expect(matchBlank(" Na+ ", rule).match).toBe("exact");
    expect(matchBlank("na+", rule).match).toBe("none");
    expect(matchBlank("Na", rule).match).toBe("none");
    expect(matchBlank("A  B", { answers: ["A B"], strict: true }).match).toBe("exact");
  });
  it("loose matching sees through punctuation and case", () => {
    expect(normaliseLoose("Beta-Blocker")).toBe(normaliseLoose("beta blocker"));
    expect(normaliseLoose("ACE inhibitor")).toBe("aceinhibitor");
    expect(normaliseStrict("  a   b ")).toBe("a b");
  });
  it("edit distance counts a swap as one", () => {
    expect(editDistance("abcd", "abdc", 1)).toBe(1);
    expect(editDistance("abc", "abc", 1)).toBe(0);
    expect(editDistance("abc", "xyz", 1)).toBe(2);
  });
  it("blank answers are wrong, not errors", () => {
    expect(ans("", "", "").score).toBe(0);
    expect(ans("", "", "").feedback[0]?.code).toBe("empty");
  });
  it("wrong number of blanks is malformed", () => {
    expect(grade(q, { type: "fill_blank", blanks: ["a"] })).toMatchObject({
      correct: false,
      malformed: true,
      maxPoints: 3,
    });
  });
});

describe("calculation with variants", () => {
  const q = store({
    type: "calculation",
    prompt: "A {weightKg} kg patient gets {doseMgPerKg} mg/kg. How many mg?",
    answer: {
      kind: "expression",
      expression: "weightKg * doseMgPerKg",
      variables: {
        weightKg: { kind: "range", min: 50, max: 90, step: 5 },
        doseMgPerKg: { kind: "list", values: [2, 3, 5] },
      },
    },
    units: ["mg"],
    explanation: "{weightKg} x {doseMgPerKg} = {answer}",
  }) as Extract<Question, { type: "calculation" }>;

  it("the same seed gives the same numbers, prompt and answer", () => {
    const a = instantiateCalculation(q, 1234);
    const b = instantiateCalculation(q, 1234);
    expect(a).toEqual(b);
    expect(a.prompt).not.toContain("{");
    expect(a.explanation).toBe(`${a.values.weightKg} x ${a.values.doseMgPerKg} = ${a.answerText}`);
  });
  it("different seeds give different numbers, all in range", () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 200; seed++) {
      const i = instantiateCalculation(q, seed);
      const w = i.values.weightKg as number;
      expect(w >= 50 && w <= 90 && w % 5 === 0).toBe(true);
      expect([2, 3, 5]).toContain(i.values.doseMgPerKg);
      expect(i.exact).toBe(w * (i.values.doseMgPerKg as number));
      seen.add(`${w}/${i.values.doseMgPerKg}`);
    }
    expect(seen.size).toBeGreaterThan(15);
  });
  it("covers the whole range over many seeds", () => {
    const weights = new Set<number>();
    for (let seed = 0; seed < 500; seed++)
      weights.add(instantiateCalculation(q, seed).values.weightKg as number);
    expect([...weights].sort((a, b) => a - b)).toEqual([50, 55, 60, 65, 70, 75, 80, 85, 90]);
  });
  it("grading uses the seed it is given", () => {
    const inst = instantiateCalculation(q, 77);
    const right = grade(
      q,
      { type: "calculation", response: `${inst.exact} mg` },
      { variantSeed: 77 },
    );
    expect(right.correct).toBe(true);
    // the same answer against another seed is (almost always) wrong
    let wrong = 0;
    for (let seed = 100; seed < 120; seed++) {
      if (
        !grade(q, { type: "calculation", response: `${inst.exact} mg` }, { variantSeed: seed })
          .correct
      )
        wrong++;
    }
    expect(wrong).toBeGreaterThan(10);
  });
  it("shows the correct answer for the seed", () => {
    const inst = instantiateCalculation(q, 9);
    expect(
      grade(q, { type: "calculation", response: "0 mg" }, { variantSeed: 9 }).correctAnswer.text,
    ).toBe(inst.answerText);
  });
  it("a seed of null or undefined means seed 0", () => {
    const a = grade(q, { type: "calculation", response: "1 mg" }, { variantSeed: null });
    const b = grade(q, { type: "calculation", response: "1 mg" }, {});
    expect(a.correctAnswer.text).toBe(b.correctAnswer.text);
    expect(b.correctAnswer.text).toBe(instantiateCalculation(q, 0).answerText);
  });
  it("applies rounding to the generated answer", () => {
    const r = store({
      type: "calculation",
      prompt: "{a} divided by {b} mg, to 1 decimal place?",
      answer: {
        kind: "expression",
        expression: "a / b",
        variables: { a: { kind: "list", values: [10] }, b: { kind: "list", values: [3] } },
      },
      units: ["mg"],
      rounding: { mode: "decimals", places: 1 },
      explanation: "{answer}",
    });
    expect(grade(r, { type: "calculation", response: "3.3 mg" }).correct).toBe(true);
    expect(grade(r, { type: "calculation", response: "3.33 mg" }).feedback[0]?.code).toBe(
      "rounding",
    );
    expect(grade(r, { type: "calculation", response: "3.3 mg" }).correctAnswer.text).toBe("3.3 mg");
  });
});

describe("flashcard", () => {
  const q = store({ type: "flashcard", front: "Brand of lorvanol?", back: "Veloxa" });
  it.each([
    ["again", false, 0],
    ["hard", true, 0.5],
    ["good", true, 1],
    ["easy", true, 1],
  ] as const)("self-rated %s", (rating, correct, score) => {
    const r = grade(q, { type: "flashcard", rating });
    expect(r).toMatchObject({ correct, score, selfGraded: true, maxPoints: 1 });
    expect(r.correctAnswer.text).toBe("Veloxa");
  });
  it("rejects an unknown rating without throwing", () => {
    expect(grade(q, { type: "flashcard", rating: "great" })).toMatchObject({
      correct: false,
      malformed: true,
    });
  });
});

describe("free response", () => {
  const q = store({
    type: "free_response",
    prompt: "Explain.",
    modelAnswer: "Model.",
    rubric: [
      { point: "Lowers rate", points: 1 },
      { point: "Less oxygen demand", points: 2 },
      { point: "Less remodelling", points: 2 },
    ],
    explanation: "x",
  });
  const g = (covered: number[]) => grade(q, { type: "free_response", text: "my answer", covered });
  it("scores the ticked key points", () => {
    expect(g([0, 1, 2])).toMatchObject({
      correct: true,
      score: 1,
      points: 5,
      maxPoints: 5,
      selfGraded: true,
    });
    const r = g([1, 2]);
    expect(r).toMatchObject({ correct: true, points: 4 });
    expect(r.score).toBeCloseTo(0.8, 10);
  });
  it("is incorrect below the pass fraction (default 0.7)", () => {
    expect(g([0, 1])).toMatchObject({ correct: false, points: 3 }); // 0.6
    expect(g([])).toMatchObject({ correct: false, score: 0, malformed: false });
  });
  it("counts a repeated tick once", () => {
    expect(g([2, 2, 2]).points).toBe(2);
  });
  it("an out-of-range key point is malformed", () => {
    expect(g([7])).toMatchObject({ correct: false, malformed: true, maxPoints: 5 });
  });
  it("honours a custom pass fraction", () => {
    const strict = store({
      type: "free_response",
      prompt: "Explain.",
      modelAnswer: "Model.",
      rubric: [
        { point: "a", points: 1 },
        { point: "b", points: 1 },
      ],
      passFraction: 1,
      explanation: "x",
    });
    expect(grade(strict, { type: "free_response", covered: [0] }).correct).toBe(false);
    expect(grade(strict, { type: "free_response", covered: [0, 1] }).correct).toBe(true);
  });
});

describe("case", () => {
  const q = store({
    type: "case",
    vignette: "A patient.",
    questions: [
      {
        type: "multiple_choice",
        prompt: "One?",
        options: [{ text: "Yes", correct: true }, { text: "No" }],
        explanation: "x",
      },
      {
        type: "matching",
        prompt: "Two?",
        pairs: [
          { left: "a", right: "1" },
          { left: "b", right: "2" },
        ],
        explanation: "x",
      },
      {
        type: "calculation",
        prompt: "Three?",
        answer: { kind: "fixed", value: 10 },
        units: ["mg"],
        explanation: "x",
      },
      { type: "flashcard", front: "front", back: "back" },
    ],
  }) as Extract<Question, { type: "case" }>;
  const mcId = (
    q.questions[0] as Extract<(typeof q.questions)[number], { type: "multiple_choice" }>
  ).options[0]?.id as string;
  const pairs = (q.questions[1] as Extract<(typeof q.questions)[number], { type: "matching" }>)
    .pairs;

  const allRight = [
    { type: "multiple_choice", optionId: mcId },
    { type: "matching", matches: pairs.map((p) => ({ pairId: p.id, right: p.right })) },
    { type: "calculation", response: "10 mg" },
    { type: "flashcard", rating: "good" },
  ];

  it("aggregates a perfect case", () => {
    const r = grade(q, { type: "case", parts: allRight });
    expect(r).toMatchObject({
      correct: true,
      score: 1,
      points: 5,
      maxPoints: 5,
      malformed: false,
      selfGraded: true,
    });
    expect(r.parts).toHaveLength(4);
  });
  it("adds points across parts and is correct only if all are", () => {
    const parts = [...allRight];
    parts[2] = { type: "calculation", response: "10 g" };
    const r = grade(q, { type: "case", parts });
    expect(r.correct).toBe(false);
    expect(r.points).toBe(4);
    expect(r.score).toBeCloseTo(0.8, 10);
    expect(r.parts?.[2]?.feedback[0]?.code).toBe("magnitude_off");
    expect(r.feedback.find((f) => f.label === "Sub-question 3")?.correct).toBe(false);
  });
  it("weights a matching sub-question by its pairs", () => {
    const parts = [...allRight];
    parts[1] = {
      type: "matching",
      matches: [{ pairId: pairs[0]?.id as string, right: pairs[0]?.right as string }],
    };
    const r = grade(q, { type: "case", parts });
    expect(r.points).toBe(4);
    expect(r.maxPoints).toBe(5);
  });
  it("a skipped sub-question scores zero and is reported", () => {
    const r = grade(q, { type: "case", parts: [allRight[0], null, allRight[2], allRight[3]] });
    expect(r.correct).toBe(false);
    expect(r.points).toBe(3);
    expect(r.maxPoints).toBe(5);
    expect(r.parts?.[1]?.feedback[0]?.code).toBe("unanswered");
  });
  it("missing trailing sub-answers count as skipped", () => {
    const r = grade(q, { type: "case", parts: [allRight[0]] });
    expect(r.maxPoints).toBe(5);
    expect(r.points).toBe(1);
    expect(r.parts).toHaveLength(4);
  });
  it("a wrongly typed sub-answer is malformed for that part only", () => {
    const parts = [...allRight];
    parts[0] = { type: "flashcard", rating: "good" };
    const r = grade(q, { type: "case", parts });
    expect(r.parts?.[0]?.malformed).toBe(true);
    expect(r.parts?.[3]?.malformed).toBe(false);
    expect(r.correct).toBe(false);
  });
  it("too many sub-answers is malformed", () => {
    expect(grade(q, { type: "case", parts: [...allRight, null] })).toMatchObject({
      correct: false,
      malformed: true,
    });
  });
  it("gives each calculation sub-question its own seed", () => {
    const withVars = store({
      type: "case",
      vignette: "v",
      questions: [0, 1].map(() => ({
        type: "calculation",
        prompt: "{x} mg?",
        answer: {
          kind: "expression",
          expression: "x",
          variables: { x: { kind: "range", min: 1, max: 1000, step: 1 } },
        },
        units: ["mg"],
        explanation: "e",
      })),
    });
    const r = grade(withVars, { type: "case", parts: [null, null] }, { variantSeed: 5 });
    const a = r.parts?.[0]?.correctAnswer.text;
    const b = r.parts?.[1]?.correctAnswer.text;
    expect(a).not.toBe(b);
    expect(
      grade(withVars, { type: "case", parts: [null, null] }, { variantSeed: 5 }).parts?.[0]
        ?.correctAnswer.text,
    ).toBe(a);
  });
  it("is app-graded only when every part is", () => {
    expect(isAppGraded(q)).toBe(false);
    expect(maxPointsOf(q)).toBe(5);
    const objective = store({
      type: "case",
      vignette: "v",
      questions: [
        { type: "fill_blank", text: "{{1}}", blanks: [{ answers: ["x"] }], explanation: "e" },
      ],
    });
    expect(isAppGraded(objective)).toBe(true);
  });
});

describe("grade never throws", () => {
  const questions = (
    [
      {
        type: "multiple_choice",
        prompt: "p",
        options: [{ text: "a", correct: true }, { text: "b" }],
        explanation: "e",
      },
      {
        type: "select_all",
        prompt: "p",
        options: [{ text: "a", correct: true }, { text: "b" }],
        explanation: "e",
      },
      {
        type: "matching",
        prompt: "p",
        pairs: [
          { left: "a", right: "1" },
          { left: "b", right: "2" },
        ],
        explanation: "e",
      },
      { type: "fill_blank", text: "{{1}}", blanks: [{ answers: ["x"] }], explanation: "e" },
      {
        type: "calculation",
        prompt: "p",
        answer: { kind: "fixed", value: 1 },
        units: ["mg"],
        explanation: "e",
      },
      { type: "flashcard", front: "f", back: "b" },
      {
        type: "free_response",
        prompt: "p",
        modelAnswer: "m",
        rubric: [{ point: "x", points: 1 }],
        explanation: "e",
      },
      { type: "case", vignette: "v", questions: [{ type: "flashcard", front: "f", back: "b" }] },
    ] as Array<Record<string, unknown>>
  ).map(store);

  const garbage: unknown[] = [
    null,
    undefined,
    42,
    "answer",
    [],
    {},
    { type: "nope" },
    { type: "multiple_choice" },
    { type: "select_all", optionIds: "a" },
    { type: "matching", matches: 5 },
    { type: "fill_blank", blanks: [] },
    { type: "calculation", response: 5 },
    { type: "calculation", response: "x".repeat(1000) },
    { type: "flashcard", rating: null },
    { type: "free_response", covered: [-1] },
    { type: "case", parts: "no" },
    { type: "case", parts: [{ type: "case", parts: [] }] },
    { __proto__: { type: "multiple_choice" } },
    () => 1,
    Symbol("x"),
    Number.NaN,
  ];

  for (const q of questions) {
    it(`${q.type}: returns an incorrect, malformed result for any garbage`, () => {
      for (const g of garbage) {
        const r = grade(q, g);
        expect(r.correct, JSON.stringify(g)).toBe(false);
        expect(r.score).toBe(0);
        expect(r.malformed).toBe(true);
        expect(r.feedback.length).toBeGreaterThan(0);
        expect(r.maxPoints).toBe(maxPointsOf(q));
        expect(typeof r.correctAnswer.text).toBe("string");
      }
    });
  }

  it("names the mismatch when the answer is for another type", () => {
    const r = grade(questions[0] as Question, { type: "flashcard", rating: "good" });
    expect(r.feedback[0]?.message).toContain('answer has type "flashcard"');
  });
});
