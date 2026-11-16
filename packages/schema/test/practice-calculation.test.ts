import { describe, expect, it } from "vitest";
import {
  instantiateCalculation,
  judgeCalculation,
  withinTolerance,
} from "../src/practice/calculation.js";
import { QuestionPart } from "../src/practice/content.js";
import { grade } from "../src/practice/grading.js";
import {
  convertValue,
  describeUnitKind,
  equivalentUnits,
  parseUnit,
} from "../src/practice/units.js";

type Overrides = {
  value?: number;
  units?: string[];
  tolerance?: unknown;
  rounding?: unknown;
  allowFractions?: boolean;
  convertUnits?: boolean;
};

function calc(o: Overrides = {}) {
  return QuestionPart.parse({
    type: "calculation",
    prompt: "Calculate the dose.",
    explanation: "Worked solution.",
    answer: { kind: "fixed", value: o.value ?? 2.5 },
    units: o.units ?? ["mg", "milligram"],
    ...(o.tolerance ? { tolerance: o.tolerance } : {}),
    ...(o.rounding ? { rounding: o.rounding } : {}),
    ...(o.allowFractions !== undefined ? { allowFractions: o.allowFractions } : {}),
    ...(o.convertUnits !== undefined ? { convertUnits: o.convertUnits } : {}),
  }) as Extract<QuestionPart, { type: "calculation" }>;
}

function verdict(o: Overrides, response: string, unit?: string) {
  const q = calc(o);
  return judgeCalculation(q, { response, unit }, instantiateCalculation(q, 0));
}

type Row = [
  label: string,
  o: Overrides,
  response: string,
  unit: string | undefined,
  ok: boolean,
  code: string,
];

const ROWS: Row[] = [
  // --- number reading, correct forms
  ["plain with space", {}, "2.5 mg", undefined, true, "correct"],
  ["no space between number and unit", {}, "2.5mg", undefined, true, "correct"],
  ["trailing zero", {}, "2.50 mg", undefined, true, "correct"],
  ["many trailing zeros", {}, "2.5000 mg", undefined, true, "correct"],
  ["leading zero", {}, "02.5 mg", undefined, true, "correct"],
  ["bare leading point", { value: 0.5 }, ".5 mg", undefined, true, "correct"],
  ["bare leading comma decimal", { value: 0.5 }, ",5 mg", undefined, true, "correct"],
  ["decimal comma", {}, "2,5 mg", undefined, true, "correct"],
  ["scientific, small mantissa", {}, ".25e1 mg", undefined, true, "correct"],
  ["scientific e0", {}, "2.5e0 mg", undefined, true, "correct"],
  ["scientific negative power", {}, "25e-1 mg", undefined, true, "correct"],
  ["full word unit", {}, "2.5 milligrams", undefined, true, "correct"],
  ["singular word unit", {}, "2.5 milligram", undefined, true, "correct"],
  ["upper-case unit", {}, "2.5 MG", undefined, true, "correct"],
  ["odd-case unit", {}, "2.5 Mg", undefined, true, "correct"],
  ["sentence full stop after unit", {}, "2.5mg.", undefined, true, "correct"],
  ["outer spaces", {}, "  2.5   mg  ", undefined, true, "correct"],
  ["explicit plus", {}, "+2.5 mg", undefined, true, "correct"],
  ["unit in separate box", {}, "2.5", "mg", true, "correct"],
  ["unit box with word", {}, "2.5", "milligrams", true, "correct"],
  // --- missing / unreadable
  ["missing unit", {}, "2.5", undefined, false, "missing_unit"],
  ["missing unit, blank unit box", {}, "2.5", "  ", false, "missing_unit"],
  ["empty answer", {}, "", undefined, false, "empty"],
  ["blank answer", {}, "   ", undefined, false, "empty"],
  ["unit only", {}, "mg", undefined, false, "no_number"],
  ["words", {}, "two point five mg", undefined, false, "no_number"],
  ["number after unit", {}, "mg 2.5", undefined, false, "no_number"],
  ["two decimal points", {}, "2.5.5 mg", undefined, false, "bad_number"],
  ["bad comma groups", {}, "2,5,5 mg", undefined, false, "bad_number"],
  ["absurd exponent", {}, "1e999 mg", undefined, false, "bad_number"],
  ["unit given twice", {}, "2.5 mg", "mg", false, "unit_given_twice"],
  // --- wrong units
  ["volume instead of mass", {}, "2.5 mL", undefined, false, "wrong_unit"],
  ["time instead of mass", {}, "2.5 hr", undefined, false, "wrong_unit"],
  ["unknown unit", {}, "2.5 blah", undefined, false, "unknown_unit"],
  ["two units", {}, "2.5 mg kg", undefined, false, "unknown_unit"],
  [
    "U is not accepted for units",
    { units: ["units"], value: 10 },
    "10 U",
    undefined,
    false,
    "unknown_unit",
  ],
  // --- 1000-fold and other power-of-ten errors
  ["grams for milligrams", {}, "2.5 g", undefined, false, "magnitude_off"],
  ["kilograms for milligrams", {}, "2.5 kg", undefined, false, "magnitude_off"],
  ["micrograms for milligrams", {}, "2.5 mcg", undefined, false, "magnitude_off"],
  ["ug for milligrams", {}, "2.5 ug", undefined, false, "magnitude_off"],
  ["right unit, 1000 times too big", {}, "2500 mg", undefined, false, "magnitude_off"],
  ["right unit, 1000 times too small", {}, "0.0025 mg", undefined, false, "magnitude_off"],
  ["right unit, 10 times too big", {}, "25 mg", undefined, false, "magnitude_off"],
  ["right unit, 10 times too small", {}, "0.25 mg", undefined, false, "magnitude_off"],
  ["decimal point slip, 100 times", {}, "250 mg", undefined, false, "magnitude_off"],
  // --- unit conversion that is right
  ["micrograms equal to the answer", {}, "2500 mcg", undefined, true, "correct"],
  ["ug spelling", {}, "2500 ug", undefined, true, "correct"],
  ["Greek mu spelling", {}, "2500 μg", undefined, true, "correct"],
  ["micro sign spelling", {}, "2500 µg", undefined, true, "correct"],
  ["micrograms in words", {}, "2500 micrograms", undefined, true, "correct"],
  ["grams that equal the answer", {}, "0.0025 g", undefined, true, "correct"],
  ["conversion switched off", { convertUnits: false }, "0.0025 g", undefined, false, "wrong_unit"],
  [
    "conversion switched off, mcg",
    { convertUnits: false },
    "2500 mcg",
    undefined,
    false,
    "wrong_unit",
  ],
  // --- tolerance, relative (default 1%), boundaries
  ["exactly +1%", {}, "2.525 mg", undefined, true, "correct"],
  ["just over +1%", {}, "2.5251 mg", undefined, false, "too_high"],
  ["exactly -1%", {}, "2.475 mg", undefined, true, "correct"],
  ["just under -1%", {}, "2.4749 mg", undefined, false, "too_low"],
  ["4% low", {}, "2.4 mg", undefined, false, "too_low"],
  ["4% high", {}, "2.6 mg", undefined, false, "too_high"],
  [
    "relative 5%, edge",
    { tolerance: { mode: "relative", percent: 5 } },
    "2.625 mg",
    undefined,
    true,
    "correct",
  ],
  [
    "relative 5%, outside",
    { tolerance: { mode: "relative", percent: 5 } },
    "2.6251 mg",
    undefined,
    false,
    "too_high",
  ],
  [
    "relative 0, exact",
    { tolerance: { mode: "relative", percent: 0 }, value: 4 },
    "4 mg",
    undefined,
    true,
    "correct",
  ],
  [
    "relative 0, off by a hair",
    { tolerance: { mode: "relative", percent: 0 }, value: 4 },
    "4.001 mg",
    undefined,
    false,
    "too_high",
  ],
  // --- tolerance, absolute
  [
    "absolute edge up",
    { tolerance: { mode: "absolute", amount: 0.05 } },
    "2.55 mg",
    undefined,
    true,
    "correct",
  ],
  [
    "absolute edge down",
    { tolerance: { mode: "absolute", amount: 0.05 } },
    "2.45 mg",
    undefined,
    true,
    "correct",
  ],
  [
    "absolute just outside",
    { tolerance: { mode: "absolute", amount: 0.05 } },
    "2.5501 mg",
    undefined,
    false,
    "too_high",
  ],
  [
    "absolute around zero",
    { value: 0, tolerance: { mode: "absolute", amount: 0.01 } },
    "0 mg",
    undefined,
    true,
    "correct",
  ],
  [
    "absolute around zero, inside",
    { value: 0, tolerance: { mode: "absolute", amount: 0.01 } },
    "0.005 mg",
    undefined,
    true,
    "correct",
  ],
  [
    "absolute around zero, outside",
    { value: 0, tolerance: { mode: "absolute", amount: 0.01 } },
    "0.02 mg",
    undefined,
    false,
    "too_high",
  ],
  // --- fractions
  ["fraction allowed", { value: 0.5, allowFractions: true }, "1/2 mg", undefined, true, "correct"],
  [
    "fraction with spaces",
    { value: 0.5, allowFractions: true },
    "1 / 2 mg",
    undefined,
    true,
    "correct",
  ],
  [
    "mixed number allowed",
    { value: 1.5, allowFractions: true },
    "1 1/2 mg",
    undefined,
    true,
    "correct",
  ],
  ["fraction not allowed", { value: 0.5 }, "1/2 mg", undefined, false, "fraction_not_allowed"],
  [
    "mixed number not allowed",
    { value: 1.5 },
    "1 1/2 mg",
    undefined,
    false,
    "fraction_not_allowed",
  ],
  [
    "zero denominator",
    { value: 0.5, allowFractions: true },
    "1/0 mg",
    undefined,
    false,
    "zero_denominator",
  ],
  [
    "fraction is not confused with a unit",
    { value: 5, units: ["mg/kg"] },
    "5 mg/kg",
    undefined,
    true,
    "correct",
  ],
  // --- thousands separators and sci notation on a big answer
  ["thousands comma", { value: 1250, units: ["mg"] }, "1,250 mg", undefined, true, "correct"],
  [
    "millions with commas",
    { value: 1250000, units: ["units"] },
    "1,250,000 units",
    undefined,
    true,
    "correct",
  ],
  [
    "european thousands dot",
    { value: 1250000, units: ["units"] },
    "1.250.000 units",
    undefined,
    true,
    "correct",
  ],
  ["no separator", { value: 1250, units: ["mg"] }, "1250 mg", undefined, true, "correct"],
  [
    "thousands then decimal",
    { value: 1250.5, units: ["mg"] },
    "1,250.5 mg",
    undefined,
    true,
    "correct",
  ],
  [
    "european thousands and decimal",
    { value: 1250.5, units: ["mg"] },
    "1.250,5 mg",
    undefined,
    true,
    "correct",
  ],
  [
    "decimal comma on a big number",
    { value: 1250.5, units: ["mg"] },
    "1250,5 mg",
    undefined,
    true,
    "correct",
  ],
  [
    "space as thousands separator is not guessed",
    { value: 1250, units: ["mg"] },
    "1 250 mg",
    undefined,
    false,
    "unknown_unit",
  ],
  ["e notation", { value: 1500, units: ["mg"] }, "1.5e3 mg", undefined, true, "correct"],
  ["capital E notation", { value: 1500, units: ["mg"] }, "1.5E3mg", undefined, true, "correct"],
  ["times ten to the", { value: 1500, units: ["mg"] }, "1.5 x 10^3 mg", undefined, true, "correct"],
  ["times sign", { value: 1500, units: ["mg"] }, "1.5×10^3 mg", undefined, true, "correct"],
  ["asterisk times", { value: 1500, units: ["mg"] }, "1.5 * 10^3 mg", undefined, true, "correct"],
  [
    "negative exponent form",
    { value: 0.0015, units: ["mg"] },
    "1.5 x 10^-3 mg",
    undefined,
    true,
    "correct",
  ],
  // --- negative numbers
  [
    "negative",
    { value: -2, units: ["mEq"], tolerance: { mode: "absolute", amount: 0.1 } },
    "-2 mEq",
    undefined,
    true,
    "correct",
  ],
  [
    "unicode minus",
    { value: -2, units: ["mEq"], tolerance: { mode: "absolute", amount: 0.1 } },
    "−2 mEq",
    undefined,
    true,
    "correct",
  ],
  ["wrong sign", { value: -2, units: ["mEq"] }, "2 mEq", undefined, false, "too_high"],
  // --- compound units
  ["mg/kg", { value: 5, units: ["mg/kg"] }, "5 mg/kg", undefined, true, "correct"],
  ["mg/kg no space", { value: 5, units: ["mg/kg"] }, "5mg/kg", undefined, true, "correct"],
  ["mg per kg", { value: 5, units: ["mg/kg"] }, "5 mg per kg", undefined, true, "correct"],
  [
    "words per words",
    { value: 5, units: ["mg/kg"] },
    "5 milligrams per kilogram",
    undefined,
    true,
    "correct",
  ],
  ["spaced slash", { value: 5, units: ["mg/kg"] }, "5 mg / kg", undefined, true, "correct"],
  ["g/kg equals", { value: 5, units: ["mg/kg"] }, "0.005 g/kg", undefined, true, "correct"],
  [
    "mcg/kg is 1000x off",
    { value: 5, units: ["mg/kg"] },
    "5 mcg/kg",
    undefined,
    false,
    "magnitude_off",
  ],
  ["plain mg is not mg/kg", { value: 5, units: ["mg/kg"] }, "5 mg", undefined, false, "wrong_unit"],
  ["mL/kg is not mg/kg", { value: 5, units: ["mg/kg"] }, "5 mL/kg", undefined, false, "wrong_unit"],
  ["extra per-day", { value: 5, units: ["mg/kg"] }, "5 mg/kg/day", undefined, false, "wrong_unit"],
  ["mL/L is not mg/kg", { value: 5, units: ["mg/kg"] }, "5 mL/L", undefined, false, "wrong_unit"],
  ["mcg/kg/min", { value: 5, units: ["mcg/kg/min"] }, "5 mcg/kg/min", undefined, true, "correct"],
  [
    "per-hour rate equals per-minute rate",
    { value: 6, units: ["mcg/kg/min"] },
    "360 mcg/kg/hr",
    undefined,
    true,
    "correct",
  ],
  ["mL/hr", { value: 100, units: ["mL/hr"] }, "100 mL/hr", undefined, true, "correct"],
  ["ml/h lower case", { value: 100, units: ["mL/hr"] }, "100 ml/h", undefined, true, "correct"],
  ["ML/HR upper case", { value: 100, units: ["mL/hr"] }, "100 ML/HR", undefined, true, "correct"],
  [
    "mL/min converts",
    { value: 100, units: ["mL/hr"] },
    "1.6667 mL/min",
    undefined,
    true,
    "correct",
  ],
  [
    "mL/min wrong size, not a power of ten",
    { value: 100, units: ["mL/hr"] },
    "100 mL/min",
    undefined,
    false,
    "too_high",
  ],
  [
    "L/hr is 1000x",
    { value: 100, units: ["mL/hr"] },
    "100 L/hr",
    undefined,
    false,
    "magnitude_off",
  ],
  [
    "volume only for a rate",
    { value: 100, units: ["mL/hr"] },
    "100 mL",
    undefined,
    false,
    "wrong_unit",
  ],
  ["units", { value: 10, units: ["units"] }, "10 units", undefined, true, "correct"],
  ["unit singular", { value: 10, units: ["units"] }, "10 unit", undefined, true, "correct"],
  ["mEq", { value: 40, units: ["mEq"] }, "40 mEq", undefined, true, "correct"],
  ["meq lower case", { value: 40, units: ["mEq"] }, "40 meq", undefined, true, "correct"],
  ["mEq is not mg", { value: 40, units: ["mEq"] }, "40 mg", undefined, false, "wrong_unit"],
  ["mg/dL", { value: 1.2, units: ["mg/dL"] }, "1.2 mg/dL", undefined, true, "correct"],
  [
    "mg/dL vs mg/L is 10x",
    { value: 1.2, units: ["mg/dL"] },
    "1.2 mg/L",
    undefined,
    false,
    "magnitude_off",
  ],
  [
    "mcg for mg expected in mcg",
    { value: 2500, units: ["mcg", "ug"] },
    "2.5 mg",
    undefined,
    true,
    "correct",
  ],
  ["tablet", { value: 2, units: ["tablet"] }, "2 tabs", undefined, true, "correct"],
  // --- rounding enforced
  [
    "round 1 dp: correct",
    { value: 3.456, rounding: { mode: "decimals", places: 1 } },
    "3.5 mg",
    undefined,
    true,
    "correct",
  ],
  [
    "round 1 dp: too many places",
    { value: 3.456, rounding: { mode: "decimals", places: 1 } },
    "3.46 mg",
    undefined,
    false,
    "rounding",
  ],
  [
    "round 1 dp: unrounded",
    { value: 3.456, rounding: { mode: "decimals", places: 1 } },
    "3.456 mg",
    undefined,
    false,
    "rounding",
  ],
  [
    "round 1 dp: trailing zero still too precise",
    { value: 3.456, rounding: { mode: "decimals", places: 1 } },
    "3.50 mg",
    undefined,
    false,
    "rounding",
  ],
  [
    "round 1 dp: truncated instead",
    { value: 3.456, rounding: { mode: "decimals", places: 1 } },
    "3.4 mg",
    undefined,
    false,
    "too_low",
  ],
  [
    "round 0 dp half up",
    { value: 7.5, rounding: { mode: "decimals", places: 0 } },
    "8 mg",
    undefined,
    true,
    "correct",
  ],
  [
    "round 0 dp unrounded",
    { value: 7.5, rounding: { mode: "decimals", places: 0 } },
    "7.5 mg",
    undefined,
    false,
    "rounding",
  ],
  [
    "round 2 dp half up",
    { value: 2.675, rounding: { mode: "decimals", places: 2 } },
    "2.68 mg",
    undefined,
    true,
    "correct",
  ],
  [
    "round 2 dp fewer places is fine",
    { value: 2.5, rounding: { mode: "decimals", places: 2 } },
    "2.5 mg",
    undefined,
    true,
    "correct",
  ],
  [
    "3 sig figs: correct",
    { value: 1234.5, rounding: { mode: "sigfigs", figures: 3 } },
    "1230 mg",
    undefined,
    true,
    "correct",
  ],
  [
    "3 sig figs: sci form",
    { value: 1234.5, rounding: { mode: "sigfigs", figures: 3 } },
    "1.23e3 mg",
    undefined,
    true,
    "correct",
  ],
  [
    "3 sig figs: with comma",
    { value: 1234.5, rounding: { mode: "sigfigs", figures: 3 } },
    "1,230 mg",
    undefined,
    true,
    "correct",
  ],
  [
    "3 sig figs: four given",
    { value: 1234.5, rounding: { mode: "sigfigs", figures: 3 } },
    "1234 mg",
    undefined,
    false,
    "rounding",
  ],
  [
    "3 sig figs: four given, off value",
    { value: 1234.5, rounding: { mode: "sigfigs", figures: 3 } },
    "1235 mg",
    undefined,
    false,
    "rounding",
  ],
  [
    "2 sig figs small number",
    { value: 0.012345, rounding: { mode: "sigfigs", figures: 2 } },
    "0.012 mg",
    undefined,
    true,
    "correct",
  ],
  [
    "2 sig figs small number, too precise",
    { value: 0.012345, rounding: { mode: "sigfigs", figures: 2 } },
    "0.0123 mg",
    undefined,
    false,
    "rounding",
  ],
  [
    "rounding blocks unit conversion",
    { value: 3.456, rounding: { mode: "decimals", places: 1 } },
    "0.0035 g",
    undefined,
    false,
    "wrong_unit",
  ],
  [
    "rounding with 1000x error says magnitude",
    { value: 3.456, rounding: { mode: "decimals", places: 1 } },
    "3.5 g",
    undefined,
    false,
    "magnitude_off",
  ],
];

describe("calculation answers: table", () => {
  it("has at least 60 cases", () => {
    expect(ROWS.length).toBeGreaterThanOrEqual(60);
  });

  it.each(ROWS)("%s", (_label, overrides, response, unit, ok, code) => {
    const v = verdict(overrides, response, unit);
    expect({ correct: v.correct, code: v.code }).toEqual({ correct: ok, code });
    expect(v.message.length).toBeGreaterThan(0);
  });
});

describe("calculation feedback is specific", () => {
  it("says the magnitude is off and by how much for a 1000-fold unit error", () => {
    const v = verdict({}, "2.5 g");
    expect(v.message).toMatch(/magnitude is off/i);
    expect(v.message).toContain("1000 times too large");
    expect(v.message).toContain("2500 mg");
  });
  it("says too small for a 1/1000 error", () => {
    expect(verdict({}, "2.5 mcg").message).toContain("1000 times too small");
  });
  it("names the missing unit and shows a model", () => {
    const v = verdict({}, "2.5");
    expect(v.message).toMatch(/No unit/);
    expect(v.message).toContain("2.5 mg");
  });
  it("explains a wrong kind of unit in words", () => {
    expect(verdict({}, "2.5 mL").message).toMatch(/measures a volume.*a mass/);
  });
  it("explains the rounding instruction", () => {
    const v = verdict({ value: 3.456, rounding: { mode: "decimals", places: 1 } }, "3.46 mg");
    expect(v.message).toContain("1 decimal place");
  });
  it("notes a conversion that was accepted", () => {
    expect(verdict({}, "0.0025 g").message).toContain("0.0025 g = 2.5 mg");
  });
});

describe("withinTolerance boundaries", () => {
  it("includes the boundary for relative and absolute tolerance", () => {
    expect(withinTolerance(101, 100, { mode: "relative", percent: 1 })).toBe(true);
    expect(withinTolerance(99, 100, { mode: "relative", percent: 1 })).toBe(true);
    expect(withinTolerance(101.0001, 100, { mode: "relative", percent: 1 })).toBe(false);
    expect(withinTolerance(98.9999, 100, { mode: "relative", percent: 1 })).toBe(false);
    expect(withinTolerance(10.5, 10, { mode: "absolute", amount: 0.5 })).toBe(true);
    expect(withinTolerance(10.5001, 10, { mode: "absolute", amount: 0.5 })).toBe(false);
  });
  it("survives floating-point noise at the boundary", () => {
    expect(withinTolerance(0.3, 0.1 + 0.2, { mode: "absolute", amount: 0 })).toBe(true);
    expect(withinTolerance(1.1, 1, { mode: "absolute", amount: 0.1 })).toBe(true);
  });
  it("relative tolerance scales with the answer", () => {
    expect(withinTolerance(1010, 1000, { mode: "relative", percent: 1 })).toBe(true);
    expect(withinTolerance(1.02, 1, { mode: "relative", percent: 1 })).toBe(false);
  });
});

describe("unit table", () => {
  it("treats ug, μg and mcg as the same", () => {
    const mcg = parseUnit("mcg") as NonNullable<ReturnType<typeof parseUnit>>;
    for (const alias of ["ug", "μg", "µg", "UG", "micrograms"]) {
      const u = parseUnit(alias) as NonNullable<ReturnType<typeof parseUnit>>;
      expect(equivalentUnits(u, mcg), alias).toBe(true);
      expect(u.canonical).toBe("mcg");
    }
  });
  it("converts within a kind and refuses across kinds", () => {
    const u = (s: string) => parseUnit(s) as NonNullable<ReturnType<typeof parseUnit>>;
    expect(convertValue(1, u("g"), u("mg"))).toBe(1000);
    expect(convertValue(1, u("kg"), u("mcg"))).toBe(1e9);
    expect(convertValue(1, u("L"), u("mL"))).toBe(1000);
    expect(convertValue(60, u("mL/min"), u("mL/hr"))).toBe(3600);
    expect(convertValue(1, u("mg"), u("mL"))).toBeNull();
    expect(convertValue(1, u("mg/kg"), u("mg"))).toBeNull();
  });
  it("rejects what is not in the table", () => {
    for (const bad of ["", "foo", "mg/foo", "oz", "lb", "cc", "mg/kg/day/x", "mg//kg", "u", "IU"]) {
      expect(parseUnit(bad), bad).toBeNull();
    }
  });
  it("describes kinds in words", () => {
    expect(describeUnitKind(parseUnit("mg") as never)).toBe("a mass");
    expect(describeUnitKind(parseUnit("mL/hr") as never)).toBe("a volume per time");
    expect(describeUnitKind(parseUnit("mcg/kg/min") as never)).toBe("a mass per mass per time");
  });
});

describe("calculation grading through grade()", () => {
  it("returns the shaped result with the correct answer to display", () => {
    const q = calc({ value: 2.5 });
    const right = grade(q, { type: "calculation", response: "2.5 mg" });
    expect(right).toMatchObject({
      correct: true,
      score: 1,
      points: 1,
      maxPoints: 1,
      malformed: false,
      selfGraded: false,
    });
    expect(right.correctAnswer.text).toBe("2.5 mg");
    const wrong = grade(q, { type: "calculation", response: "2.5 g" });
    expect(wrong.correct).toBe(false);
    expect(wrong.score).toBe(0);
    expect(wrong.feedback[0]?.code).toBe("magnitude_off");
    expect(wrong.correctAnswer.text).toBe("2.5 mg");
  });
});
