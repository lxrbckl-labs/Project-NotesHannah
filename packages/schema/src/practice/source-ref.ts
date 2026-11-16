import { z } from "zod";
import { FileId, PageId, TranscriptId } from "../ids.js";

/**
 * Where a question came from: a quoted passage on a page of one of her
 * uploaded files.
 *
 * TEMPORARY: this is a minimal local stand-in. It will be replaced by the
 * shared Citation type (citations.ts) when the integrator wires the schema
 * package together. Keep the shape in step with the fields below until then.
 */
export const SourceRef = z.strictObject({
  fileId: FileId,
  pageId: PageId,
  /** The passage from the page or transcript that the question is based on. */
  quote: z.string().min(1, "quote must not be empty").max(1000, "quote is at most 1000 characters"),
  transcriptId: TranscriptId.optional(),
  /** Short human label for the chip, e.g. "Lecture 7, slide 12". */
  label: z.string().optional(),
});
export type SourceRef = z.infer<typeof SourceRef>;
