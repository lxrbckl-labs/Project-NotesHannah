import {
  type Block,
  type BlockFlag,
  type Citation,
  type CitedText,
  citationKey,
  findQuote,
  listReferences,
  type Reference,
} from "@notes/schema";

/**
 * Document-wide citation numbering (K2, K7). Chips show the reference number
 * from `listReferences`: the same passage keeps one number wherever it is
 * cited, numbered in order of first appearance.
 */
export interface ReferenceIndex {
  references: Reference[];
  /** The reference number of a citation, or 0 if it is not in the document. */
  numberOf(citation: Citation): number;
  /** The reference with this number. */
  byNumber(number: number): Reference | undefined;
}

export function buildReferenceIndex(blocks: readonly Block[]): ReferenceIndex {
  const references = listReferences(blocks);
  const byKey = new Map(references.map((ref) => [citationKey(ref.citation), ref]));
  return {
    references,
    numberOf: (citation) => byKey.get(citationKey(citation))?.number ?? 0,
    byNumber: (number) => references[number - 1],
  };
}

/**
 * The citation a `{ cite: n }` marker points at: the field's own list when the
 * field has citations, otherwise the block's.
 */
export function markerCitation(
  block: Pick<Block, "citations">,
  field: Pick<CitedText, "citations"> | undefined,
  n: number,
): Citation | undefined {
  const list = field && field.citations.length > 0 ? field.citations : block.citations;
  return list[n - 1];
}

// ---------------------------------------------------------------------------
// Highlighting the quoted passage in a transcript (K2).
// ---------------------------------------------------------------------------

export interface QuoteRange {
  start: number;
  end: number;
  /** True when found only after treating runs of whitespace as one space. */
  loose: boolean;
}

/**
 * Where a quote sits in transcript text. Exact first (as servers check with
 * `findQuote`); then whitespace-normalised, since a transcript may wrap a line
 * where the quote has a space.
 */
export function locateQuote(text: string, quote: string): QuoteRange | null {
  const exact = findQuote(text, quote);
  if (exact >= 0) return { start: exact, end: exact + quote.length, loose: false };
  const wanted = quote.trim().replace(/\s+/g, " ");
  if (!wanted) return null;
  // Build a normalised copy of text with a map back to original indices.
  let normalised = "";
  const map: number[] = [];
  let inSpace = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (/\s/.test(ch)) {
      if (!inSpace) {
        normalised += " ";
        map.push(i);
      }
      inSpace = true;
    } else {
      normalised += ch;
      map.push(i);
      inSpace = false;
    }
  }
  const at = normalised.indexOf(wanted);
  if (at < 0) return null;
  const start = map[at] as number;
  const end = (map[at + wanted.length - 1] as number) + 1;
  return { start, end, loose: true };
}

export interface TranscriptSegment {
  text: string;
  highlight: boolean;
}

/** Transcript text cut into plain and highlighted pieces. */
export function segmentTranscript(text: string, quote: string | null): TranscriptSegment[] {
  const range = quote ? locateQuote(text, quote) : null;
  if (!range) return text ? [{ text, highlight: false }] : [];
  const out: TranscriptSegment[] = [];
  if (range.start > 0) out.push({ text: text.slice(0, range.start), highlight: false });
  out.push({ text: text.slice(range.start, range.end), highlight: true });
  if (range.end < text.length) out.push({ text: text.slice(range.end), highlight: false });
  return out;
}

// ---------------------------------------------------------------------------
// Flags shown on the words they are about (D10).
// ---------------------------------------------------------------------------

export interface FlagRange {
  start: number;
  end: number;
  flag: BlockFlag;
  /** Position of the flag in its list, for stable keys and test IDs. */
  index: number;
}

/** Ranges of flagged words in a piece of plain text. Flags whose quote is absent are left out. */
export function flagRanges(plain: string, flags: readonly BlockFlag[]): FlagRange[] {
  const ranges: FlagRange[] = [];
  flags.forEach((flag, index) => {
    if (!flag.quote) return;
    const at = plain.indexOf(flag.quote);
    if (at < 0) return;
    const range = { start: at, end: at + flag.quote.length, flag, index };
    if (ranges.some((r) => r.start < range.end && range.start < r.end)) return;
    ranges.push(range);
  });
  return ranges.sort((a, b) => a.start - b.start);
}

/** Flags of a block that no text part shows inline (no quote, or quote not found). */
export function looseFlags(
  flags: readonly BlockFlag[],
  plainParts: readonly string[],
): BlockFlag[] {
  return flags.filter(
    (flag) => !flag.quote || !plainParts.some((p) => p.includes(flag.quote as string)),
  );
}

export const FLAG_LABELS: Record<BlockFlag["kind"], string> = {
  uncertain: "Uncertain",
  illegible: "Hard to read",
  dose: "Check the dose",
  unit: "Check the unit",
  decimal: "Check the decimal",
  drug_name: "Check the drug name",
  source_conflict: "Sources disagree",
};
