import { z } from "zod";

/** One line of feedback about one part of an answer (an option, a pair, a blank, a sub-question, ...). */
export const GradeFeedback = z.strictObject({
  /** What this line is about, e.g. the option text, "Pair 2", "Blank 1", "Sub-question 3". */
  label: z.string(),
  correct: z.boolean(),
  /** Stable machine code such as "correct", "missing_unit", "magnitude_off", "typo_accepted". */
  code: z.string(),
  /** Plain-language message for her. */
  message: z.string(),
});
export type GradeFeedback = z.infer<typeof GradeFeedback>;

/** The right answer, ready to show. `data` has the same shape as a submitted answer where one exists. */
export const CorrectAnswer = z.strictObject({
  text: z.string(),
  data: z.unknown(),
});
export type CorrectAnswer = z.infer<typeof CorrectAnswer>;

export interface GradeResult {
  /** True only when everything is right (or, for self-graded types, she judged it so). */
  correct: boolean;
  /** 0 to 1. */
  score: number;
  /** Points earned, out of maxPoints. */
  points: number;
  maxPoints: number;
  /** For select_all: the partial-credit share, reported even though `score` is all-or-nothing. */
  partialScore?: number | undefined;
  /** True when the grade came from her own self-assessment. */
  selfGraded: boolean;
  /** True when the answer could not be read; the result is then incorrect with a reason in feedback. */
  malformed: boolean;
  feedback: GradeFeedback[];
  correctAnswer: CorrectAnswer;
  /** For a case: the result of each sub-question, in order. */
  parts?: GradeResult[] | undefined;
}

export const GradeResult: z.ZodType<GradeResult> = z.strictObject({
  correct: z.boolean(),
  score: z.number().min(0).max(1),
  points: z.number().min(0),
  maxPoints: z.number().min(0),
  partialScore: z.number().min(0).max(1).optional(),
  selfGraded: z.boolean(),
  malformed: z.boolean(),
  feedback: z.array(GradeFeedback),
  correctAnswer: CorrectAnswer,
  parts: z.array(z.lazy(() => GradeResult)).optional(),
}) as z.ZodType<GradeResult>;
