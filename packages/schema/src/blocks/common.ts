import { z } from "zod";
import { CITATION_LIMITS, citationList, NormalizedBox } from "../citations.js";
import { Actor, Timestamp } from "../common.js";
import { FileId, PageId } from "../ids.js";
import { ReviewStatus } from "../sources.js";
import { normalizeRichText, type RichText, richText } from "./rich-text.js";

/**
 * Whose words a block holds, which decides what an agent may overwrite (D11).
 * - "agent": written by an agent and not changed by her since.
 * - "user": she wrote it, or she changed its content or style. Sticky: once
 *   "user", a block only becomes "agent" again when an agent rewrites it at
 *   her explicit request (see `canAgentOverwrite`).
 */
export const Origin = z.enum(["agent", "user"]);
export type Origin = z.infer<typeof Origin>;

/**
 * Something on a block the reader should check (D10). Doses, units and
 * decimals are always flagged by the writer, because a wrong dose matters.
 */
export const BlockFlag = z
  .strictObject({
    kind: z.enum([
      "uncertain",
      "illegible",
      "dose",
      "unit",
      "decimal",
      "drug_name",
      "source_conflict",
    ]),
    /** The exact words in the block this flag is about. */
    quote: z.string().min(1).max(300).optional(),
    /** Why it needs checking, in plain language. */
    note: z.string().min(1).max(300).optional(),
  })
  .meta({ id: "BlockFlag" });
export type BlockFlag = z.infer<typeof BlockFlag>;

export const FLAG_LIMITS = { maxPerBlock: 20, maxPerField: 5 } as const;

/** Who made and last changed a block, and when. Server-assigned. */
export const Provenance = z.object({
  createdBy: Actor,
  createdAt: Timestamp,
  lastEditedBy: Actor,
  lastEditedAt: Timestamp,
});
export type Provenance = z.infer<typeof Provenance>;

/** Review state (D10). Generated blocks start unverified; she marks them reviewed. */
export const BlockReview = z.object({
  status: ReviewStatus,
  reviewedAt: Timestamp.nullable(),
});
export type BlockReview = z.infer<typeof BlockReview>;

/** Size limits for clinical fields. */
export const CITED_TEXT_MAX_CHARS = 2000;

const CitedTextObject = z.strictObject({
  text: richText(CITED_TEXT_MAX_CHARS),
  citations: citationList(CITATION_LIMITS.maxPerField),
  flags: z.array(BlockFlag).max(FLAG_LIMITS.maxPerField).default([]),
  /** True when this line is not from her notes; shown as "not from your notes". */
  generalKnowledge: z.boolean().optional(),
});

/** A citable, flaggable piece of text after normalisation. */
export interface CitedText {
  text: RichText;
  citations: z.output<typeof CitedTextObject>["citations"];
  flags: BlockFlag[];
  generalKnowledge?: boolean | undefined;
}

/**
 * A field that can carry its own citations and flags, such as one adverse
 * effect on a drug card. Writers may send a plain string when the field
 * needs no citation of its own (the block's citations cover it).
 */
export const CitedText = z
  .union([z.string().max(CITED_TEXT_MAX_CHARS), CitedTextObject], {
    error: 'A cited field is a string, or {"text": "...", "citations": [...], "flags": [...]}.',
  })
  .transform(
    (value): CitedText =>
      typeof value === "string"
        ? { text: normalizeRichText(value), citations: [], flags: [] }
        : value,
  )
  .refine((value) => !(value.generalKnowledge && value.citations.length > 0), {
    error:
      "generalKnowledge: true says this field is not from her notes, so it cannot also cite her notes. Remove one of them.",
  });

/** A list of cited fields, such as a drug card's adverse effects. */
export function citedList(max: number) {
  return z
    .array(CitedText)
    .max(max, { error: `At most ${max} entries here.` })
    .default([]);
}

/**
 * An uploaded page (or part of one) shown as an image. Every upload, photos
 * included, is split into pages, so a page is always the unit. `pageId` may
 * be left out for a single-page upload such as a photo.
 */
export const ImageSource = z.strictObject({
  fileId: FileId,
  pageId: PageId.optional(),
  /** Crop to this part of the page. */
  region: NormalizedBox.optional(),
});
export type ImageSource = z.infer<typeof ImageSource>;
