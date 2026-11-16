import type { Inline } from "@notes/schema";

/** Plain text of a rich-text value (for labels and request messages). */
export function plainText(text: Inline[]): string {
  return text
    .map((item) => ("text" in item ? item.text : ""))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

export function pluralise(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** First letter for alphabetical grouping; digits and symbols go under "#". */
export function letterOf(name: string): string {
  const first = name.trim().charAt(0).toUpperCase();
  return /[A-Z]/.test(first) ? first : "#";
}
