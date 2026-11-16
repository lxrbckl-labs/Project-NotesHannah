/**
 * Numbers with units: the doses, lab values and decimals she relies on. One recognizer for the
 * transcript flag rule (`save_transcript` refuses unflagged ones) and for the request reply check
 * (`complete` warns about figures its sources do not contain).
 */

/** Numbers that must be flagged in a transcript: decimals, and numbers with a dose or lab unit. */
export const MUST_FLAG =
  /\b\d+(?:[.,]\d+)?\s?(?:mg\/kg|mcg|µg|mg|g|kg|mL|ml|L|units?|IU|mEq|mmol|mL\/min|%)(?![A-Za-z])|\b\d+\.\d+\b/g;

const NUMBER = String.raw`\d+(?:[.,]\d+)?`;
const UNIT = String.raw`(?:mg\/kg|mcg|µg|μg|mg|g|kg|mL\/min|mL|ml|L|units?|IU|mEq|mmol|%)(?![A-Za-z])`;
/** "50-200 mg", "50 – 200 mg", "50 to 200 mg", "50 mg to 200 mg". */
const RANGE = new RegExp(
  String.raw`(?<![\d.])(${NUMBER})\s?(?:${UNIT})?\s?(?:-|–|—|to)\s?(${NUMBER})\s?(${UNIT})`,
  "giu",
);

/** One figure as written, and the normalized keys that say whether another text has it. */
export interface Figure {
  /** As it appears in the text, e.g. "50-100 mg". */
  text: string;
  /** Normalized: "50|mg" for a value, ["50|mg", "100|mg"] for a range's two ends. */
  keys: string[];
  range: boolean;
}

function unitKey(unit: string): string {
  const u = unit.toLowerCase().replace(/[µμ]g/, "mcg");
  return u === "units" ? "unit" : u;
}
const numberKey = (n: string): string => n.replace(",", ".");
const keyOf = (n: string, unit: string): string => `${numberKey(n)}|${unitKey(unit)}`;

/**
 * Every figure in a text: ranges (kept whole, with their two ends), then single numbers with a
 * unit and plain decimals.
 */
export function figuresIn(text: string): Figure[] {
  const figures: Figure[] = [];
  const rest = text.replace(RANGE, (whole, lo: string, hi: string, unit: string) => {
    figures.push({
      text: whole.replace(/\s+/g, " ").trim(),
      keys: [keyOf(lo, unit), keyOf(hi, unit)],
      range: true,
    });
    return " ";
  });
  for (const match of rest.matchAll(MUST_FLAG)) {
    const token = match[0].replace(/\s+/g, " ").trim();
    const parts = /^(\d+(?:[.,]\d+)?)\s?(.*)$/.exec(token);
    figures.push({
      text: token,
      keys: [parts?.[2] ? keyOf(parts[1] as string, parts[2]) : numberKey(token)],
      range: false,
    });
  }
  return figures;
}

/**
 * The figures of `text` that none of `sources` contains. A single value is found when a source has
 * the same number with the same unit (also as one end of a range); a range when both its ends are
 * found. Whitespace, case, "µg" for "mcg" and a decimal comma do not matter. Conservative on
 * purpose: it looks only at numbers with units, ranges and decimals, so ordinary words and bare
 * integers never trip it.
 */
export function figuresNotIn(text: string, sources: readonly string[]): string[] {
  const known = new Set<string>();
  for (const source of sources) {
    for (const figure of figuresIn(source)) for (const key of figure.keys) known.add(key);
    // a plain decimal also counts when it is the number of a figure with a unit
    for (const match of source.matchAll(/\d+(?:[.,]\d+)?/g)) known.add(numberKey(match[0]));
  }
  const missing: string[] = [];
  for (const figure of figuresIn(text)) {
    const found = figure.keys.every((key) => known.has(key));
    if (!found && !missing.includes(figure.text)) missing.push(figure.text);
  }
  return missing;
}
