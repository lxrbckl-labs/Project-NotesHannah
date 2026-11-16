/**
 * Answer keys for the mock store: the schema `Answer` that is right or wrong for a question, and a
 * text version of the same thing for driving the UI in tests. Test and demo support only; the real
 * server never sends any of this.
 */
import { practice } from "@notes/schema";
import type { Answer } from "../types";

type Question = practice.Question;
type Part = practice.QuestionPart;

export type AnswerKey =
  | { type: "multiple_choice"; correct: string; wrong: string }
  | { type: "select_all"; correct: string[]; wrong: string[] }
  | {
      type: "matching";
      correct: { left: string; right: string }[];
      wrong: { left: string; right: string }[];
    }
  | { type: "fill_blank"; correct: string[]; wrong: string[] }
  | {
      type: "calculation";
      correct: { value: string; unit: string };
      /** Right number, unit one size off (1000 times too large or too small). */
      slip: { value: string; unit: string };
      /** Right number, no unit. */
      noUnit: { value: string; unit: string };
      wrong: { value: string; unit: string };
    }
  | { type: "flashcard" }
  | { type: "free_response"; covered: number[] }
  | { type: "case"; parts: AnswerKey[] };

const SLIP_UNIT: Record<string, string> = {
  mg: "g",
  mcg: "mg",
  g: "kg",
  mL: "L",
  "mL/hr": "L/hr",
  "mcg/min": "mg/min",
};

export function answerKey(q: Question | Part, variantSeed: number): AnswerKey {
  switch (q.type) {
    case "multiple_choice": {
      const right = q.options.find((o) => o.correct) as (typeof q.options)[number];
      const wrong = q.options.find((o) => !o.correct) as (typeof q.options)[number];
      return { type: q.type, correct: right.text, wrong: wrong.text };
    }
    case "select_all": {
      const right = q.options.filter((o) => o.correct).map((o) => o.text);
      const wrong = q.options.filter((o) => !o.correct).map((o) => o.text);
      return { type: q.type, correct: right, wrong: [wrong[0] as string] };
    }
    case "matching": {
      const correct = q.pairs.map((p) => ({ left: p.left, right: p.right }));
      const [a, b, ...rest] = correct as [(typeof correct)[number], (typeof correct)[number]];
      const wrong = [{ left: a.left, right: b.right }, { left: b.left, right: a.right }, ...rest];
      return { type: q.type, correct, wrong };
    }
    case "fill_blank":
      return {
        type: q.type,
        correct: q.blanks.map((b) => b.answers[0] as string),
        wrong: q.blanks.map(() => "zzz"),
      };
    case "calculation": {
      const inst = practice.instantiateCalculation(q, variantSeed);
      const value = String(inst.expected);
      const unit = q.units[0] as string;
      return {
        type: q.type,
        correct: { value, unit },
        slip: { value, unit: SLIP_UNIT[unit] ?? "kg" },
        noUnit: { value, unit: "" },
        wrong: { value: String(Number((inst.expected * 2.3).toPrecision(6))), unit },
      };
    }
    case "flashcard":
      return { type: q.type };
    case "free_response":
      return { type: q.type, covered: q.rubric.map((_, i) => i) };
    case "case":
      return {
        type: q.type,
        parts: q.questions.map((p, i) => answerKey(p, practice.deriveSeed(variantSeed, "part", i))),
      };
  }
}

/** The schema answer for a question: all right, or deliberately wrong. */
export function buildAnswer(
  q: Question | Part,
  variantSeed: number,
  mode: "right" | "wrong",
): Answer {
  const right = mode === "right";
  switch (q.type) {
    case "multiple_choice": {
      const pick = q.options.find(
        (o) => Boolean(o.correct) === right,
      ) as (typeof q.options)[number];
      return { type: q.type, optionId: pick.id };
    }
    case "select_all": {
      const ids = right
        ? q.options.filter((o) => o.correct).map((o) => o.id)
        : [(q.options.find((o) => !o.correct) as (typeof q.options)[number]).id];
      return { type: q.type, optionIds: ids };
    }
    case "matching": {
      const rights = q.pairs.map((p) => p.right);
      const shifted = right ? rights : [...rights.slice(1), rights[0] as string];
      return {
        type: q.type,
        matches: q.pairs.map((p, i) => ({ pairId: p.id, right: shifted[i] as string })),
      };
    }
    case "fill_blank":
      return {
        type: q.type,
        blanks: q.blanks.map((b) => (right ? (b.answers[0] as string) : "zzz")),
      };
    case "calculation": {
      const inst = practice.instantiateCalculation(q, variantSeed);
      return {
        type: q.type,
        response: right
          ? String(inst.expected)
          : String(Number((inst.expected * 2.3).toPrecision(6))),
        unit: inst.unit,
      };
    }
    case "flashcard":
      return { type: q.type, rating: right ? "good" : "again" };
    case "free_response":
      return { type: q.type, text: "My answer", covered: right ? q.rubric.map((_, i) => i) : [] };
    case "case":
      return {
        type: q.type,
        parts: q.questions.map(
          (p, i) =>
            buildAnswer(
              p,
              practice.deriveSeed(variantSeed, "part", i),
              mode,
            ) as practice.PartAnswer,
        ),
      };
  }
}
