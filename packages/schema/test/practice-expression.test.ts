import { describe, expect, it } from "vitest";
import {
  assertExpressionSyntax,
  ExpressionError,
  evaluateExpression,
  expressionVariables,
} from "../src/practice/expression.js";

const ev = (src: string, vars: Record<string, number> = {}) => evaluateExpression(src, vars);

describe("expression evaluator: arithmetic", () => {
  const cases: Array<[string, number]> = [
    ["1 + 2 * 3", 7],
    ["(1 + 2) * 3", 9],
    ["10 - 4 - 3", 3],
    ["100 / 5 / 2", 10],
    ["2 ^ 3 ^ 2", 512],
    ["(2 ^ 3) ^ 2", 64],
    ["-2 ^ 2", -4],
    ["(-2) ^ 2", 4],
    ["2 ^ -2", 0.25],
    ["-3 + 5", 2],
    ["--3", 3],
    ["+4", 4],
    ["1 - -1", 2],
    ["2 * -3", -6],
    ["1e3 + 1", 1001],
    ["2.5e-1 * 4", 1],
    [".5 + .5", 1],
    ["7 / 2", 3.5],
    ["2 ^ 0.5 * 2 ^ 0.5", 2],
    ["10 - 2 ^ 2 * 2", 2],
  ];
  it.each(cases)("%s = %s", (src, expected) => {
    expect(ev(src)).toBeCloseTo(expected, 10);
  });

  it("uses variables", () => {
    expect(ev("weight * dose", { weight: 70, dose: 2.5 })).toBe(175);
    expect(ev("(140 - age) * wt / (72 * scr)", { age: 40, wt: 72, scr: 1 })).toBe(100);
  });

  it("knows pi", () => {
    expect(ev("pi")).toBeCloseTo(Math.PI, 12);
  });
});

describe("expression evaluator: functions", () => {
  const cases: Array<[string, number]> = [
    ["min(3, 1, 2)", 1],
    ["max(3, 1, 2)", 3],
    ["round(2.5)", 3],
    ["round(2.675, 2)", 2.68],
    ["round(-2.5)", -3],
    ["round(1234.5678, 1)", 1234.6],
    ["ceil(2.1)", 3],
    ["floor(2.9)", 2],
    ["sqrt(16)", 4],
    ["ln(1)", 0],
    ["log10(1000)", 3],
    ["exp(0)", 1],
    ["max(1, min(5, 3)) * 2", 6],
    ["sqrt(2 * 8)", 4],
  ];
  it.each(cases)("%s = %s", (src, expected) => {
    expect(ev(src)).toBeCloseTo(expected, 10);
  });

  it("checks the number of arguments", () => {
    expect(() => ev("sqrt(1, 2)")).toThrow(ExpressionError);
    expect(() => ev("sqrt()")).toThrow(ExpressionError);
    expect(() => ev("round(1, 2, 3)")).toThrow(ExpressionError);
    expect(() => ev("round(1, 1.5)")).toThrow(/places/);
  });
});

describe("expression evaluator: errors", () => {
  it("rejects unknown identifiers", () => {
    expect(() => ev("x + 1")).toThrow(/Unknown variable 'x'/);
    expect(() => ev("pie")).toThrow(/Unknown variable/);
  });

  it("rejects division by zero and non-finite results", () => {
    expect(() => ev("1 / 0")).toThrow(/Division by zero/);
    expect(() => ev("1 / (x - x)", { x: 3 })).toThrow(/Division by zero/);
    expect(() => ev("sqrt(0 - 1)")).toThrow(/negative/);
    expect(() => ev("ln(0)")).toThrow();
    expect(() => ev("log10(0 - 5)")).toThrow();
    expect(() => ev("10 ^ 1000")).toThrow(/finite/);
    expect(() => ev("exp(1000)")).toThrow(/finite/);
  });

  it("rejects malformed syntax with a position", () => {
    for (const bad of [
      "",
      "1 +",
      "(1 + 2",
      "1 + 2)",
      "1 2",
      "* 3",
      "1 ++* 2",
      "min(",
      "min(1,",
      "3 $ 4",
    ]) {
      expect(() => ev(bad), bad).toThrow(ExpressionError);
    }
    try {
      ev("3 $ 4");
    } catch (e) {
      expect((e as ExpressionError).position).toBe(2);
    }
  });

  it("rejects over-long and over-deep input", () => {
    expect(() => ev(`${"1+".repeat(200)}1`)).toThrow(/longer/);
    expect(() => ev(`${"(".repeat(100)}1${")".repeat(100)}`)).toThrow(/deeply/);
  });
});

describe("expression evaluator: nothing outside the allowed functions is reachable", () => {
  const attacks = [
    "constructor",
    "constructor.constructor('return 1')()",
    "__proto__",
    "x.__proto__",
    "process",
    "process.exit(1)",
    "globalThis",
    "this",
    "require('fs')",
    "eval('1')",
    "Function('return 1')()",
    "Math.max(1,2)",
    "toString",
    "hasOwnProperty",
    "valueOf()",
    "[1,2][0]",
    "x['constructor']",
    "`1`",
    "a ? b : c",
    "1; 2",
    "{}",
    "import('fs')",
    "window",
  ];
  it.each(attacks)("rejects %s", (src) => {
    expect(() => ev(src, { x: 1 })).toThrow(ExpressionError);
  });

  it("does not see prototype properties as variables", () => {
    expect(() => ev("constructor", {})).toThrow(/Unknown variable/);
    expect(() => ev("toString", {})).toThrow(/Unknown variable/);
    expect(() => ev("hasOwnProperty", {})).toThrow(/Unknown variable/);
  });

  it("does not treat a variable as a function, or a function as a variable", () => {
    expect(() => ev("x(2)", { x: 2 })).toThrow(/Unknown function/);
    expect(() => ev("max", { max: 3 })).toThrow(/is a function/);
    expect(() => ev("constructor(1)")).toThrow(/Unknown function/);
  });

  it("leaves the global object untouched", () => {
    expect(() => ev("process")).toThrow();
    expect(typeof process).toBe("object");
  });
});

describe("expression helpers", () => {
  it("lists variables, not functions or constants", () => {
    expect(expressionVariables("max(a, b) * pi + sqrt(c) - a").sort()).toEqual(["a", "b", "c"]);
  });
  it("checks syntax without evaluating", () => {
    expect(() => assertExpressionSyntax("a / 0")).not.toThrow();
    expect(() => assertExpressionSyntax("a /")).toThrow(ExpressionError);
  });
});
