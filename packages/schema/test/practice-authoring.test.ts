import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Citation } from "../src/citations.js";
import { newId } from "../src/ids.js";
import { Answer } from "../src/practice/answers.js";
import {
  QUESTION_TYPES,
  Question,
  QuestionInput,
  QuestionPart,
  type QuestionType,
} from "../src/practice/content.js";
import { grade } from "../src/practice/grading.js";
import { exampleFor, QUESTION_REGISTRY } from "../src/practice/registry.js";
import { Attempt, PracticeSession, SessionScope } from "../src/practice/session.js";
import { type Problem, toStoredQuestion, validateQuestionInput } from "../src/practice/validate.js";

// biome-ignore lint/suspicious/noExplicitAny: test inputs are edited loosely on purpose
type Loose = any;

const base = (type: QuestionType) => exampleFor(type);
const clone = <T>(v: T): T => structuredClone(v);

function problems(input: unknown): Problem[] {
  const r = validateQuestionInput(input);
  if (r.ok)
    throw new Error(`expected problems, got a valid question: ${JSON.stringify(r.question)}`);
  return r.problems;
}
function messagesOf(input: unknown): string {
  return problems(input)
    .map((p) => `${p.path}: ${p.message}`)
    .join("\n");
}
function mutate(type: QuestionType, change: (q: Record<string, Loose>) => void) {
  const q = clone(base(type)) as Record<string, Loose>;
  change(q);
  return q;
}

describe("registry", () => {
  it("lists every type with label, description, example, schema and grading", () => {
    expect(Object.keys(QUESTION_REGISTRY).sort()).toEqual([...QUESTION_TYPES].sort());
    for (const type of QUESTION_TYPES) {
      const info = QUESTION_REGISTRY[type];
      expect(info.type).toBe(type);
      expect(info.label.length).toBeGreaterThan(2);
      expect(info.description.length).toBeGreaterThan(40);
      expect(info.schema).toBeDefined();
      expect(["app", "self", "mixed"]).toContain(info.grading);
      expect(info.appGrades).toBe(info.grading === "app");
    }
  });
  it("says which types the app can grade", () => {
    const app = QUESTION_TYPES.filter((t) => QUESTION_REGISTRY[t].appGrades).sort();
    expect(app).toEqual(["calculation", "fill_blank", "matching", "multiple_choice", "select_all"]);
    expect(QUESTION_REGISTRY.flashcard.grading).toBe("self");
    expect(QUESTION_REGISTRY.free_response.grading).toBe("self");
    expect(QUESTION_REGISTRY.case.grading).toBe("mixed");
  });

  for (const type of QUESTION_TYPES) {
    describe(type, () => {
      it("example is valid for the registry schema and the validator", () => {
        expect(QUESTION_REGISTRY[type].schema.safeParse(base(type)).success).toBe(true);
        const r = validateQuestionInput(base(type));
        expect(r.ok, JSON.stringify(r)).toBe(true);
      });
      it("example can be stored and the stored form parses", () => {
        const r = validateQuestionInput(base(type));
        if (!r.ok) throw new Error("invalid");
        const stored = toStoredQuestion(r.question, {
          author: { type: "agent", keyId: newId("apiKey"), label: "Claude Code" },
          now: "2026-11-15T10:00:00.000Z",
        });
        expect(Question.safeParse(stored).success).toBe(true);
        expect(stored.review).toBe("unverified");
        expect(stored.id).toMatch(/^qst_/);
      });
      it("the app grades the stored example's own correct answer as correct (objective types)", () => {
        if (!QUESTION_REGISTRY[type].appGrades && type !== "case") return;
        const r = validateQuestionInput(base(type));
        if (!r.ok) throw new Error("invalid");
        const stored = toStoredQuestion(r.question, {
          author: { type: "user", userId: newId("user") },
          now: "2026-11-15T10:00:00.000Z",
        });
        const shown = grade(stored, null);
        const result = grade(stored, shown.correctAnswer.data);
        expect(Answer.safeParse(shown.correctAnswer.data).success).toBe(true);
        expect(result.correct, JSON.stringify(result.feedback)).toBe(true);
      });
    });
  }
});

describe("JSON Schema export", () => {
  it("works for the author-input union and for each type", () => {
    const js = z.toJSONSchema(QuestionInput, { io: "input" }) as Record<string, unknown>;
    const alts = (js.oneOf ?? js.anyOf) as Array<Record<string, Loose>>;
    expect(alts).toHaveLength(8);
    expect(alts.map((a) => a.properties.type.const).sort()).toEqual([...QUESTION_TYPES].sort());
    for (const type of QUESTION_TYPES) {
      const one = z.toJSONSchema(QUESTION_REGISTRY[type].schema, { io: "input" }) as Record<
        string,
        Loose
      >;
      expect(one.type).toBe("object");
      expect(one.properties.type.const).toBe(type);
      expect(one.additionalProperties).toBe(false);
      expect(one.required).toContain("type");
    }
    expect(() => JSON.stringify(js)).not.toThrow();
  });
  it("marks fields with defaults as optional for input and explains the markdown rule", () => {
    const mc = z.toJSONSchema(QUESTION_REGISTRY.multiple_choice.schema, { io: "input" }) as Record<
      string,
      Loose
    >;
    expect(mc.required).toEqual(
      expect.arrayContaining(["type", "prompt", "options", "explanation"]),
    );
    expect(mc.required).not.toContain("shuffle");
    expect(mc.required).not.toContain("difficulty");
    expect(mc.properties.prompt.description).toContain("Light markdown");
    expect(mc.properties.options.minItems).toBe(2);
    expect(mc.properties.options.maxItems).toBe(6);
  });
  it("works for answers, sessions, attempts and the stored question too", () => {
    for (const schema of [
      Answer,
      SessionScope,
      PracticeSession,
      Question,
      QuestionPart,
      Citation,
    ]) {
      expect(() => z.toJSONSchema(schema, { io: "output" })).not.toThrow();
    }
    expect(() => z.toJSONSchema(Attempt, { io: "input", unrepresentable: "any" })).not.toThrow();
  });
});

describe("normalisation", () => {
  it("fills in defaults", () => {
    const r = validateQuestionInput(base("multiple_choice"));
    if (!r.ok) throw new Error("invalid");
    expect(r.question).toMatchObject({
      difficulty: 2,
      tags: [],
      conceptIds: [],
      generalKnowledge: false,
      shuffle: true,
    });
    const c = validateQuestionInput(base("calculation"));
    if (!c.ok) throw new Error("invalid");
    expect(c.question).toMatchObject({
      tolerance: { mode: "relative", percent: 1 },
      allowFractions: false,
      convertUnits: true,
    });
  });
  it("lower-cases and de-duplicates tags", () => {
    const r = validateQuestionInput(
      mutate("flashcard", (q) => (q.tags = [" Beta-Blockers ", "beta-blockers", "CARDIO"])),
    );
    if (!r.ok) throw new Error("invalid");
    expect(r.question.tags).toEqual(["beta-blockers", "cardio"]);
  });
  it("accepts general knowledge without sources, and labels nothing else", () => {
    const r = validateQuestionInput(
      mutate("flashcard", (q) => {
        delete q.sources;
        q.generalKnowledge = true;
      }),
    );
    expect(r.ok).toBe(true);
  });
  it("keeps ids an author gave and assigns the rest without clashes", () => {
    const r = validateQuestionInput(
      mutate("multiple_choice", (q) => {
        q.options = [
          { id: "o1", text: "A" },
          { text: "B", correct: true },
          { text: "C" },
          { id: "o2", text: "D" },
        ];
      }),
    );
    if (!r.ok) throw new Error(JSON.stringify(r));
    const stored = toStoredQuestion(r.question, {
      author: { type: "user", userId: newId("user") },
      now: "2026-11-15T10:00:00.000Z",
    });
    const ids = (stored as Extract<typeof stored, { type: "multiple_choice" }>).options.map(
      (o) => o.id,
    );
    expect(ids[0]).toBe("o1");
    expect(ids[3]).toBe("o2");
    expect(new Set(ids).size).toBe(4);
  });
  it("does not change the input object", () => {
    const input = clone(base("multiple_choice"));
    const frozen = JSON.stringify(input);
    validateQuestionInput(input);
    expect(JSON.stringify(input)).toBe(frozen);
  });
});

describe("authoring mistakes: every problem has a path, a message and a valid example", () => {
  const cases: Array<{ name: string; input: unknown; path: string; message: RegExp }> = [
    {
      name: "no correct option",
      input: mutate("multiple_choice", (q) => (q.options = [{ text: "A" }, { text: "B" }])),
      path: "$.options",
      message: /No option is marked correct.*exactly one/,
    },
    {
      name: "two correct options in multiple choice",
      input: mutate(
        "multiple_choice",
        (q) =>
          (q.options = [
            { text: "A", correct: true },
            { text: "B", correct: true },
          ]),
      ),
      path: "$.options",
      message: /2 options are marked correct.*select_all/,
    },
    {
      name: "duplicate options",
      input: mutate(
        "multiple_choice",
        (q) => (q.options = [{ text: "Slower rate", correct: true }, { text: "slower  RATE!" }]),
      ),
      path: "$.options[1].text",
      message: /repeats option 1/,
    },
    {
      name: "blank option text",
      input: mutate(
        "multiple_choice",
        (q) => (q.options = [{ text: "A", correct: true }, { text: "?!" }]),
      ),
      path: "$.options[1].text",
      message: /blank or has no letters/,
    },
    {
      name: "repeated option ids",
      input: mutate(
        "multiple_choice",
        (q) =>
          (q.options = [
            { id: "a", text: "A", correct: true },
            { id: "a", text: "B" },
          ]),
      ),
      path: "$.options[1].id",
      message: /used twice/,
    },
    {
      name: "select_all with nothing correct",
      input: mutate("select_all", (q) => (q.options = [{ text: "A" }, { text: "B" }])),
      path: "$.options",
      message: /at least one option with correct: true/,
    },
    {
      name: "too few options",
      input: mutate("multiple_choice", (q) => (q.options = [{ text: "A", correct: true }])),
      path: "$.options",
      message: /at least 2 options/,
    },
    {
      name: "too many options",
      input: mutate(
        "multiple_choice",
        (q) =>
          (q.options = Array.from({ length: 7 }, (_, i) => ({
            text: `Option ${i}`,
            correct: i === 0,
          }))),
      ),
      path: "$.options",
      message: /at most 6 options/,
    },
    {
      name: "more blanks than markers",
      input: mutate("fill_blank", (q) => {
        q.text = "Only one {{1}} here.";
      }),
      path: "$.blanks[1]",
      message: /no \{\{2\}\}.*1 marker\(s\) in the text, 2 in blanks/,
    },
    {
      name: "marker with no blank entry",
      input: mutate("fill_blank", (q) => {
        q.text = "A {{1}} and a {{2}} and a {{3}}.";
      }),
      path: "$.text",
      message: /\{\{3\}\} but blanks has 2 entries/,
    },
    {
      name: "text without markers",
      input: mutate("fill_blank", (q) => {
        q.text = "No gaps at all.";
      }),
      path: "$.text",
      message: /no blank.*\{\{1\}\}/,
    },
    {
      name: "marker used twice",
      input: mutate("fill_blank", (q) => {
        q.text = "{{1}} and {{1}} and {{2}}";
      }),
      path: "$.text",
      message: /\{\{1\}\} appears 2 times/,
    },
    {
      name: "empty accepted answers list",
      input: mutate("fill_blank", (q) => (q.blanks[0].answers = [])),
      path: "$.blanks[0].answers",
      message: /at least one accepted answer/,
    },
    {
      name: "duplicate accepted answers",
      input: mutate("fill_blank", (q) => (q.blanks[1].answers = ["Pulse", "pulse!"])),
      path: "$.blanks[1].answers[1]",
      message: /repeats an earlier answer/,
    },
    {
      name: "strict together with allowTypos",
      input: mutate(
        "fill_blank",
        (q) => (q.blanks[1] = { answers: ["heart rate"], strict: true, allowTypos: true }),
      ),
      path: "$.blanks[1]",
      message: /both strict and allowTypos/,
    },
    {
      name: "allowTypos that can never apply",
      input: mutate(
        "fill_blank",
        (q) => (q.blanks[0] = { answers: ["beta", "B12"], allowTypos: true }),
      ),
      path: "$.blanks[0].allowTypos",
      message: /6 or more characters.*no digits/,
    },
    {
      name: "matching with a repeated left item",
      input: mutate(
        "matching",
        (q) =>
          (q.pairs = [
            { left: "Veloxa", right: "lorvanol" },
            { left: "veloxa", right: "tenzolol" },
          ]),
      ),
      path: "$.pairs[1].left",
      message: /appears in pairs 1 and 2/,
    },
    {
      name: "matching distractor equals a right item",
      input: mutate("matching", (q) => (q.distractors = ["Lorvanol"])),
      path: "$.distractors[0]",
      message: /same as a right item/,
    },
    {
      name: "matching with one pair",
      input: mutate("matching", (q) => (q.pairs = [{ left: "A", right: "B" }])),
      path: "$.pairs",
      message: /at least 2 pairs/,
    },
    {
      name: "calculation variable never used",
      input: mutate("calculation", (q) => {
        q.answer.variables.extra = { kind: "list", values: [1, 2] };
        q.prompt += " {extra}";
      }),
      path: "$.answer.variables.extra",
      message: /declared but never used/,
    },
    {
      name: "calculation expression uses an undeclared variable",
      input: mutate("calculation", (q) => (q.answer.expression = "weightKg * doseMgPerKg * bsa")),
      path: "$.answer.expression",
      message: /uses "bsa" but no variable of that name/,
    },
    {
      name: "variable not shown in the prompt",
      input: mutate(
        "calculation",
        (q) => (q.prompt = "A patient gets {doseMgPerKg} mg/kg. How many mg?"),
      ),
      path: "$.prompt",
      message: /"weightKg" is not shown in the prompt/,
    },
    {
      name: "prompt placeholder with no variable",
      input: mutate("calculation", (q) => (q.prompt += " Age {ageYears}.")),
      path: "$.prompt",
      message: /uses \{ageYears\} but there is no variable/,
    },
    {
      name: "explanation placeholder with no variable",
      input: mutate("calculation", (q) => (q.explanation = "Uses {nothing}.")),
      path: "$.explanation",
      message: /uses \{nothing\}/,
    },
    {
      name: "division by zero somewhere in range",
      input: mutate("calculation", (q) => {
        q.explanation = "e";
        q.prompt = "{a} over {b}?";
        q.answer = {
          kind: "expression",
          expression: "a / (b - 3)",
          variables: {
            a: { kind: "list", values: [1, 2] },
            b: { kind: "range", min: 1, max: 5, step: 1 },
          },
        };
        q.units = ["mg"];
      }),
      path: "$.answer.expression",
      message: /fails for some values in range: Division by zero when a = 1, b = 3/,
    },
    {
      name: "square root of a negative somewhere in range",
      input: mutate("calculation", (q) => {
        q.explanation = "e";
        q.prompt = "{a}?";
        q.answer = {
          kind: "expression",
          expression: "sqrt(a - 10)",
          variables: { a: { kind: "range", min: 1, max: 20, step: 1 } },
        };
      }),
      path: "$.answer.expression",
      message: /sqrt of a negative number when a = 1/,
    },
    {
      name: "log of zero at the edge of the range",
      input: mutate("calculation", (q) => {
        q.explanation = "e";
        q.prompt = "{a}?";
        q.answer = {
          kind: "expression",
          expression: "ln(a)",
          variables: { a: { kind: "range", min: 0, max: 5, step: 1 } },
        };
      }),
      path: "$.answer.expression",
      message: /ln of zero or a negative number when a = 0/,
    },
    {
      name: "a failure only at a corner of a huge range is still found",
      input: mutate("calculation", (q) => {
        q.explanation = "e";
        q.prompt = "{a} {b}?";
        q.answer = {
          kind: "expression",
          expression: "1 / (a - b)",
          variables: {
            a: { kind: "range", min: 0, max: 1000, step: 1 },
            b: { kind: "range", min: 0, max: 1000, step: 1 },
          },
        };
      }),
      path: "$.answer.expression",
      message: /Division by zero/,
    },
    {
      name: "expression that cannot be parsed",
      input: mutate("calculation", (q) => (q.answer.expression = "weightKg * * doseMgPerKg")),
      path: "$.answer.expression",
      message: /cannot be read \(at character 12\)/,
    },
    {
      name: "expression that tries to escape",
      input: mutate("calculation", (q) => (q.answer.expression = "constructor.constructor('x')()")),
      path: "$.answer.expression",
      message: /cannot be read/,
    },
    {
      name: "unknown function in the expression",
      input: mutate("calculation", (q) => (q.answer.expression = "abs(weightKg) * doseMgPerKg")),
      path: "$.answer.expression",
      message: /Unknown function 'abs'/,
    },
    {
      name: "tolerance 0 with a fixed non-integer answer",
      input: mutate("calculation", (q) => {
        q.prompt = "How many mg?";
        q.answer = { kind: "fixed", value: 2.5 };
        q.tolerance = { mode: "relative", percent: 0 };
      }),
      path: "$.tolerance",
      message: /Tolerance 0 would accept only the exact value 2.5/,
    },
    {
      name: "absolute tolerance 0 with a fixed non-integer answer",
      input: mutate("calculation", (q) => {
        q.prompt = "How many mg?";
        q.answer = { kind: "fixed", value: 0.125 };
        q.tolerance = { mode: "absolute", amount: 0 };
      }),
      path: "$.tolerance",
      message: /Tolerance 0/,
    },
    {
      name: "tolerance 0 with a variant answer that is sometimes not whole",
      input: mutate("calculation", (q) => {
        q.explanation = "e";
        q.prompt = "{a} divided by {b}?";
        q.answer = {
          kind: "expression",
          expression: "a / b",
          variables: {
            a: { kind: "list", values: [10, 12] },
            b: { kind: "list", values: [2, 3, 4] },
          },
        };
        q.tolerance = { mode: "absolute", amount: 0 };
      }),
      path: "$.tolerance",
      message: /not a whole number when a = 10, b = 3/,
    },
    {
      name: "relative tolerance around a zero answer",
      input: mutate("calculation", (q) => {
        q.prompt = "How many mg?";
        q.answer = { kind: "fixed", value: 0 };
      }),
      path: "$.tolerance",
      message: /answer is 0 and tolerance is relative/,
    },
    {
      name: "relative tolerance where a variant answer can be zero",
      input: mutate("calculation", (q) => {
        q.explanation = "e";
        q.prompt = "{a} minus {b}?";
        q.answer = {
          kind: "expression",
          expression: "a - b",
          variables: { a: { kind: "list", values: [1, 2] }, b: { kind: "list", values: [1, 5] } },
        };
      }),
      path: "$.tolerance",
      message: /exactly 0 when a = 1, b = 1/,
    },
    {
      name: "unit not in the table",
      input: mutate("calculation", (q) => (q.units = ["ounces"])),
      path: "$.units[0]",
      message: /"ounces" is not in the supported table/,
    },
    {
      name: "units measuring different things",
      input: mutate("calculation", (q) => (q.units = ["mg", "mL"])),
      path: "$.units[1]",
      message: /measures something different/,
    },
    {
      name: "units of different sizes",
      input: mutate("calculation", (q) => (q.units = ["mg", "g"])),
      path: "$.units[1]",
      message: /different size.*equivalent spellings/,
    },
    {
      name: "no units",
      input: mutate("calculation", (q) => (q.units = [])),
      path: "$.units",
      message: /needs a unit/,
    },
    {
      name: "variable name that is invalid",
      input: mutate("calculation", (q) => {
        q.answer.variables.Weight_kg = q.answer.variables.weightKg;
        delete q.answer.variables.weightKg;
        q.answer.expression = "Weight_kg * doseMgPerKg";
        q.prompt = "{Weight_kg} {doseMgPerKg}";
      }),
      path: "$.answer.variables.Weight_kg",
      message: /invalid.*lower-case letter/,
    },
    {
      name: "variable name that is a function",
      input: mutate("calculation", (q) => {
        q.answer.variables.max = { kind: "list", values: [1] };
        q.answer.expression = "weightKg * doseMgPerKg * max";
        q.prompt += " {max}";
      }),
      path: "$.answer.variables.max",
      message: /reserved/,
    },
    {
      name: "range with max below min",
      input: mutate(
        "calculation",
        (q) => (q.answer.variables.weightKg = { kind: "range", min: 90, max: 50, step: 5 }),
      ),
      path: "$.answer.variables.weightKg",
      message: /max \(50\) is less than min \(90\)/,
    },
    {
      name: "range with a zero step",
      input: mutate(
        "calculation",
        (q) => (q.answer.variables.weightKg = { kind: "range", min: 50, max: 90, step: 0 }),
      ),
      path: "$.answer.variables.weightKg.step",
      message: /step must be greater than 0/,
    },
    {
      name: "range with too many values",
      input: mutate(
        "calculation",
        (q) => (q.answer.variables.weightKg = { kind: "range", min: 0, max: 1000, step: 0.01 }),
      ),
      path: "$.answer.variables.weightKg.step",
      message: /at most 10000/,
    },
    {
      name: "list repeating a value",
      input: mutate(
        "calculation",
        (q) => (q.answer.variables.doseMgPerKg = { kind: "list", values: [2, 2] }),
      ),
      path: "$.answer.variables.doseMgPerKg.values",
      message: /same number twice/,
    },
    {
      name: "fixed answer with placeholders",
      input: mutate("calculation", (q) => (q.answer = { kind: "fixed", value: 100 })),
      path: "$.prompt",
      message: /answer.kind is "fixed"/,
    },
    {
      name: "fractions combined with rounding",
      input: mutate("calculation", (q) => {
        q.allowFractions = true;
        q.rounding = { mode: "decimals", places: 1 };
      }),
      path: "$.allowFractions",
      message: /cannot be combined with a rounding/,
    },
    {
      name: "no source and not general knowledge",
      input: mutate("multiple_choice", (q) => delete q.sources),
      path: "$.sources",
      message: /at least one source.*generalKnowledge: true/,
    },
    {
      name: "empty sources and not general knowledge",
      input: mutate("multiple_choice", (q) => (q.sources = [])),
      path: "$.sources",
      message: /at least one source/,
    },
    {
      name: "sources and general knowledge together",
      input: mutate("multiple_choice", (q) => (q.generalKnowledge = true)),
      path: "$.generalKnowledge",
      message: /Remove generalKnowledge, or remove the sources/,
    },
    {
      name: "source with an empty quote",
      input: mutate("multiple_choice", (q) => (q.sources[0].quote = "")),
      path: "$.sources[0].quote",
      message: /Quote the passage/,
    },
    {
      name: "source with a quote that is too long",
      input: mutate("multiple_choice", (q) => (q.sources[0].quote = "x".repeat(1001))),
      path: "$.sources[0].quote",
      message: /at most 1000/,
    },
    {
      name: "source with a bad file id",
      input: mutate("multiple_choice", (q) => (q.sources[0].fileId = "file-1")),
      path: "$.sources[0].fileId",
      message: /fil_/,
    },
    {
      name: "HTML in the prompt",
      input: mutate("multiple_choice", (q) => (q.prompt = "Which <b>effect</b>?")),
      path: "$.prompt",
      message: /HTML is not allowed/,
    },
    {
      name: "heading in the explanation",
      input: mutate("multiple_choice", (q) => (q.explanation = "# Heading\nText")),
      path: "$.explanation",
      message: /Headings are not allowed/,
    },
    {
      name: "link in the prompt",
      input: mutate("multiple_choice", (q) => (q.prompt = "See [this](http://x.y)")),
      path: "$.prompt",
      message: /Links are not allowed/,
    },
    {
      name: "image in the prompt",
      input: mutate("multiple_choice", (q) => (q.prompt = "![x](http://x.y/a.png)")),
      path: "$.prompt",
      message: /Images cannot be embedded/,
    },
    {
      name: "difficulty out of range",
      input: mutate("multiple_choice", (q) => (q.difficulty = 4)),
      path: "$.difficulty",
      message: /difficulty is 1 \(easy\), 2 \(medium\) or 3 \(hard\)/,
    },
    {
      name: "image region outside the page",
      input: mutate(
        "multiple_choice",
        (q) =>
          (q.image = {
            pageId: "pag_01HZX3K9Q2V7M4N8P6R5T0W1YC",
            region: { x: 0.8, y: 0, width: 0.5, height: 0.5 },
          }),
      ),
      path: "$.image.region",
      message: /stay inside the page/,
    },
    {
      name: "missing explanation",
      input: mutate("multiple_choice", (q) => delete q.explanation),
      path: "$.explanation",
      message: /explanation/,
    },
    {
      name: "missing prompt",
      input: mutate("select_all", (q) => delete q.prompt),
      path: "$.prompt",
      message: /prompt/,
    },
    {
      name: "unknown field names the allowed ones",
      input: mutate("multiple_choice", (q) => {
        q.choices = q.options;
      }),
      path: "$.choices",
      message: /Unknown field "choices".*Fields allowed here:.*options/,
    },
    {
      name: "unknown field inside an option",
      input: mutate("multiple_choice", (q) => (q.options[0].isCorrect = true)),
      path: "$.options[0].isCorrect",
      message: /Unknown field "isCorrect".*text, correct, rationale/,
    },
    {
      name: "unknown type",
      input: { ...base("multiple_choice"), type: "essay" },
      path: "$.type",
      message: /"essay" is not a question type.*multiple_choice/,
    },
    {
      name: "missing type",
      input: (() => {
        const q = clone(base("multiple_choice"));
        delete (q as Record<string, unknown>).type;
        return q;
      })(),
      path: "$.type",
      message: /Missing required field "type"/,
    },
    {
      name: "a case inside a case",
      input: mutate(
        "case",
        (q) => (q.questions = [{ type: "case", vignette: "v", questions: [] }]),
      ),
      path: "$.questions[0].type",
      message: /cannot contain another case/,
    },
    {
      name: "a case with no sub-questions",
      input: mutate("case", (q) => (q.questions = [])),
      path: "$.questions",
      message: /at least one sub-question/,
    },
    {
      name: "a case with nine sub-questions",
      input: mutate(
        "case",
        (q) =>
          (q.questions = Array.from({ length: 9 }, () =>
            clone((base("case") as Loose).questions[1]),
          )),
      ),
      path: "$.questions",
      message: /at most 8/,
    },
    {
      name: "a mistake inside a case sub-question points at it",
      input: mutate("case", (q) => (q.questions[0].options = [{ text: "A" }, { text: "B" }])),
      path: "$.questions[0].options",
      message: /^Sub-question 1: No option is marked correct/,
    },
    {
      name: "a sub-question that is missing its explanation",
      input: mutate("case", (q) => delete q.questions[1].explanation),
      path: "$.questions[1].explanation",
      message: /explanation/,
    },
    {
      name: "free response with repeated key points",
      input: mutate(
        "free_response",
        (q) =>
          (q.rubric = [
            { point: "Rate", points: 1 },
            { point: "rate.", points: 2 },
          ]),
      ),
      path: "$.rubric[1].point",
      message: /repeats key point 1/,
    },
    {
      name: "free response key point with zero points",
      input: mutate("free_response", (q) => (q.rubric = [{ point: "Rate", points: 0 }])),
      path: "$.rubric[0].points",
      message: /./,
    },
    {
      name: "flashcard with the same front and back",
      input: mutate("flashcard", (q) => (q.back = q.front)),
      path: "$.back",
      message: /same as the front/,
    },
    {
      name: "tag too long",
      input: mutate("flashcard", (q) => (q.tags = ["x".repeat(41)])),
      path: "$.tags[0]",
      message: /./,
    },
  ];

  it("covers at least fifty distinct mistakes", () => {
    expect(cases.length).toBeGreaterThanOrEqual(50);
  });

  it.each(cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const found = problems(c.input);
    const hit = found.find((p) => p.path === c.path && c.message.test(p.message));
    expect(
      hit,
      `looking for ${c.path} ${c.message}\n--- got:\n${messagesOf(c.input)}`,
    ).toBeDefined();
    for (const p of found) {
      expect(p.path.startsWith("$")).toBe(true);
      expect(p.message.length).toBeGreaterThan(5);
      expect(p.example).toBeTruthy();
    }
  });

  it("every example in a problem is itself valid", () => {
    for (const c of cases) {
      for (const p of problems(c.input)) {
        const r = validateQuestionInput(p.example);
        expect(r.ok, `${c.name}: ${JSON.stringify(p.example).slice(0, 80)}`).toBe(true);
      }
    }
  });

  it("the example matches the question's type when the type is known", () => {
    for (const type of QUESTION_TYPES) {
      const found = problems(mutate(type, (q) => (q.bogusField = 1)));
      expect(found[0]?.example.type).toBe(type);
    }
  });

  it("reports several problems at once", () => {
    const found = problems(
      mutate("multiple_choice", (q) => {
        q.options = [{ text: "A" }, { text: "a" }];
        delete q.sources;
        q.prompt = "<i>x</i>";
      }),
    );
    expect(found.length).toBeGreaterThanOrEqual(4);
  });

  it("explains non-objects", () => {
    for (const bad of [null, undefined, 5, "text", []]) {
      const found = problems(bad);
      expect(found[0]?.path).toBe("$");
      expect(found[0]?.message).toContain("multiple_choice");
    }
  });
});

describe("stored questions obey the same rules", () => {
  it("rejects a stored question with two correct options", () => {
    const r = validateQuestionInput(base("multiple_choice"));
    if (!r.ok) throw new Error("invalid");
    const stored = toStoredQuestion(r.question, {
      author: { type: "user", userId: newId("user") },
      now: "2026-11-15T10:00:00.000Z",
    }) as Loose;
    stored.options[1].correct = true;
    expect(Question.safeParse(stored).success).toBe(false);
  });
  it("rejects a stored question with no id, author or review", () => {
    for (const field of ["id", "author", "createdAt", "updatedAt"]) {
      const r = validateQuestionInput(base("flashcard"));
      if (!r.ok) throw new Error("invalid");
      const stored = toStoredQuestion(r.question, {
        author: { type: "user", userId: newId("user") },
        now: "2026-11-15T10:00:00.000Z",
      }) as Loose;
      delete stored[field];
      expect(Question.safeParse(stored).success, field).toBe(false);
    }
  });
  it("requires option ids once stored", () => {
    const input = base("multiple_choice");
    const stored = {
      ...input,
      id: newId("question"),
      author: { type: "user", userId: newId("user") },
      createdAt: "2026-11-15T10:00:00.000Z",
      updatedAt: "2026-11-15T10:00:00.000Z",
      review: "reviewed",
    };
    expect(Question.safeParse(stored).success).toBe(false);
  });
  it("accepts review status reviewed and rejects others", () => {
    const r = validateQuestionInput(base("flashcard"));
    if (!r.ok) throw new Error("invalid");
    const stored = toStoredQuestion(r.question, {
      author: { type: "user", userId: newId("user") },
      now: "2026-11-15T10:00:00.000Z",
    });
    expect(Question.safeParse({ ...stored, review: "reviewed" }).success).toBe(true);
    expect(Question.safeParse({ ...stored, review: "approved" }).success).toBe(false);
  });
});
