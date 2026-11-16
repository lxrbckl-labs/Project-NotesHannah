/**
 * Text matching for fill-in-the-blank answers.
 *
 * Loose matching (the default) ignores case, spaces and punctuation, so
 * "Beta-blocker", "beta blocker" and "betablocker" are the same. It keeps
 * digits, decimal points between digits, a minus sign in front of a number and
 * "%", so "2.5" and "25" are never confused.
 */

/** Loose form of a string, used for comparing answers. */
export function normaliseLoose(text: string): string {
  let t = text.normalize("NFKC").toLowerCase().replace(/[−‒–]/g, "-");
  // "1,000" -> "1000" (thousands) and "2,5" -> "2.5" (decimal comma).
  t = t.replace(/(?<=\d),(?=\d{3}(?!\d))/g, "").replace(/(?<=\d),(?=\d)/g, ".");
  let out = "";
  for (let i = 0; i < t.length; i++) {
    const c = t.charAt(i);
    const prev = t.charAt(i - 1);
    const next = t.charAt(i + 1);
    if (/[\p{L}\p{N}]/u.test(c) || c === "%") out += c;
    else if (c === "." && /\d/.test(prev) && /\d/.test(next)) out += c;
    else if (c === "-" && /\d/.test(next) && !/[\p{L}\p{N}]/u.test(prev)) out += c;
  }
  return out;
}

/** Strict form: trimmed, inner whitespace collapsed to single spaces, case and punctuation kept. */
export function normaliseStrict(text: string): string {
  return text.normalize("NFKC").trim().replace(/\s+/g, " ");
}

/**
 * Edit distance counting an insertion, deletion, substitution or swap of two
 * neighbouring letters as one step. Stops early once the distance exceeds `limit`.
 */
export function editDistance(a: string, b: string, limit = 2): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  const prev2: number[] = [];
  let prev: number[] = [];
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  let before: number[] = prev2;
  for (let i = 1; i <= a.length; i++) {
    const row: number[] = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      let v = Math.min(
        (prev[j] as number) + 1,
        (row[j - 1] as number) + 1,
        (prev[j - 1] as number) + cost,
      );
      if (
        i > 1 &&
        j > 1 &&
        a.charAt(i - 1) === b.charAt(j - 2) &&
        a.charAt(i - 2) === b.charAt(j - 1)
      ) {
        v = Math.min(v, ((before[j - 2] as number) ?? Number.POSITIVE_INFINITY) + 1);
      }
      row[j] = v;
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > limit) return limit + 1;
    before = prev;
    prev = row;
  }
  return prev[b.length] as number;
}

/** Shortest accepted answer (after loose normalising) that may be given typo tolerance. */
export const TYPO_MIN_LENGTH = 6;

export type BlankMatch = "exact" | "typo" | "none";

export interface BlankRule {
  answers: readonly string[];
  strict?: boolean | undefined;
  allowTypos?: boolean | undefined;
}

/**
 * Compare what she typed with a blank's accepted answers.
 * Typos (edit distance 1) are accepted only when `allowTypos` is on, the
 * blank is not strict, the accepted answer has at least 6 characters, and it
 * contains no digits: a wrong digit is a different dose, never a typo.
 */
export function matchBlank(given: string, rule: BlankRule): { match: BlankMatch; answer?: string } {
  if (rule.strict) {
    const g = normaliseStrict(given);
    for (const answer of rule.answers)
      if (normaliseStrict(answer) === g) return { match: "exact", answer };
    return { match: "none" };
  }
  const g = normaliseLoose(given);
  if (g === "") return { match: "none" };
  for (const answer of rule.answers)
    if (normaliseLoose(answer) === g) return { match: "exact", answer };
  if (rule.allowTypos) {
    for (const answer of rule.answers) {
      const a = normaliseLoose(answer);
      if (a.length >= TYPO_MIN_LENGTH && !/\d/.test(a) && editDistance(g, a, 1) <= 1) {
        return { match: "typo", answer };
      }
    }
  }
  return { match: "none" };
}
