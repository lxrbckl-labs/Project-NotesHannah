import { z } from "zod";
import { OptionId } from "./content.js";

/** How well she remembered a card or a self-graded answer. */
export const RATINGS = ["again", "hard", "good", "easy"] as const;
export const ReviewRating = z.enum(RATINGS);
export type ReviewRating = z.infer<typeof ReviewRating>;

/** Pick one option. */
export const MultipleChoiceAnswer = z.strictObject({
  type: z.literal("multiple_choice"),
  optionId: OptionId,
});

/** Pick any number of options (an empty list means "none of these"). */
export const SelectAllAnswer = z.strictObject({
  type: z.literal("select_all"),
  optionIds: z.array(OptionId).max(8),
});

/** For each left item (by pair id), the right-hand text she chose for it. */
export const MatchingAnswer = z.strictObject({
  type: z.literal("matching"),
  matches: z.array(z.strictObject({ pairId: OptionId, right: z.string().max(200) })).max(12),
});

/** What she typed in each blank, in order. An empty string means left blank. */
export const FillBlankAnswer = z.strictObject({
  type: z.literal("fill_blank"),
  blanks: z.array(z.string().max(200)).min(1).max(10),
});

/**
 * What she typed. `response` may contain the unit ("2.5 mg"); or the unit can
 * come separately in `unit` (a unit picker). Both are read the same way.
 */
export const CalculationAnswer = z.strictObject({
  type: z.literal("calculation"),
  response: z.string().max(100),
  unit: z.string().max(40).optional(),
});

/** Self-graded. */
export const FlashcardAnswer = z.strictObject({
  type: z.literal("flashcard"),
  rating: ReviewRating,
});

/** Self-graded: what she wrote, and which rubric key points (by position, from 0) she says she covered. */
export const FreeResponseAnswer = z.strictObject({
  type: z.literal("free_response"),
  text: z.string().max(10_000).default(""),
  covered: z.array(z.number().int().min(0).max(11)).max(12),
});

/** The answer to a sub-question of a case. */
export const PartAnswer = z.discriminatedUnion("type", [
  MultipleChoiceAnswer,
  SelectAllAnswer,
  MatchingAnswer,
  FillBlankAnswer,
  CalculationAnswer,
  FlashcardAnswer,
  FreeResponseAnswer,
]);
export type PartAnswer = z.infer<typeof PartAnswer>;

/** One entry per sub-question, in order; null for one she skipped. */
export const CaseAnswer = z.strictObject({
  type: z.literal("case"),
  parts: z.array(PartAnswer.nullable()).max(8),
});

/** Everything a client can submit as an answer. */
export const Answer = z.discriminatedUnion("type", [
  MultipleChoiceAnswer,
  SelectAllAnswer,
  MatchingAnswer,
  FillBlankAnswer,
  CalculationAnswer,
  FlashcardAnswer,
  CaseAnswer,
  FreeResponseAnswer,
]);
export type Answer = z.infer<typeof Answer>;

export const ANSWER_SCHEMAS = {
  multiple_choice: MultipleChoiceAnswer,
  select_all: SelectAllAnswer,
  matching: MatchingAnswer,
  fill_blank: FillBlankAnswer,
  calculation: CalculationAnswer,
  flashcard: FlashcardAnswer,
  case: CaseAnswer,
  free_response: FreeResponseAnswer,
} as const;
