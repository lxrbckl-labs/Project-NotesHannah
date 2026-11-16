/**
 * A small, safe arithmetic evaluator for calculation questions.
 *
 * It understands numbers, named variables, `+ - * / ^`, parentheses, and the
 * functions min, max, round, ceil, floor, sqrt, ln, log10, exp (plus the
 * constant `pi`). It is a hand-written parser: nothing is ever passed to
 * `eval` or `Function`, and identifiers are looked up in fixed tables, so
 * names like `constructor`, `__proto__` or `process` are simply "unknown".
 *
 * Precedence, highest first: parentheses and function calls; `^`
 * (right-associative, so `2^3^2` is `2^(3^2)`); unary minus (so `-2^2` is
 * `-4`); `* /`; `+ -`.
 */

export class ExpressionError extends Error {
  constructor(
    message: string,
    readonly position?: number,
  ) {
    super(message);
    this.name = "ExpressionError";
  }
}

export const MAX_EXPRESSION_LENGTH = 300;
const MAX_DEPTH = 40;

export const EXPRESSION_FUNCTION_NAMES = [
  "min",
  "max",
  "round",
  "ceil",
  "floor",
  "sqrt",
  "ln",
  "log10",
  "exp",
] as const;
export const EXPRESSION_CONSTANT_NAMES = ["pi"] as const;

type Node =
  | { t: "num"; v: number }
  | { t: "var"; name: string; pos: number }
  | { t: "const"; v: number }
  | { t: "neg"; x: Node }
  | { t: "bin"; op: "+" | "-" | "*" | "/" | "^"; l: Node; r: Node; pos: number }
  | { t: "call"; name: string; args: Node[]; pos: number };

type Token =
  | { k: "num"; v: number; pos: number }
  | { k: "id"; v: string; pos: number }
  | { k: "op"; v: string; pos: number }
  | { k: "end"; pos: number };

function tokenize(src: string): Token[] {
  if (src.length > MAX_EXPRESSION_LENGTH) {
    throw new ExpressionError(`Expression is longer than ${MAX_EXPRESSION_LENGTH} characters.`);
  }
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src.charAt(i);
    if (c === " " || c === "\t" || c === "\n") {
      i++;
      continue;
    }
    const numberMatch = /^(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
    if (numberMatch) {
      tokens.push({ k: "num", v: Number(numberMatch[0]), pos: i });
      i += numberMatch[0].length;
      continue;
    }
    const idMatch = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (idMatch) {
      tokens.push({ k: "id", v: idMatch[0], pos: i });
      i += idMatch[0].length;
      continue;
    }
    if ("+-*/^(),".includes(c)) {
      tokens.push({ k: "op", v: c, pos: i });
      i++;
      continue;
    }
    if (c === ".") {
      throw new ExpressionError(
        "Property access with '.' is not allowed (a decimal needs digits on both sides, like 0.5).",
        i,
      );
    }
    throw new ExpressionError(`Unexpected character '${c}'.`, i);
  }
  tokens.push({ k: "end", pos: src.length });
  return tokens;
}

class Parser {
  private i = 0;
  private depth = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.i] as Token;
  }
  private next(): Token {
    const t = this.peek();
    this.i++;
    return t;
  }
  private isOp(v: string): boolean {
    const t = this.peek();
    return t.k === "op" && t.v === v;
  }

  parseAll(): Node {
    const node = this.expr();
    const t = this.peek();
    if (t.k !== "end") {
      throw new ExpressionError(`Unexpected '${t.v}'. Did you forget an operator?`, t.pos);
    }
    return node;
  }

  private enter(): void {
    if (++this.depth > MAX_DEPTH) throw new ExpressionError("Expression is nested too deeply.");
  }

  private expr(): Node {
    this.enter();
    let left = this.term();
    while (this.isOp("+") || this.isOp("-")) {
      const op = this.next() as Token & { k: "op" };
      const right = this.term();
      left = { t: "bin", op: op.v as "+" | "-", l: left, r: right, pos: op.pos };
    }
    this.depth--;
    return left;
  }

  private term(): Node {
    let left = this.unary();
    while (this.isOp("*") || this.isOp("/")) {
      const op = this.next() as Token & { k: "op" };
      const right = this.unary();
      left = { t: "bin", op: op.v as "*" | "/", l: left, r: right, pos: op.pos };
    }
    return left;
  }

  private unary(): Node {
    if (this.isOp("-")) {
      this.next();
      this.enter();
      const x = this.unary();
      this.depth--;
      return { t: "neg", x };
    }
    if (this.isOp("+")) {
      this.next();
      return this.unary();
    }
    return this.power();
  }

  private power(): Node {
    const base = this.primary();
    if (this.isOp("^")) {
      const op = this.next() as Token & { k: "op" };
      this.enter();
      const exponent = this.unary();
      this.depth--;
      return { t: "bin", op: "^", l: base, r: exponent, pos: op.pos };
    }
    return base;
  }

  private primary(): Node {
    const t = this.next();
    if (t.k === "num") return { t: "num", v: t.v };
    if (t.k === "id") {
      if (this.isOp("(")) {
        if (!FUNCTIONS.has(t.v)) {
          throw new ExpressionError(
            `Unknown function '${t.v}'. Allowed functions: ${EXPRESSION_FUNCTION_NAMES.join(", ")}.`,
            t.pos,
          );
        }
        this.next();
        const args: Node[] = [];
        if (!this.isOp(")")) {
          args.push(this.expr());
          while (this.isOp(",")) {
            this.next();
            args.push(this.expr());
          }
        }
        if (!this.isOp(")")) throw new ExpressionError("Missing closing ')'.", this.peek().pos);
        this.next();
        return { t: "call", name: t.v, args, pos: t.pos };
      }
      if (FUNCTIONS.has(t.v)) {
        throw new ExpressionError(
          `'${t.v}' is a function; write it with brackets, like ${t.v}(...).`,
          t.pos,
        );
      }
      const constant = CONSTANTS.get(t.v);
      if (constant !== undefined) return { t: "const", v: constant };
      return { t: "var", name: t.v, pos: t.pos };
    }
    if (t.k === "op" && t.v === "(") {
      const inner = this.expr();
      if (!this.isOp(")")) throw new ExpressionError("Missing closing ')'.", this.peek().pos);
      this.next();
      return inner;
    }
    if (t.k === "end") throw new ExpressionError("Expression ends too early.", t.pos);
    throw new ExpressionError(`Unexpected '${t.v}'.`, t.pos);
  }
}

function roundHalfUp(x: number, places: number): number {
  const f = 10 ** places;
  return (Math.sign(x) * Math.round(Math.abs(x) * f * (1 + 1e-12))) / f;
}

const FUNCTIONS = new Map<string, { min: number; max: number; fn: (a: number[]) => number }>([
  ["min", { min: 1, max: 50, fn: (a) => Math.min(...a) }],
  ["max", { min: 1, max: 50, fn: (a) => Math.max(...a) }],
  [
    "round",
    {
      min: 1,
      max: 2,
      fn: (a) => {
        const places = a[1] ?? 0;
        if (!Number.isInteger(places) || places < 0 || places > 12) {
          throw new ExpressionError(
            "round(x, places): places must be a whole number from 0 to 12.",
          );
        }
        return roundHalfUp(a[0] as number, places);
      },
    },
  ],
  ["ceil", { min: 1, max: 1, fn: (a) => Math.ceil(a[0] as number) }],
  ["floor", { min: 1, max: 1, fn: (a) => Math.floor(a[0] as number) }],
  [
    "sqrt",
    {
      min: 1,
      max: 1,
      fn: (a) => {
        if ((a[0] as number) < 0) throw new ExpressionError("sqrt of a negative number.");
        return Math.sqrt(a[0] as number);
      },
    },
  ],
  [
    "ln",
    {
      min: 1,
      max: 1,
      fn: (a) => {
        if ((a[0] as number) <= 0) throw new ExpressionError("ln of zero or a negative number.");
        return Math.log(a[0] as number);
      },
    },
  ],
  [
    "log10",
    {
      min: 1,
      max: 1,
      fn: (a) => {
        if ((a[0] as number) <= 0) throw new ExpressionError("log10 of zero or a negative number.");
        return Math.log10(a[0] as number);
      },
    },
  ],
  ["exp", { min: 1, max: 1, fn: (a) => Math.exp(a[0] as number) }],
]);

const CONSTANTS = new Map<string, number>([["pi", Math.PI]]);

function finite(x: number, what: string): number {
  if (!Number.isFinite(x)) throw new ExpressionError(`${what} is not a finite number.`);
  return x;
}

function run(node: Node, vars: Readonly<Record<string, number>>): number {
  switch (node.t) {
    case "num":
    case "const":
      return node.v;
    case "var": {
      if (!Object.hasOwn(vars, node.name)) {
        throw new ExpressionError(`Unknown variable '${node.name}'.`, node.pos);
      }
      return finite(vars[node.name] as number, `Variable '${node.name}'`);
    }
    case "neg":
      return -run(node.x, vars);
    case "call": {
      const spec = FUNCTIONS.get(node.name) as NonNullable<ReturnType<typeof FUNCTIONS.get>>;
      if (node.args.length < spec.min || node.args.length > spec.max) {
        throw new ExpressionError(
          `${node.name}() takes ${spec.min === spec.max ? spec.min : `${spec.min} to ${spec.max}`} argument(s), got ${node.args.length}.`,
          node.pos,
        );
      }
      return finite(spec.fn(node.args.map((a) => run(a, vars))), `${node.name}()`);
    }
    case "bin": {
      const l = run(node.l, vars);
      const r = run(node.r, vars);
      switch (node.op) {
        case "+":
          return finite(l + r, "A sum");
        case "-":
          return finite(l - r, "A difference");
        case "*":
          return finite(l * r, "A product");
        case "/":
          if (r === 0) throw new ExpressionError("Division by zero.", node.pos);
          return finite(l / r, "A quotient");
        case "^":
          return finite(l ** r, "A power");
      }
    }
  }
}

/** Check that an expression is well formed, throwing ExpressionError with a position if not. */
export function assertExpressionSyntax(src: string): void {
  new Parser(tokenize(src)).parseAll();
}

/** The variable names an expression refers to (functions and constants excluded). */
export function expressionVariables(src: string): string[] {
  const out = new Set<string>();
  const walk = (n: Node): void => {
    if (n.t === "var") out.add(n.name);
    else if (n.t === "neg") walk(n.x);
    else if (n.t === "bin") {
      walk(n.l);
      walk(n.r);
    } else if (n.t === "call") n.args.forEach(walk);
  };
  walk(new Parser(tokenize(src)).parseAll());
  return [...out];
}

/**
 * Evaluate an expression with the given variables. Throws ExpressionError for
 * anything unsafe or undefined: unknown names, division by zero, a result that
 * is not a finite number.
 */
export function evaluateExpression(
  src: string,
  vars: Readonly<Record<string, number>> = {},
): number {
  const node = new Parser(tokenize(src)).parseAll();
  return finite(run(node, vars), "The result");
}
