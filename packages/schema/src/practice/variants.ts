import { z } from "zod";
import {
  EXPRESSION_CONSTANT_NAMES,
  EXPRESSION_FUNCTION_NAMES,
  evaluateExpression,
} from "./expression.js";
import type { Rng } from "./rng.js";

/** Largest number of values one variable may range over. */
export const MAX_VARIABLE_VALUES = 10_000;
/** Most variables one question may have. */
export const MAX_VARIABLES = 8;

/** Variable names: start with a lower-case letter, letters, digits and underscores after. */
export const VARIABLE_NAME = /^[a-z][A-Za-z0-9_]{0,23}$/;

export const RESERVED_NAMES: ReadonlySet<string> = new Set<string>([
  ...EXPRESSION_FUNCTION_NAMES,
  ...EXPRESSION_CONSTANT_NAMES,
  "answer",
]);

/** A number that takes every value from min to max in steps (inclusive). */
export const RangeVariable = z.strictObject({
  kind: z.literal("range"),
  min: z.number(),
  max: z.number(),
  step: z.number().positive("step must be greater than 0"),
});

/** A number chosen from a fixed list of values. */
export const ListVariable = z.strictObject({
  kind: z.literal("list"),
  values: z
    .array(z.number())
    .min(1, "values needs at least one number")
    .max(50, "values has at most 50 numbers"),
});

export const VariableSpec = z.discriminatedUnion("kind", [RangeVariable, ListVariable], {
  error: 'A variable needs kind: "range" (min, max, step) or kind: "list" (values).',
});
export type VariableSpec = z.infer<typeof VariableSpec>;

const Variables = z.record(z.string(), VariableSpec);

/** The correct answer: a fixed number, or an expression over named variables. */
export const CalcAnswer = z.discriminatedUnion(
  "kind",
  [
    z.strictObject({ kind: z.literal("fixed"), value: z.number() }),
    z.strictObject({
      kind: z.literal("expression"),
      expression: z.string().min(1).max(300),
      variables: Variables,
    }),
  ],
  { error: 'answer needs kind: "fixed" (value) or kind: "expression" (expression, variables).' },
);
export type CalcAnswer = z.infer<typeof CalcAnswer>;

function roundTo10(x: number): number {
  return Number(x.toFixed(10));
}

/** How many values a variable can take. */
export function valueCount(spec: VariableSpec): number {
  if (spec.kind === "list") return spec.values.length;
  if (spec.max < spec.min) return 0;
  return Math.floor((spec.max - spec.min) / spec.step + 1e-9) + 1;
}

/** The i-th value of a variable (0-based). */
export function valueAt(spec: VariableSpec, i: number): number {
  if (spec.kind === "list") return spec.values[i] as number;
  return roundTo10(spec.min + i * spec.step);
}

/** Choose one value for every variable, in a fixed (alphabetical) order so a seed always gives the same numbers. */
export function pickValues(
  variables: Readonly<Record<string, VariableSpec>>,
  rng: Rng,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of Object.keys(variables).sort()) {
    const spec = variables[name] as VariableSpec;
    const count = Math.max(1, valueCount(spec));
    out[name] = valueAt(spec, Math.min(count - 1, Math.floor(rng() * count)));
  }
  return out;
}

/** Evaluate the answer for one choice of variable values. Throws ExpressionError if it is undefined. */
export function answerValue(answer: CalcAnswer, values: Readonly<Record<string, number>>): number {
  return answer.kind === "fixed" ? answer.value : evaluateExpression(answer.expression, values);
}

/**
 * Every combination of variable values, or, when there are too many, the
 * corner combinations plus a seeded sample. Used to prove an expression is
 * safe for the whole range.
 */
export function sampleCombinations(
  variables: Readonly<Record<string, VariableSpec>>,
  rng: Rng,
  limit = 600,
): Array<Record<string, number>> {
  const names = Object.keys(variables).sort();
  const counts = names.map((n) => Math.max(1, valueCount(variables[n] as VariableSpec)));
  const total = counts.reduce((a, b) => a * b, 1);
  const combos: Array<Record<string, number>> = [];
  if (total <= limit) {
    for (let k = 0; k < total; k++) {
      let rest = k;
      const combo: Record<string, number> = {};
      names.forEach((n, idx) => {
        const c = counts[idx] as number;
        combo[n] = valueAt(variables[n] as VariableSpec, rest % c);
        rest = Math.floor(rest / c);
      });
      combos.push(combo);
    }
    return combos;
  }
  const corners = Math.min(2 ** names.length, 256);
  for (let k = 0; k < corners; k++) {
    const combo: Record<string, number> = {};
    names.forEach((n, idx) => {
      const c = counts[idx] as number;
      combo[n] = valueAt(variables[n] as VariableSpec, (k >> idx) & 1 ? c - 1 : 0);
    });
    combos.push(combo);
  }
  while (combos.length < limit) combos.push(pickValues(variables, rng));
  return combos;
}

/** Format a number for display inside a prompt. */
export function formatValue(x: number): string {
  return String(Number(x.toPrecision(12)));
}

/** Replace `{name}` placeholders with values; placeholders with no value are left as they are. */
export function fillPlaceholders(text: string, values: Readonly<Record<string, string>>): string {
  return text.replace(/\{([a-z][A-Za-z0-9_]*)\}/g, (whole, name: string) =>
    Object.hasOwn(values, name) ? (values[name] as string) : whole,
  );
}

/** The names used as `{name}` placeholders in a text. */
export function placeholdersIn(text: string): string[] {
  return [...new Set([...text.matchAll(/\{([a-z][A-Za-z0-9_]*)\}/g)].map((m) => m[1] as string))];
}
