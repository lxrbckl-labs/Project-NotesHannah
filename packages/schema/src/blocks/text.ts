import type { Citation } from "../citations.js";
import { type BlockInput, type BlockPath, blockParts } from "./registry.js";
import { richTextToPlain } from "./rich-text.js";

/**
 * Pure read helpers over blocks: plain text for search and previews,
 * every citation with where it sits, and concept mentions.
 */

/** The readable text of a block, one part per line, without citation markers. */
export function blockPlainText(block: BlockInput): string {
  return blockParts(block)
    .map((part) => richTextToPlain(part.text))
    .filter((text) => text.length > 0)
    .join("\n");
}

/** A citation and where it sits in its block: `field` is null for the block's own list. */
export interface CitationUse {
  citation: Citation;
  /** Path of the citable field inside the block, e.g. ["content", "dosingNotes", 0]. */
  field: BlockPath | null;
}

/** Every citation on a block in reading order: the block's own list first, then each field's. */
export function blockCitations(block: BlockInput): CitationUse[] {
  const uses: CitationUse[] = block.citations.map((citation) => ({ citation, field: null }));
  for (const part of blockParts(block)) {
    if (!part.field) continue;
    for (const citation of part.field.citations) uses.push({ citation, field: part.path });
  }
  return uses;
}

/** A concept named in a block, by an inline mention or by a field that names a concept. */
export interface ConceptUse {
  conceptId: string;
  /** The words used for it. */
  text: string;
  path: BlockPath;
}

export function blockConceptMentions(block: BlockInput): ConceptUse[] {
  const out: ConceptUse[] = [];
  for (const part of blockParts(block)) {
    if (part.concept) {
      out.push({ conceptId: part.concept, text: richTextToPlain(part.text), path: part.path });
    }
    for (const item of part.text) {
      if ("concept" in item)
        out.push({ conceptId: item.concept, text: item.text, path: part.path });
    }
  }
  return out;
}
