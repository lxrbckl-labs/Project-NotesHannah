import { z } from "zod";
import { BlockId, DocumentId, FileId, NodeId, PageId, QuestionId, TranscriptId } from "./ids.js";

/**
 * Citations say where generated material came from (features K1 to K7).
 *
 * A citation names a source page and the exact passage quoted from its
 * transcript, plus a region on the page image when one is known. It is
 * stored as written and never rewritten when the source changes: if the file
 * is trashed the citation stays, and the reader is told the source is
 * unavailable (see `CitationStatus`).
 */

export const CITATION_LIMITS = {
  /** Longest quoted passage. Quote the sentence that supports the claim, not the page. */
  maxQuoteChars: 1000,
  maxLabelChars: 40,
  /** Most citations on one block. */
  maxPerBlock: 20,
  /** Most citations on one field (a drug card line, a comparison cell). */
  maxPerField: 5,
} as const;

/**
 * A box on a page image, in fractions of the page size: 0,0 is the top-left
 * corner and 1,1 the bottom-right. Resolution-independent, so it survives
 * re-rendering the page at another size.
 */
export const NormalizedBox = z
  .strictObject({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().gt(0).max(1),
    height: z.number().gt(0).max(1),
  })
  .refine((box) => box.x + box.width <= 1.000001 && box.y + box.height <= 1.000001, {
    error: "The box must stay on the page: x + width and y + height are each at most 1.",
  })
  .meta({ id: "NormalizedBox" });
export type NormalizedBox = z.infer<typeof NormalizedBox>;

export const Citation = z
  .strictObject({
    fileId: FileId,
    pageId: PageId,
    /** The supporting passage, copied character for character from the page's transcript. */
    quote: z
      .string()
      .min(1, { error: "Quote the passage from the transcript that supports the claim." })
      .max(CITATION_LIMITS.maxQuoteChars, {
        error: `Quotes are at most ${CITATION_LIMITS.maxQuoteChars} characters: quote the supporting sentence, not the whole page.`,
      }),
    /** The transcript the quote was taken from. */
    transcriptId: TranscriptId.optional(),
    /** Which revision of that transcript; quotes are checked against it. */
    transcriptRevision: z.number().int().min(1).optional(),
    /** Where on the page image, when known. Best effort on handwriting. */
    region: NormalizedBox.optional(),
    /** Short chip label, e.g. "Slide 12". Shown instead of the page number when set. */
    label: z.string().min(1).max(CITATION_LIMITS.maxLabelChars).optional(),
  })
  .refine((c) => c.transcriptRevision === undefined || c.transcriptId !== undefined, {
    error: "transcriptRevision needs transcriptId: say which transcript the revision belongs to.",
    path: ["transcriptRevision"],
  })
  .meta({ id: "Citation" });
export type Citation = z.infer<typeof Citation>;

/** A list of citations on a block or a field. */
export function citationList(max: number) {
  return z
    .array(Citation)
    .max(max, { error: `At most ${max} citations here.` })
    .default([]);
}

/**
 * Whether a cited source can still be opened, worked out when the citation
 * is read (never stored), so trashing a file does not rewrite any block.
 * - available: open the page with the passage highlighted.
 * - source_trashed: the file is in the trash; the chip says so and offers restore.
 * - source_deleted: the file was permanently deleted; the quote is all that remains.
 */
export const CitationStatus = z.enum(["available", "source_trashed", "source_deleted"]);
export type CitationStatus = z.infer<typeof CitationStatus>;

/** A citation as shown to a reader: numbered in its document and with its source's state. */
export const ResolvedCitation = z.object({
  citation: Citation,
  /** Chip number, shared by every use of the same source passage in the document. */
  number: z.number().int().min(1),
  status: CitationStatus,
  /** Original name of the cited file, for the chip tooltip; null once deleted. */
  fileName: z.string().nullable(),
  /** 1-based page number in the file; null once deleted. */
  pageIndex: z.number().int().min(1).nullable(),
});
export type ResolvedCitation = z.infer<typeof ResolvedCitation>;

/**
 * Where a citation sits: a block (and, for citable fields, which field) or
 * a practice question. `field` is a JSON path inside the block such as
 * "$.content.dosingNotes[0]", or null for the block's own `citations`.
 */
export const CitingLocation = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("block"),
    documentId: DocumentId,
    blockId: BlockId,
    field: z.string().max(200).nullable(),
  }),
  z.object({ kind: z.literal("question"), questionId: QuestionId }),
]);
export type CitingLocation = z.infer<typeof CitingLocation>;

/** One entry in the reverse view of a source page (K5): something that cites it. */
export const CitationBacklink = z.object({
  location: CitingLocation,
  /** Title of the citing document or the question's stem, for the list. */
  title: z.string(),
  /** The library node the citing item lives in, to open it. */
  nodeId: NodeId.nullable(),
  /** e.g. "drug_card", "paragraph", or "question". */
  itemType: z.string(),
  quote: z.string(),
  region: NormalizedBox.optional(),
  /** True when the citing document or question is itself in the trash. */
  trashed: z.boolean(),
});
export type CitationBacklink = z.infer<typeof CitationBacklink>;

/** Response of "what cites this page" (K5). */
export const PageBacklinks = z.object({
  pageId: PageId,
  fileId: FileId,
  items: z.array(CitationBacklink),
});
export type PageBacklinks = z.infer<typeof PageBacklinks>;

/**
 * Identity of a cited passage, used to de-duplicate the references list:
 * the same quote from the same page is one reference however often it is cited.
 */
export function citationKey(citation: Citation): string {
  return `${citation.fileId}|${citation.pageId}|${citation.quote}`;
}

/**
 * Where a quote occurs in transcript text, or -1. Matching is exact: the
 * quote must be copied character for character, which is what lets the
 * reader highlight it. Servers use this to reject invented quotes.
 */
export function findQuote(transcriptText: string, quote: string): number {
  if (quote.length === 0) return -1;
  return transcriptText.indexOf(quote);
}
