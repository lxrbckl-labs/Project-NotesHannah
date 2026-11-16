import type { z } from "zod";
import { QUESTION_INPUT_SCHEMAS, type QuestionType } from "./content.js";

const FILE = "fil_01HZX3K9Q2V7M4N8P6R5T0W1YB";
const PAGE = "pag_01HZX3K9Q2V7M4N8P6R5T0W1YC";
const source = (quote: string) => ({ fileId: FILE, pageId: PAGE, quote });

/** How the app grades a type. "mixed": a case, graded by the app only where its sub-questions are. */
export type GradingMode = "app" | "self" | "mixed";

export interface QuestionTypeInfo {
  type: QuestionType;
  /** Name for menus and for her. */
  label: string;
  /** What this type is for and how to write a good one; shown to agents. */
  description: string;
  /** The schema an agent's input is checked against. */
  schema: z.ZodType;
  grading: GradingMode;
  /** True when the app can grade it with no help from her (false for self-graded and mixed types). */
  appGrades: boolean;
  /** A minimal valid input for this type. Fictional drugs are used wherever facts would matter. */
  example: Record<string, unknown>;
}

const EXAMPLES: Record<QuestionType, Record<string, unknown>> = {
  multiple_choice: {
    type: "multiple_choice",
    prompt: "Which effect is expected with the (fictional) beta blocker lorvanol?",
    options: [
      { text: "Slower heart rate", correct: true, rationale: "Beta blockade lowers heart rate." },
      { text: "Faster heart rate" },
      { text: "Higher potassium" },
    ],
    explanation: "Beta blockers slow the heart rate and lower contractility.",
    sources: [source("Beta blockers lower heart rate")],
  },
  select_all: {
    type: "select_all",
    prompt: "Select all adverse effects listed for lorvanol (fictional).",
    options: [
      { text: "Bradycardia", correct: true },
      { text: "Fatigue", correct: true },
      { text: "Tinnitus" },
    ],
    explanation: "Bradycardia and fatigue were listed; tinnitus was not.",
    sources: [source("Adverse effects: bradycardia, fatigue")],
  },
  matching: {
    type: "matching",
    prompt: "Match each brand name to its generic name (all fictional).",
    pairs: [
      { left: "Veloxa", right: "lorvanol" },
      { left: "Cardimar", right: "tenzolol" },
    ],
    distractors: ["mirexapril"],
    explanation: "Brand and generic names are listed on the drug card.",
    sources: [source("Veloxa (lorvanol); Cardimar (tenzolol)")],
  },
  fill_blank: {
    type: "fill_blank",
    text: "Lorvanol is a {{1}} blocker that lowers the {{2}}.",
    blanks: [{ answers: ["beta"] }, { answers: ["heart rate", "pulse"] }],
    explanation: "Lorvanol is a beta blocker; it lowers heart rate.",
    sources: [source("Lorvanol is a beta blocker")],
  },
  calculation: {
    type: "calculation",
    prompt:
      "A patient weighs {weightKg} kg. The order is {doseMgPerKg} mg/kg as a single dose. How many mg should be given?",
    answer: {
      kind: "expression",
      expression: "weightKg * doseMgPerKg",
      variables: {
        weightKg: { kind: "range", min: 50, max: 90, step: 5 },
        doseMgPerKg: { kind: "list", values: [2, 3, 5] },
      },
    },
    units: ["mg", "milligram"],
    tolerance: { mode: "relative", percent: 1 },
    explanation: "Dose = weight x dose per kg = {weightKg} x {doseMgPerKg} = {answer}.",
    sources: [source("Dose = weight (kg) x dose (mg/kg)")],
  },
  flashcard: {
    type: "flashcard",
    front: "Brand name of lorvanol (fictional)?",
    back: "Veloxa",
    sources: [source("Veloxa (lorvanol)")],
  },
  case: {
    type: "case",
    vignette: "A 64-year-old man with heart failure is started on lorvanol (fictional).",
    questions: [
      {
        type: "multiple_choice",
        prompt: "Which finding should be monitored first?",
        options: [{ text: "Heart rate", correct: true }, { text: "Hair growth" }],
        explanation: "Beta blockers can cause bradycardia.",
      },
      {
        type: "fill_blank",
        text: "Lorvanol belongs to the {{1}} blocker class.",
        blanks: [{ answers: ["beta"] }],
        explanation: "It is a beta blocker.",
      },
    ],
    sources: [source("Case 3: heart failure and beta blockers")],
  },
  free_response: {
    type: "free_response",
    prompt: "Explain why lorvanol (fictional) is used in heart failure.",
    modelAnswer: "It lowers heart rate and oxygen demand and reduces remodelling.",
    rubric: [
      { point: "Lowers heart rate", points: 1 },
      { point: "Reduces remodelling", points: 2 },
    ],
    explanation: "Key effects: rate control, less oxygen demand, less remodelling.",
    sources: [source("Beta blockers in heart failure")],
  },
};

const INFO: Array<Omit<QuestionTypeInfo, "schema" | "example" | "appGrades">> = [
  {
    type: "multiple_choice",
    label: "Multiple choice",
    description:
      "One question, 2 to 6 options, exactly one correct. Give each wrong option a plausible reason in rationale where it teaches something. Options are shuffled by default.",
    grading: "app",
  },
  {
    type: "select_all",
    label: "Select all that apply",
    description:
      "2 to 8 options, one or more correct. Graded all-or-nothing; a partial score is also reported. Say 'Select all' in the prompt.",
    grading: "app",
  },
  {
    type: "matching",
    label: "Matching",
    description:
      "2 to 12 pairs of left and right items (brand to generic, drug to class). Several left items may share a right item. Add distractors for extra wrong right-hand choices. Left items must be unique.",
    grading: "app",
  },
  {
    type: "fill_blank",
    label: "Fill in the blank",
    description:
      "Text with blanks written {{1}}, {{2}}, ... and one blanks entry per marker, in order, each with every accepted answer. Matching ignores case, spaces and punctuation. Use strict: true only where case matters; allowTypos only for long words.",
    grading: "app",
  },
  {
    type: "calculation",
    label: "Calculation",
    description:
      "A numeric answer with a required unit. Use answer.kind 'fixed' for one number, or 'expression' with variables ({name} in the prompt) so the same problem repeats with fresh numbers. Expressions allow numbers, variables, + - * / ^, parentheses, min, max, round, ceil, floor, sqrt, ln, log10, exp. Units come from a fixed table (mcg, mg, g, kg, mL, dL, L, min, hr, day, units, mEq, gtt, tablet and combinations such as mg/kg, mL/hr, mcg/kg/min). Default tolerance is 1% relative.",
    grading: "app",
  },
  {
    type: "flashcard",
    label: "Flashcard",
    description:
      "A front and a back. She rates her own recall (again, hard, good, easy) and the card is scheduled by spaced repetition. Keep one fact per card.",
    grading: "self",
  },
  {
    type: "case",
    label: "Case",
    description:
      "A patient vignette with 1 to 8 sub-questions of any other type (not another case). Sub-questions carry their own explanation but share the case's sources, tags and concepts.",
    grading: "mixed",
  },
  {
    type: "free_response",
    label: "Free response",
    description:
      "A prompt, a model answer and a rubric of key points with points each. She compares her answer with the model and ticks the key points she covered; the app cannot grade the text.",
    grading: "self",
  },
];

/** Everything about each question type: schema, label, guidance for agents, a valid example, and who grades it. */
export const QUESTION_REGISTRY: Record<QuestionType, QuestionTypeInfo> = Object.fromEntries(
  INFO.map((i) => [
    i.type,
    {
      ...i,
      schema: QUESTION_INPUT_SCHEMAS[i.type],
      example: EXAMPLES[i.type],
      appGrades: i.grading === "app",
    },
  ]),
) as unknown as Record<QuestionType, QuestionTypeInfo>;

/** A minimal valid example for a type. */
export function exampleFor(type: QuestionType): Record<string, unknown> {
  return JSON.parse(JSON.stringify(EXAMPLES[type])) as Record<string, unknown>;
}
