import type { TranscriptFlag } from "@notes/schema";

export interface Segment {
  text: string;
  /** Set for a flagged span. */
  flag?: TranscriptFlag;
  /** True for the passage a citation points at. */
  quoted?: boolean;
}

interface Span {
  start: number;
  end: number;
  flag?: TranscriptFlag;
  quoted?: boolean;
}

/**
 * Find `needle` in `text`. Exact characters first (a citation quote); otherwise ignore case and let
 * runs of whitespace differ (a search term, which the server matches without regard to case).
 */
export function findQuote(text: string, needle: string): [number, number] | null {
  if (!needle) return null;
  const at = text.indexOf(needle);
  if (at >= 0) return [at, at + needle.length];
  const pattern = needle
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  if (!pattern) return null;
  const match = new RegExp(pattern, "i").exec(text);
  return match ? [match.index, match.index + match[0].length] : null;
}

/**
 * Cut a transcript into plain, flagged and quoted pieces. Each flag marks the first place its
 * quote occurs; the highlighted citation quote wins where they overlap.
 */
export function segmentText(
  text: string,
  flags: readonly TranscriptFlag[],
  quote?: string,
): Segment[] {
  const spans: Span[] = [];
  for (const flag of flags) {
    const found = findQuote(text, flag.quote);
    if (found) spans.push({ start: found[0], end: found[1], flag });
  }
  const q = quote ? findQuote(text, quote) : null;
  if (q) spans.push({ start: q[0], end: q[1], quoted: true });

  const cuts = new Set<number>([0, text.length]);
  for (const s of spans) {
    cuts.add(s.start);
    cuts.add(s.end);
  }
  const points = [...cuts].sort((a, b) => a - b);
  const out: Segment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i] as number;
    const end = points[i + 1] as number;
    if (start === end) continue;
    const covering = spans.filter((s) => s.start <= start && s.end >= end);
    const flag = covering.find((s) => s.flag)?.flag;
    const quoted = covering.some((s) => s.quoted);
    out.push({
      text: text.slice(start, end),
      ...(flag ? { flag } : {}),
      ...(quoted ? { quoted } : {}),
    });
  }
  return out;
}

export const FLAG_LABEL: Record<TranscriptFlag["kind"], string> = {
  uncertain: "Not sure",
  illegible: "Hard to read",
  dose: "Dose",
  unit: "Unit",
  decimal: "Decimal",
  drug_name: "Drug name",
};
