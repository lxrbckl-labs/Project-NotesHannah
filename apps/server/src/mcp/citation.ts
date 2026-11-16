import { Citation } from "@notes/schema";
import { z } from "zod";

/**
 * A citation as published in tool schemas: the fields an agent writes almost
 * always. The optional region and transcript revision are still accepted (the
 * domains check every citation in full); leaving them out of the published
 * schema keeps each tool's listing about a third smaller.
 */
export const PublishedCitation = z.looseObject({
  fileId: Citation.shape.fileId,
  pageId: Citation.shape.pageId,
  quote: Citation.shape.quote,
  label: Citation.shape.label,
});

export const CITATION_TEXT =
  'Where it came from: {"fileId", "pageId", "quote" copied character for character from that page\'s transcript or slide text, "label"?}; an optional "region" {x, y, width, height} (fractions of the page) and "transcriptId" are accepted too.';
