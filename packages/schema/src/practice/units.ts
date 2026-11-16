/**
 * The fixed, safe table of units a calculation answer can use, and conversion
 * between them.
 *
 * A unit is one or more base tokens joined by "/": `mg`, `mL/hr`, `mg/kg`,
 * `mcg/kg/min`. Each token has a kind (mass, volume, time, ...) and a factor to
 * the base of that kind (mass: mcg, volume: mL, time: minute). Two units are
 * convertible when they have the same kinds above and below the line. The
 * kinds are NOT cancelled, so `mg/kg` (dose per body weight) is never confused
 * with `mL/L`. All matching is case-insensitive; "ug", "μg" (Greek mu) and
 * "µg" (micro sign) all mean mcg.
 */

type Kind = "mass" | "volume" | "time" | "units" | "mEq" | "drops" | "tablets";

interface Token {
  /** Canonical spelling shown to people. */
  symbol: string;
  kind: Kind;
  /** How many base units one of these is. */
  factor: number;
  /** Lower-case spellings that are accepted. */
  aliases: string[];
}

const TOKENS: Token[] = [
  {
    symbol: "mcg",
    kind: "mass",
    factor: 1,
    aliases: ["mcg", "ug", "μg", "µg", "microgram", "micrograms"],
  },
  { symbol: "mg", kind: "mass", factor: 1e3, aliases: ["mg", "milligram", "milligrams"] },
  { symbol: "g", kind: "mass", factor: 1e6, aliases: ["g", "gm", "gram", "grams"] },
  { symbol: "kg", kind: "mass", factor: 1e9, aliases: ["kg", "kilogram", "kilograms"] },
  {
    symbol: "mL",
    kind: "volume",
    factor: 1,
    aliases: ["ml", "milliliter", "milliliters", "millilitre", "millilitres"],
  },
  {
    symbol: "dL",
    kind: "volume",
    factor: 100,
    aliases: ["dl", "deciliter", "deciliters", "decilitre", "decilitres"],
  },
  {
    symbol: "L",
    kind: "volume",
    factor: 1000,
    aliases: ["l", "liter", "liters", "litre", "litres"],
  },
  { symbol: "min", kind: "time", factor: 1, aliases: ["min", "mins", "minute", "minutes"] },
  { symbol: "hr", kind: "time", factor: 60, aliases: ["hr", "hrs", "h", "hour", "hours"] },
  { symbol: "day", kind: "time", factor: 1440, aliases: ["day", "days"] },
  { symbol: "units", kind: "units", factor: 1, aliases: ["unit", "units"] },
  {
    symbol: "mEq",
    kind: "mEq",
    factor: 1,
    aliases: ["meq", "milliequivalent", "milliequivalents"],
  },
  { symbol: "gtt", kind: "drops", factor: 1, aliases: ["gtt", "gtts", "drop", "drops"] },
  { symbol: "tablet", kind: "tablets", factor: 1, aliases: ["tab", "tabs", "tablet", "tablets"] },
];

const BY_ALIAS = new Map<string, Token>();
for (const token of TOKENS) for (const alias of token.aliases) BY_ALIAS.set(alias, token);

const KIND_WORD: Record<Kind, string> = {
  mass: "a mass",
  volume: "a volume",
  time: "a time",
  units: "units",
  mEq: "mEq",
  drops: "drops",
  tablets: "tablets",
};

/** A parsed unit, ready to compare and convert. */
export interface ParsedUnit {
  /** Canonical spelling, e.g. "mcg/kg/min". */
  canonical: string;
  /** Kinds above the line, sorted. */
  num: Kind[];
  /** Kinds below the line, sorted. */
  den: Kind[];
  /** How many base units one of this unit is. */
  factor: number;
}

/** Spellings that can be used in the `units` field of a calculation question. */
export const SUPPORTED_UNIT_SYMBOLS = TOKENS.map((t) => t.symbol);

/** A short list of accepted spellings, for error messages. */
export const SUPPORTED_UNITS_HELP =
  "Supported base units: mcg (ug), mg, g, kg; mL, dL, L; min, hr, day; units; mEq; gtt; tablet. " +
  "Combine them with '/', for example mg/kg, mL/hr, mcg/kg/min, mg/dL.";

/**
 * Parse a unit string such as "mg", "ML/hr", "mcg per kg per min". Returns
 * null if any part is not in the table.
 */
export function parseUnit(text: string): ParsedUnit | null {
  const cleaned = text
    .normalize("NFC")
    .trim()
    .toLowerCase()
    .replace(/\.+$/, "")
    .replace(/\s+per\s+/g, "/")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ");
  if (cleaned === "" || cleaned.length > 40) return null;
  const parts = cleaned.split("/");
  if (parts.length > 3) return null;
  const tokens: Token[] = [];
  for (const part of parts) {
    const token = BY_ALIAS.get(part);
    if (!token) return null;
    tokens.push(token);
  }
  const [first, ...rest] = tokens as [Token, ...Token[]];
  const factor = rest.reduce((f, t) => f / t.factor, first.factor);
  return {
    canonical: tokens.map((t) => t.symbol).join("/"),
    num: [first.kind],
    den: rest.map((t) => t.kind).sort(),
    factor,
  };
}

/** True if a value in one unit can be converted to the other. */
export function sameDimension(a: ParsedUnit, b: ParsedUnit): boolean {
  return a.num.join() === b.num.join() && a.den.join() === b.den.join();
}

/** True if the two spellings mean exactly the same size of unit (mcg and ug; not mg and g). */
export function equivalentUnits(a: ParsedUnit, b: ParsedUnit): boolean {
  return sameDimension(a, b) && Math.abs(a.factor / b.factor - 1) < 1e-9;
}

/** Convert a value; returns null if the units measure different things. */
export function convertValue(value: number, from: ParsedUnit, to: ParsedUnit): number | null {
  if (!sameDimension(from, to)) return null;
  return (value * from.factor) / to.factor;
}

/** What a unit measures, in plain words, e.g. "a mass" or "a mass per time". */
export function describeUnitKind(unit: ParsedUnit): string {
  const top = KIND_WORD[unit.num[0] as Kind];
  if (unit.den.length === 0) return top;
  return `${top} per ${unit.den.map((k) => KIND_WORD[k].replace(/^an? /, "")).join(" per ")}`;
}
