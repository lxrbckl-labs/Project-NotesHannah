import type { Citation } from "@notes/schema";
import { practice } from "@notes/schema";

type Q = practice.Question | practice.QuestionPart;
type Image = { pageId: string; region?: practice.ImageRegion | undefined } | undefined;

/**
 * What a client sees of a question while it is being answered. Every type has
 * its own serialiser, written out field by field (never "the question minus a
 * few keys"), so a field added to a question later cannot leak by default.
 * No correct flags, accepted answers, expressions, variables, rubrics,
 * model answers, rationales or explanations are in here.
 */
export type QuestionView =
  | { type: "multiple_choice"; prompt: string; image?: Image; options: ChoiceView[] }
  | { type: "select_all"; prompt: string; image?: Image; options: ChoiceView[] }
  | {
      type: "matching";
      prompt: string;
      image?: Image;
      left: Array<{ id: string; text: string }>;
      /** The right-hand column: every right item and distractor, once each, in this session's order. */
      right: string[];
    }
  | { type: "fill_blank"; text: string; image?: Image; blankCount: number }
  | { type: "calculation"; prompt: string; image?: Image; needsUnit: true }
  | { type: "flashcard"; front: string; image?: Image }
  | { type: "free_response"; prompt: string; image?: Image }
  | { type: "case"; vignette: string; image?: Image; parts: QuestionView[] };

export interface ChoiceView {
  id: string;
  text: string;
}

const image = (q: { image?: Image }): { image?: Image } =>
  q.image === undefined ? {} : { image: q.image };

/** The seed a case gives its sub-question (the same derivation the grader uses). */
export const partSeed = (seed: number, index: number): number =>
  practice.deriveSeed(seed, "part", index);

/** The calculation as she sees it: the numbers of her variant filled into the prompt. */
function calculationPrompt(q: practice.PartOfType<"calculation">, variantSeed: number): string {
  try {
    return practice.instantiateCalculation(q, variantSeed).prompt;
  } catch {
    return q.prompt;
  }
}

/** The right-hand column of a matching question: distinct texts, always shuffled so order never gives the pairs away. */
function rightColumn(q: practice.PartOfType<"matching">, shuffleSeed: number): string[] {
  const seen = new Set<string>();
  const items: Array<{ id: string }> = [];
  for (const text of [...q.pairs.map((p) => p.right), ...q.distractors]) {
    if (seen.has(text)) continue;
    seen.add(text);
    items.push({ id: text });
  }
  return practice.displayOrder(items, shuffleSeed, true).map((i) => i.id);
}

export function questionView(q: Q, shuffleSeed: number, variantSeed: number): QuestionView {
  switch (q.type) {
    case "multiple_choice":
    case "select_all":
      return {
        type: q.type,
        prompt: q.prompt,
        ...image(q),
        options: practice
          .displayOrder(q.options, shuffleSeed, q.shuffle)
          .map((o) => ({ id: o.id, text: o.text })),
      };
    case "matching":
      return {
        type: "matching",
        prompt: q.prompt,
        ...image(q),
        left: q.pairs.map((p) => ({ id: p.id, text: p.left })),
        right: rightColumn(q, shuffleSeed),
      };
    case "fill_blank":
      return { type: "fill_blank", text: q.text, ...image(q), blankCount: q.blanks.length };
    case "calculation":
      return {
        type: "calculation",
        prompt: calculationPrompt(q, variantSeed),
        ...image(q),
        needsUnit: true,
      };
    case "flashcard":
      return { type: "flashcard", front: q.front, ...image(q) };
    case "free_response":
      return { type: "free_response", prompt: q.prompt, ...image(q) };
    case "case":
      return {
        type: "case",
        vignette: q.vignette,
        ...image(q),
        parts: q.questions.map((p, i) =>
          questionView(p, practice.deriveSeed(shuffleSeed, "part", i), partSeed(variantSeed, i)),
        ),
      };
  }
}

/** Does a variant seed matter for this question (does it have numbers to draw)? */
export function usesVariants(q: Q): boolean {
  if (q.type === "calculation") return q.answer.kind === "expression";
  if (q.type === "case") return q.questions.some((p) => usesVariants(p));
  return false;
}

/** Everything shown after answering: the explanation and what makes each option right or wrong. */
export interface Reveal {
  type: string;
  explanation: string;
  options?: Array<{ id: string; text: string; correct: boolean; rationale?: string | undefined }>;
  pairs?: Array<{ id: string; left: string; right: string }>;
  blanks?: Array<{ answers: string[] }>;
  rubric?: Array<{ point: string; points: number }>;
  modelAnswer?: string;
  back?: string;
  /** A case's sub-questions; null where the part is not part of this reveal. */
  parts?: Array<Reveal | null>;
}

/**
 * The answer key for a question, in the same shape for every type. For a
 * calculation the explanation has this variant's numbers filled in.
 */
export function revealOf(q: Q, variantSeed: number, only?: (q: Q) => boolean): Reveal {
  switch (q.type) {
    case "multiple_choice":
    case "select_all":
      return {
        type: q.type,
        explanation: q.explanation,
        options: q.options.map((o) => ({
          id: o.id,
          text: o.text,
          correct: o.correct,
          ...(o.rationale !== undefined ? { rationale: o.rationale } : {}),
        })),
      };
    case "matching":
      return {
        type: q.type,
        explanation: q.explanation,
        pairs: q.pairs.map((p) => ({ id: p.id, left: p.left, right: p.right })),
      };
    case "fill_blank":
      return {
        type: q.type,
        explanation: q.explanation,
        blanks: q.blanks.map((b) => ({ answers: [...b.answers] })),
      };
    case "calculation": {
      let explanation = q.explanation;
      try {
        explanation = practice.instantiateCalculation(q, variantSeed).explanation;
      } catch {
        // keep the raw explanation
      }
      return { type: q.type, explanation };
    }
    case "flashcard":
      return { type: q.type, explanation: q.explanation, back: q.back };
    case "free_response":
      return {
        type: q.type,
        explanation: q.explanation,
        modelAnswer: q.modelAnswer,
        rubric: q.rubric.map((r) => ({ point: r.point, points: r.points })),
      };
    case "case":
      return {
        type: q.type,
        explanation: q.explanation,
        parts: q.questions.map((p, i) =>
          only && !only(p) ? null : revealOf(p, partSeed(variantSeed, i), only),
        ),
      };
  }
}

/** Is this question one she grades herself (so she needs to see the key before judging)? */
export function isSelfGradedKind(q: Q): boolean {
  return q.type === "flashcard" || q.type === "free_response";
}

/** Does it have something she must self-grade, at the top or inside a case? */
export function hasSelfGraded(q: Q): boolean {
  return q.type === "case" ? q.questions.some((p) => isSelfGradedKind(p)) : isSelfGradedKind(q);
}

/** The key for a self-graded question, so she can mark herself. App-graded sub-questions of a case stay hidden. */
export function selfGradeKey(q: Q, variantSeed: number): Reveal {
  return revealOf(q, variantSeed, (p) => isSelfGradedKind(p));
}

export type { Citation };
