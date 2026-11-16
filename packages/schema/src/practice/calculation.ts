/**
 * Calculation questions: making a variant from a seed, reading her answer, and
 * judging it. All pure and deterministic.
 */
import type { PartOfType, Rounding, Tolerance } from "./content.js";
import { DEFAULT_TOLERANCE } from "./content.js";
import { ExpressionError } from "./expression.js";
import { formatNumber, parseLeadingNumber, roundDecimals, roundSigFigs } from "./numbers.js";
import { deriveSeed, makeRng } from "./rng.js";
import {
  convertValue,
  describeUnitKind,
  equivalentUnits,
  type ParsedUnit,
  parseUnit,
  sameDimension,
} from "./units.js";
import {
  answerValue,
  fillPlaceholders,
  formatValue,
  pickValues,
  sampleCombinations,
} from "./variants.js";

export type CalculationCore = PartOfType<"calculation">;

/** A calculation question with its numbers filled in for one seed. */
export interface CalculationInstance {
  /** The prompt with {name} replaced by this variant's numbers. */
  prompt: string;
  /** The explanation with {name} and {answer} replaced. */
  explanation: string;
  /** The numbers chosen for each variable (empty for a fixed question). */
  values: Record<string, number>;
  /** The correct value before any rounding instruction. */
  exact: number;
  /** The value she must give: `exact`, rounded as instructed. */
  expected: number;
  /** The unit shown with the answer (the first of `units`). */
  unit: string;
  /** "2.5 mg", ready to show. */
  answerText: string;
}

/** Round a value as a rounding instruction says. */
export function applyRounding(x: number, rounding: Rounding | undefined): number {
  if (!rounding) return x;
  return rounding.mode === "decimals"
    ? roundDecimals(x, rounding.places)
    : roundSigFigs(x, rounding.figures);
}

/**
 * Fill in a calculation for a seed. The same seed always gives the same
 * numbers. Throws ExpressionError only if the question is broken (an
 * expression that fails for every value in range); authoring checks catch that
 * before a question is stored.
 */
export function instantiateCalculation(core: CalculationCore, seed: number): CalculationInstance {
  let values: Record<string, number> = {};
  let exact: number;
  const answer = core.answer;
  if (answer.kind === "fixed") {
    exact = answer.value;
  } else {
    const rng = makeRng(deriveSeed(seed, "variant"));
    let found: { values: Record<string, number>; exact: number } | null = null;
    let lastError: unknown;
    for (let attempt = 0; attempt < 30 && !found; attempt++) {
      const picked = pickValues(answer.variables, rng);
      try {
        found = { values: picked, exact: answerValue(answer, picked) };
      } catch (e) {
        lastError = e;
      }
    }
    if (!found) {
      for (const combo of sampleCombinations(answer.variables, rng, 200)) {
        try {
          found = { values: combo, exact: answerValue(answer, combo) };
          break;
        } catch (e) {
          lastError = e;
        }
      }
    }
    if (!found)
      throw lastError instanceof Error ? lastError : new ExpressionError("No usable values.");
    values = found.values;
    exact = found.exact;
  }
  const expected = applyRounding(exact, core.rounding);
  const unit = core.units[0] as string;
  const shown: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) shown[k] = formatValue(v);
  const answerText = `${formatNumber(expected)} ${unit}`;
  return {
    prompt: fillPlaceholders(core.prompt, shown),
    explanation: fillPlaceholders(core.explanation, { ...shown, answer: answerText }),
    values,
    exact,
    expected,
    unit,
    answerText,
  };
}

export type CalculationCode =
  | "correct"
  | "empty"
  | "no_number"
  | "bad_number"
  | "fraction_not_allowed"
  | "zero_denominator"
  | "missing_unit"
  | "unknown_unit"
  | "wrong_unit"
  | "unit_given_twice"
  | "magnitude_off"
  | "rounding"
  | "too_high"
  | "too_low"
  | "variant_unavailable";

export interface CalculationVerdict {
  correct: boolean;
  code: CalculationCode;
  message: string;
}

/** Is `value` within the tolerance of `target`? The boundary counts as inside. */
export function withinTolerance(value: number, target: number, tolerance: Tolerance): boolean {
  const allowed =
    tolerance.mode === "relative" ? (Math.abs(target) * tolerance.percent) / 100 : tolerance.amount;
  const slack = 1e-9 * Math.max(1, Math.abs(target));
  return Math.abs(value - target) <= allowed + slack;
}

function roundingText(r: Rounding): string {
  return r.mode === "decimals"
    ? `${r.places} decimal place${r.places === 1 ? "" : "s"}`
    : `${r.figures} significant figure${r.figures === 1 ? "" : "s"}`;
}

function precisionOk(r: Rounding, p: { decimals: number; sigFigs: number }): boolean {
  return r.mode === "decimals" ? p.decimals <= r.places : p.sigFigs <= r.figures;
}

/** "1000 times" or "1/1000" wording for a power-of-ten ratio, or null if the ratio is not one. */
function magnitudeRatio(value: number, target: number): { k: number } | null {
  if (value === 0 || target === 0 || Math.sign(value) !== Math.sign(target)) return null;
  const ratio = value / target;
  const k = Math.round(Math.log10(ratio));
  if (k === 0 || Math.abs(k) > 9) return null;
  return Math.abs(ratio / 10 ** k - 1) < 0.05 ? { k } : null;
}

function timesText(k: number): string {
  return k > 0 ? `${10 ** k} times too large` : `${10 ** -k} times too small`;
}

/**
 * Judge what she typed against the correct value.
 *
 * Order of checks: read the number; require a unit; check the unit measures
 * the right thing; convert if she used another size of the unit; compare with
 * the tolerance; enforce the rounding instruction. The first failure is
 * reported with a specific reason.
 */
export function judgeCalculation(
  core: CalculationCore,
  answer: { response: string; unit?: string | undefined },
  instance: CalculationInstance,
): CalculationVerdict {
  const fail = (code: CalculationCode, message: string): CalculationVerdict => ({
    correct: false,
    code,
    message,
  });
  const expectedUnit = parseUnit(instance.unit) as ParsedUnit;
  const response = answer.response.trim();
  if (response === "") return fail("empty", "No answer was entered.");

  const num = parseLeadingNumber(response, core.allowFractions);
  if (!num.ok) return fail(num.code, num.reason);

  const unitField = (answer.unit ?? "").trim();
  if (num.rest !== "" && unitField !== "") {
    return fail(
      "unit_given_twice",
      "The unit was given twice (in the answer and in the unit box). Give it once.",
    );
  }
  const unitText = num.rest !== "" ? num.rest : unitField;
  if (unitText === "") {
    return fail(
      "missing_unit",
      `No unit given. This answer needs a unit, for example "${formatNumber(instance.expected)} ${instance.unit}".`,
    );
  }
  const given = parseUnit(unitText);
  if (!given) {
    return fail(
      "unknown_unit",
      `"${unitText}" is not a unit I recognise. Use units such as ${core.units.slice(0, 3).join(", ")}.`,
    );
  }
  if (!sameDimension(given, expectedUnit)) {
    return fail(
      "wrong_unit",
      `Wrong unit: "${unitText}" measures ${describeUnitKind(given)}, but this answer is ${describeUnitKind(expectedUnit)} (in ${instance.unit}).`,
    );
  }

  let value = num.value;
  let conversionNote = "";
  const sameSize = equivalentUnits(given, expectedUnit);
  if (!sameSize) {
    const converted = convertValue(num.value, given, expectedUnit) as number;
    if (core.rounding || !core.convertUnits) {
      const ratio = converted !== 0 ? magnitudeRatio(converted, instance.expected) : null;
      return fail(
        ratio ? "magnitude_off" : "wrong_unit",
        `Give the answer in ${instance.unit}. ${formatNumber(num.value)} ${given.canonical} is ${formatNumber(converted)} ${instance.unit}` +
          (ratio ? `, which is ${timesText(ratio.k)}: the magnitude is off.` : "."),
      );
    }
    value = converted;
    conversionNote = `${formatNumber(num.value)} ${given.canonical} = ${formatNumber(converted)} ${instance.unit}. `;
  }

  const tolerance = core.tolerance ?? DEFAULT_TOLERANCE;
  const target = instance.expected;
  const valueOk = withinTolerance(value, target, tolerance);
  const precision = core.rounding ? precisionOk(core.rounding, num) : true;

  if (valueOk && precision) {
    return {
      correct: true,
      code: "correct",
      message: conversionNote ? `${conversionNote}That matches the answer.` : "Correct.",
    };
  }
  if (
    !precision &&
    core.rounding &&
    (valueOk || withinTolerance(value, instance.exact, tolerance))
  ) {
    return fail(
      "rounding",
      `The value is right but not rounded as asked. Round to ${roundingText(core.rounding)} (you gave ${num.decimals} decimal place${num.decimals === 1 ? "" : "s"}, ${num.sigFigs} significant figure${num.sigFigs === 1 ? "" : "s"}).`,
    );
  }
  const ratio = magnitudeRatio(value, target);
  if (ratio) {
    return fail(
      "magnitude_off",
      `${conversionNote}The magnitude is off: your answer is ${timesText(ratio.k)}. Check the unit and the decimal point.`,
    );
  }
  return fail(
    value > target ? "too_high" : "too_low",
    `${conversionNote}Not correct: your value is ${value > target ? "too high" : "too low"} (outside the accepted tolerance).`,
  );
}
