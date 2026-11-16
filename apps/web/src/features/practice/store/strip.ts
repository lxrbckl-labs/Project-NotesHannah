import { practice } from "@notes/schema";
import type { ServedPart, ServedQuestion } from "../types";

type Question = practice.Question;
type Part = practice.QuestionPart;

interface Seeds {
  variantSeed: number;
  shuffleSeed: number;
}

const UNIT_POOL = [
  "mcg",
  "mg",
  "g",
  "kg",
  "mL",
  "dL",
  "L",
  "mg/kg",
  "mg/mL",
  "mg/dL",
  "mcg/kg/min",
  "mL/hr",
  "mg/hr",
  "units",
  "tablet",
];

/** Units to offer in the picker: the answer's kind and size neighbours first, then a few others. */
export function unitChoicesFor(units: readonly string[], seed: number): string[] {
  const right = practice.parseUnit(units[0] ?? "");
  const same = UNIT_POOL.filter((u) => {
    const p = practice.parseUnit(u);
    return right && p && practice.sameDimension(p, right);
  });
  const others = practice
    .shuffled(
      UNIT_POOL.filter((u) => !same.includes(u)),
      practice.makeRng(seed),
    )
    .slice(0, Math.max(0, 6 - same.length));
  const shown = units[0] as string;
  const base = same.some((u) => {
    const p = practice.parseUnit(u);
    const r = practice.parseUnit(shown);
    return p && r && practice.equivalentUnits(p, r);
  })
    ? same
    : [shown, ...same];
  return [...base, ...others];
}

function servePart(q: Part, seeds: Seeds): ServedPart {
  const image = q.image ? { image: q.image } : {};
  switch (q.type) {
    case "multiple_choice":
    case "select_all": {
      const options = practice
        .displayOrder(q.options, seeds.shuffleSeed, q.shuffle)
        .map((o) => ({ id: o.id, text: o.text }));
      return { type: q.type, prompt: q.prompt, options, ...image };
    }
    case "matching": {
      const texts: { id: string; text: string }[] = [];
      const seen = new Set<string>();
      for (const t of [...q.pairs.map((p) => p.right), ...q.distractors]) {
        const key = practice.normaliseLoose(t);
        if (!seen.has(key)) {
          seen.add(key);
          texts.push({ id: String(texts.length), text: t });
        }
      }
      return {
        type: "matching",
        prompt: q.prompt,
        lefts: q.pairs.map((p) => ({ id: p.id, text: p.left })),
        rights: practice.displayOrder(texts, seeds.shuffleSeed, q.shuffle).map((r) => r.text),
        ...image,
      };
    }
    case "fill_blank":
      return {
        type: "fill_blank",
        text: q.text,
        blanks: q.blanks.map((b) => ({
          width: Math.min(28, Math.max(4, ...b.answers.map((a) => a.length))),
        })),
        ...image,
      };
    case "calculation": {
      const inst = practice.instantiateCalculation(q, seeds.variantSeed);
      return {
        type: "calculation",
        prompt: inst.prompt,
        unitChoices: unitChoicesFor(q.units, seeds.shuffleSeed),
        rounding: q.rounding,
        allowFractions: q.allowFractions,
        ...image,
      };
    }
    case "flashcard":
      return { type: "flashcard", front: q.front, ...image };
    case "free_response":
      return { type: "free_response", prompt: q.prompt, rubricSize: q.rubric.length, ...image };
  }
}

/**
 * The question as the server sends it while she answers: no correct options, accepted answers,
 * expressions, tolerance, explanations, rationales, model answer or rubric text.
 */
export function serveQuestion(q: Question, seeds: Seeds, index: number): ServedQuestion {
  const common = {
    index,
    questionId: q.id,
    tags: [...q.tags],
    difficulty: q.difficulty,
    generalKnowledge: q.generalKnowledge,
  };
  if (q.type === "case") {
    return {
      type: "case",
      vignette: q.vignette,
      parts: q.questions.map((p, i) =>
        servePart(p, {
          variantSeed: practice.deriveSeed(seeds.variantSeed, "part", i),
          shuffleSeed: practice.deriveSeed(seeds.shuffleSeed, "part", i),
        }),
      ),
      ...(q.image ? { image: q.image } : {}),
      ...common,
    };
  }
  return { ...servePart(q, seeds), ...common } as ServedQuestion;
}
