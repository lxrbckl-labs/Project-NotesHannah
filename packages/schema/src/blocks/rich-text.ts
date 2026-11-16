import { z } from "zod";
import { ConceptId } from "../ids.js";
import { ColorToken } from "./tokens.js";

/**
 * Rich text is the text inside blocks, stored editor-neutral: a flat list of
 * inline items. Writers may send a plain string instead; it is normalised to
 * a single text run on parse.
 *
 *   "Beta blockers end in -olol"
 *   [{ "text": "Atenolol", "bold": true }, { "text": " is cardioselective " }, { "cite": 1 }]
 *
 * Three kinds of inline item, told apart by their keys:
 * - text run: `text` plus optional marks (bold, italic, underline, strike,
 *   code, highlight colour token, link);
 * - citation marker: `{ "cite": n }`, the n-th (1-based) citation of the
 *   nearest citation list: the field's own list when the field has
 *   citations, otherwise the block's `citations`;
 * - concept mention: `{ "concept": "con_…", "text": "metoprolol" }`.
 *
 * A newline inside a run is a line break.
 */
export const RICH_TEXT_LIMITS = {
  /** Most inline items in one piece of rich text. */
  maxInlines: 400,
  /** Longest single text run. */
  maxRunChars: 5000,
  /** Highest citation marker number (equals the most citations a block may carry). */
  maxCiteNumber: 20,
} as const;

export const TextRun = z.strictObject({
  text: z
    .string()
    .min(1, { error: "A text run needs at least one character; leave empty runs out." })
    .max(RICH_TEXT_LIMITS.maxRunChars),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strike: z.boolean().optional(),
  code: z.boolean().optional(),
  /** Highlighter colour, a token from the palette. */
  highlight: ColorToken.optional(),
  /** An http or https URL. */
  link: z
    .url({ protocol: /^https?$/, error: "Links must be http or https URLs." })
    .max(2000)
    .optional(),
});
export type TextRun = z.infer<typeof TextRun>;

export const CitationMarker = z.strictObject({
  cite: z.number().int().min(1).max(RICH_TEXT_LIMITS.maxCiteNumber),
});
export type CitationMarker = z.infer<typeof CitationMarker>;

export const ConceptMention = z.strictObject({
  concept: ConceptId,
  /** The words shown in the text, e.g. "metoprolol". */
  text: z.string().min(1).max(200),
});
export type ConceptMention = z.infer<typeof ConceptMention>;

const INLINE_HELP =
  'Each inline item is a text run {"text": "...", "bold": true}, a citation marker {"cite": 1}, or a concept mention {"concept": "con_01J9Z8Y7X6W5V4T3S2R1Q0P9N8", "text": "atenolol"}.';

export const Inline = z
  .union([TextRun, CitationMarker, ConceptMention], { error: INLINE_HELP })
  .meta({
    id: "Inline",
  });
export type Inline = z.infer<typeof Inline>;

/** Rich text after normalisation: always a list of inline items. */
export type RichText = Inline[];

const MARK_KEYS = ["bold", "italic", "underline", "strike", "code"] as const;

function isRun(item: Inline): item is TextRun {
  return "text" in item && !("concept" in item);
}

function sameMarks(a: TextRun, b: TextRun): boolean {
  return (
    MARK_KEYS.every((key) => Boolean(a[key]) === Boolean(b[key])) &&
    a.highlight === b.highlight &&
    a.link === b.link
  );
}

/** Drop marks set to false, so equal text always serialises the same way. */
function canonicalRun(run: TextRun): TextRun {
  const out: TextRun = { text: run.text };
  for (const key of MARK_KEYS) if (run[key]) out[key] = true;
  if (run.highlight) out.highlight = run.highlight;
  if (run.link) out.link = run.link;
  return out;
}

/** Turn a string or inline list into the canonical inline list: marks tidied, neighbours with equal marks merged. */
export function normalizeRichText(value: string | readonly Inline[]): RichText {
  if (typeof value === "string") return value === "" ? [] : [{ text: value }];
  const out: Inline[] = [];
  for (const item of value) {
    if (!isRun(item)) {
      out.push(item);
      continue;
    }
    const run = canonicalRun(item);
    const last = out[out.length - 1];
    if (last && isRun(last) && sameMarks(last, run)) {
      out[out.length - 1] = { ...last, text: last.text + run.text };
    } else {
      out.push(run);
    }
  }
  return out;
}

/** The readable text of rich text: runs and mentions, without citation markers. */
export function richTextToPlain(value: string | readonly Inline[]): string {
  if (typeof value === "string") return value;
  let out = "";
  for (const item of value) if ("text" in item) out += item.text;
  return out;
}

/** Citation marker numbers used in rich text, in order. */
export function citationMarkers(value: readonly Inline[]): number[] {
  const out: number[] = [];
  for (const item of value) if ("cite" in item) out.push(item.cite);
  return out;
}

const cache = new Map<number, ReturnType<typeof build>>();

function build(maxChars: number) {
  return z
    .union([z.string().max(maxChars), z.array(Inline).max(RICH_TEXT_LIMITS.maxInlines)], {
      error: `Rich text is a plain string, or a list of inline items. ${INLINE_HELP}`,
    })
    .meta({
      description: `Rich text, at most ${maxChars} characters: a plain string, or a list of inline items (text runs with marks, {"cite": n} markers, concept mentions).`,
    })
    .transform(normalizeRichText)
    .refine((inlines) => richTextToPlain(inlines).length <= maxChars, {
      error: `Too long: rich text here holds at most ${maxChars} characters.`,
    });
}

/**
 * Rich text field holding at most `maxChars` characters of readable text.
 * Instances are shared per limit, so JSON Schema export can reference them.
 */
export function richText(maxChars: number) {
  let schema = cache.get(maxChars);
  if (!schema) {
    schema = build(maxChars);
    cache.set(maxChars, schema);
  }
  return schema;
}
