import { z } from "zod";
import { Citation } from "../citations.js";
import { Actor, Timestamp } from "../common.js";
import { ConceptId, PageId, QuestionId } from "../ids.js";
import {
  type CoreLike,
  citationIssues,
  coreIssues,
  type EnvelopeLike,
  LIGHT_MARKDOWN_RULE,
} from "./checks.js";
import { CalcAnswer } from "./variants.js";

/** The eight kinds of question. */
export const QUESTION_TYPES = [
  "multiple_choice",
  "select_all",
  "matching",
  "fill_blank",
  "calculation",
  "flashcard",
  "case",
  "free_response",
] as const;
export const QuestionType = z.enum(QUESTION_TYPES);
export type QuestionType = z.infer<typeof QuestionType>;

/** Question types a case can contain (everything except case). */
export const PART_TYPES = QUESTION_TYPES.filter((t) => t !== "case");

/** Error text for a required field that is missing. */
function required(what: string): { error: (iss: { input?: unknown }) => string | undefined } {
  return { error: (iss) => (iss.input === undefined ? `Required: ${what}` : undefined) };
}

/** Plain text field with a length limit. */
const text = (max: number, what: string) =>
  z
    .string(required(what))
    .min(1, `${what} must not be empty`)
    .max(max, `${what} is at most ${max} characters`);

/** Prompt-like text: plain string, light markdown allowed. */
const markdownText = (max: number, what: string) => text(max, what).describe(LIGHT_MARKDOWN_RULE);

// ------------------------------------------------------------------ shared

/** 1 = recall, 2 = application, 3 = hard (multi-step or case-style). */
export const QuestionDifficulty = z
  .number()
  .int()
  .min(1, "difficulty is 1 (easy), 2 (medium) or 3 (hard)")
  .max(3, "difficulty is 1 (easy), 2 (medium) or 3 (hard)");

export const QuestionTag = z.string().min(1).max(40);

/** A rectangle on a page image, as fractions of the page: 0,0 is the top-left corner, 1,1 the bottom-right. */
export const ImageRegion = z
  .strictObject({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().gt(0).max(1),
    height: z.number().gt(0).max(1),
  })
  .refine((r) => r.x + r.width <= 1 + 1e-9 && r.y + r.height <= 1 + 1e-9, {
    message: "region must stay inside the page: x + width and y + height must each be at most 1",
  });
export type ImageRegion = z.infer<typeof ImageRegion>;

/** A page image shown with the question, optionally narrowed to a region. */
export const QuestionImage = z.strictObject({
  pageId: PageId,
  region: ImageRegion.optional(),
});
export type QuestionImage = z.infer<typeof QuestionImage>;

export const OptionId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{0,15}$/, "ids are short lowercase text such as a, b, o1");

export const ReviewStatus = z.enum(["unverified", "reviewed"]);
export type ReviewStatus = z.infer<typeof ReviewStatus>;

/** How close a numeric answer must be. Default: within 1% of the correct value. */
export const Tolerance = z.discriminatedUnion(
  "mode",
  [
    z.strictObject({
      mode: z.literal("relative"),
      /** Percent of the correct value, 0 to 100. */
      percent: z.number().min(0).max(100),
    }),
    z.strictObject({
      mode: z.literal("absolute"),
      /** Same unit as the answer. */
      amount: z.number().min(0),
    }),
  ],
  { error: 'tolerance needs mode "relative" (percent) or mode "absolute" (amount).' },
);
export type Tolerance = z.infer<typeof Tolerance>;
export const DEFAULT_TOLERANCE: Tolerance = { mode: "relative", percent: 1 };

/** A rounding instruction that the student's answer must follow. */
export const Rounding = z.discriminatedUnion(
  "mode",
  [
    z.strictObject({ mode: z.literal("decimals"), places: z.number().int().min(0).max(6) }),
    z.strictObject({ mode: z.literal("sigfigs"), figures: z.number().int().min(1).max(8) }),
  ],
  { error: 'rounding needs mode "decimals" (places) or mode "sigfigs" (figures).' },
);
export type Rounding = z.infer<typeof Rounding>;

// ------------------------------------------------------------- core shapes

/**
 * The shape of each question type's own fields. `itemId` is the shape of the
 * `id` field on options and pairs: optional when an agent writes a question
 * (an id is assigned if missing), required once stored.
 */
function buildShapes<const Id extends z.ZodRawShape>(itemId: Id) {
  const MultipleChoiceOption = z.strictObject({
    ...itemId,
    text: text(300, "option text"),
    /** Exactly one option is correct. */
    correct: z.boolean().default(false),
    /** Why this option is right or wrong; shown after answering. */
    rationale: text(500, "rationale").optional(),
  });

  const imageAndExplanation = {
    image: QuestionImage.optional(),
    explanation: markdownText(
      4000,
      "explanation (why the answer is right, shown after she answers)",
    ),
  };

  const multiple_choice = {
    type: z.literal("multiple_choice"),
    prompt: markdownText(4000, "prompt"),
    options: z
      .array(MultipleChoiceOption, required("options (2 to 6, exactly one with correct: true)"))
      .min(2, "multiple_choice needs at least 2 options")
      .max(6, "multiple_choice has at most 6 options"),
    /** Show the options in a different order each time. */
    shuffle: z.boolean().default(true),
    ...imageAndExplanation,
  };

  const select_all = {
    type: z.literal("select_all"),
    prompt: markdownText(4000, "prompt"),
    options: z
      .array(MultipleChoiceOption, required("options (2 to 8, at least one with correct: true)"))
      .min(2, "select_all needs at least 2 options")
      .max(8, "select_all has at most 8 options"),
    shuffle: z.boolean().default(true),
    ...imageAndExplanation,
  };

  const MatchingPair = z.strictObject({
    ...itemId,
    left: text(200, "left item"),
    right: text(200, "right item"),
  });
  const matching = {
    type: z.literal("matching"),
    prompt: markdownText(4000, "prompt"),
    pairs: z
      .array(MatchingPair, required("pairs (2 to 12 of { left, right })"))
      .min(2, "matching needs at least 2 pairs")
      .max(12, "matching has at most 12 pairs"),
    /** Extra wrong answers for the right-hand column. */
    distractors: z.array(text(200, "distractor")).max(6, "at most 6 distractors").default([]),
    shuffle: z.boolean().default(true),
    ...imageAndExplanation,
  };

  const Blank = z.strictObject({
    /** Every accepted answer; matching is case-, space- and punctuation-insensitive unless `strict`. */
    answers: z
      .array(text(100, "answer"), required("answers (list of accepted answers)"))
      .min(1, "a blank needs at least one accepted answer")
      .max(10, "a blank has at most 10 accepted answers"),
    /** Compare exactly (case and punctuation count; only surrounding spaces are ignored). */
    strict: z.boolean().default(false),
    /** Accept one typo (edit distance 1) for answers of 6+ characters with no digits. */
    allowTypos: z.boolean().default(false),
  });
  const fill_blank = {
    type: z.literal("fill_blank"),
    text: markdownText(2000, "text with blanks written as {{1}}, {{2}}, ..."),
    blanks: z
      .array(Blank, required("blanks (one per {{n}} marker, in order)"))
      .min(1, "fill_blank needs at least one blank")
      .max(10, "fill_blank has at most 10 blanks"),
    ...imageAndExplanation,
  };

  const calculation = {
    type: z.literal("calculation"),
    prompt: markdownText(4000, "prompt"),
    answer: CalcAnswer,
    /** Equivalent spellings of the one unit the answer is in, e.g. ["mg", "milligram"]. The first is shown. */
    units: z
      .array(text(40, "unit"), required('units (for example ["mg"])'))
      .min(1, 'a calculation needs a unit, for example ["mg"]')
      .max(8, "at most 8 unit spellings"),
    tolerance: Tolerance.default(DEFAULT_TOLERANCE),
    rounding: Rounding.optional(),
    /** Accept answers like 1/2 or 1 1/2. */
    allowFractions: z.boolean().default(false),
    /** Accept a correct value given in another size of the same unit (0.0025 g for 2.5 mg). */
    convertUnits: z.boolean().default(true),
    ...imageAndExplanation,
  };

  const flashcard = {
    type: z.literal("flashcard"),
    front: markdownText(2000, "front"),
    back: markdownText(2000, "back"),
    image: QuestionImage.optional(),
    /** Optional extra context shown with the back. */
    explanation: z.string().max(4000).default(""),
  };

  const RubricPoint = z.strictObject({
    point: text(300, "key point"),
    points: z.number().int().min(1).max(10),
  });
  const free_response = {
    type: z.literal("free_response"),
    prompt: markdownText(4000, "prompt"),
    modelAnswer: markdownText(4000, "modelAnswer"),
    rubric: z
      .array(RubricPoint, required("rubric (list of { point, points })"))
      .min(1, "rubric needs at least one key point")
      .max(12, "rubric has at most 12 key points"),
    /** Share of the points needed to count as correct, 0.1 to 1. */
    passFraction: z.number().min(0.1).max(1).default(0.7),
    ...imageAndExplanation,
  };

  return {
    multiple_choice,
    select_all,
    matching,
    fill_blank,
    calculation,
    flashcard,
    free_response,
  };
}

/** Fields every question has, whoever writes it. */
const sharedFields = {
  /** Where the question came from. Needs at least one, or generalKnowledge: true. */
  sources: z.array(Citation).max(10, "at most 10 sources").default([]),
  /** True only for a question that is not from her notes; it is labelled as such. */
  generalKnowledge: z.boolean().default(false),
  difficulty: QuestionDifficulty.default(2),
  tags: z.array(QuestionTag).max(20, "at most 20 tags").default([]),
  /** Concepts (drugs, classes, ...) this question is about. */
  conceptIds: z.array(ConceptId).max(20, "at most 20 concept links").default([]),
};

/** Fields the app fills in when a question is stored. */
const storedFields = {
  id: QuestionId,
  author: Actor,
  createdAt: Timestamp,
  updatedAt: Timestamp,
  review: ReviewStatus.default("unverified"),
};

function refined<T extends z.ZodObject>(schema: T): T {
  return schema.superRefine((value, ctx) => {
    const v = value as unknown as CoreLike & EnvelopeLike;
    for (const issue of [...citationIssues(v), ...coreIssues(v)]) {
      ctx.addIssue({ code: "custom", message: issue.message, path: issue.path });
    }
  }) as T;
}

function buildMembers<const Id extends z.ZodRawShape>(itemId: Id) {
  const shapes = buildShapes(itemId);
  /** A sub-question of a case: the type's own fields, no sources or ids (they come from the case). */
  const Part = z.discriminatedUnion(
    "type",
    [
      z.strictObject(shapes.multiple_choice),
      z.strictObject(shapes.select_all),
      z.strictObject(shapes.matching),
      z.strictObject(shapes.fill_blank),
      z.strictObject(shapes.calculation),
      z.strictObject(shapes.flashcard),
      z.strictObject(shapes.free_response),
    ],
    {
      error: `A sub-question needs a type of ${PART_TYPES.join(", ")}. A case cannot contain another case.`,
    },
  );
  const caseShape = {
    type: z.literal("case"),
    /** The patient case: history, findings, labs. */
    vignette: markdownText(4000, "vignette (the patient case)"),
    image: QuestionImage.optional(),
    questions: z
      .array(Part, required("questions (1 to 8 sub-questions)"))
      .min(1, "a case needs at least one sub-question")
      .max(8, "a case has at most 8 sub-questions"),
    /** Optional overall takeaway; each sub-question has its own explanation. */
    explanation: z.string().max(4000).default(""),
  };
  const members = {
    multiple_choice: refined(z.strictObject({ ...shapes.multiple_choice, ...sharedFields })),
    select_all: refined(z.strictObject({ ...shapes.select_all, ...sharedFields })),
    matching: refined(z.strictObject({ ...shapes.matching, ...sharedFields })),
    fill_blank: refined(z.strictObject({ ...shapes.fill_blank, ...sharedFields })),
    calculation: refined(z.strictObject({ ...shapes.calculation, ...sharedFields })),
    flashcard: refined(z.strictObject({ ...shapes.flashcard, ...sharedFields })),
    case: refined(z.strictObject({ ...caseShape, ...sharedFields })),
    free_response: refined(z.strictObject({ ...shapes.free_response, ...sharedFields })),
  };
  return { Part, members };
}

const TYPE_MESSAGE = `type must be one of: ${QUESTION_TYPES.join(", ")}.`;

const authorSide = buildMembers({ id: OptionId.optional() });
const storedSide = buildMembers({ id: OptionId });
const m = storedSide.members;

/** The author-input schema of each question type on its own (used by the registry and for JSON Schema export). */
export const QUESTION_INPUT_SCHEMAS = authorSide.members;

/** What an agent supplies to create a question: no id, author or timestamps. */
export const QuestionInput = z.discriminatedUnion(
  "type",
  [
    authorSide.members.multiple_choice,
    authorSide.members.select_all,
    authorSide.members.matching,
    authorSide.members.fill_blank,
    authorSide.members.calculation,
    authorSide.members.flashcard,
    authorSide.members.case,
    authorSide.members.free_response,
  ],
  { error: TYPE_MESSAGE },
);
export type QuestionInput = z.output<typeof QuestionInput>;

/** One sub-question of a case, as an agent writes it. */
export const QuestionPartInput = authorSide.Part;
export type QuestionPartInput = z.output<typeof QuestionPartInput>;

/** A stored question. */
export const Question = z.discriminatedUnion(
  "type",
  [
    m.multiple_choice.safeExtend(storedFields),
    m.select_all.safeExtend(storedFields),
    m.matching.safeExtend(storedFields),
    m.fill_blank.safeExtend(storedFields),
    m.calculation.safeExtend(storedFields),
    m.flashcard.safeExtend(storedFields),
    m.case.safeExtend(storedFields),
    m.free_response.safeExtend(storedFields),
  ],
  { error: TYPE_MESSAGE },
);
export type Question = z.output<typeof Question>;

/** One sub-question of a stored case. */
export const QuestionPart = storedSide.Part;
export type QuestionPart = z.output<typeof QuestionPart>;

/** The per-type pieces of the stored schema, for code that needs one type. */
export type QuestionOfType<T extends QuestionType> = Extract<Question, { type: T }>;
export type PartOfType<T extends QuestionType> = Extract<QuestionPart, { type: T }>;

/**
 * A fill-in question stores its gaps as {{1}}, {{2}}. Anywhere the text is shown outside the answer
 * boxes (a list, a search result, a card), the markers become a drawn gap.
 */
export function blanksAsGaps(text: string): string {
  return text.replace(/\{\{\d+\}\}/g, "_____");
}

/** The text a person sees as "the question": the prompt, the front of a card, the text with blanks, or the vignette. */
export function questionText(q: Question | QuestionPart): string {
  switch (q.type) {
    case "flashcard":
      return q.front;
    case "fill_blank":
      return q.text;
    case "case":
      return q.vignette;
    default:
      return q.prompt;
  }
}
