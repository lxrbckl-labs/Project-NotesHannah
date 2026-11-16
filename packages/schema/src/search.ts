import { z } from "zod";
import { BlockType } from "./blocks/index.js";
import { BlockId, DocumentId, FileId, NodeId, PageId, TranscriptId } from "./ids.js";
import { NodeWithLinks } from "./library.js";

/** What a search can find. */
export const SearchKind = z.enum(["node", "page", "block"]);
export type SearchKind = z.infer<typeof SearchKind>;

export const SEARCH_KINDS: readonly SearchKind[] = SearchKind.options;

/** A library item whose name matches. */
export const NodeSearchHit = z.object({
  kind: z.literal("node"),
  node: NodeWithLinks,
  snippet: z.string(),
});
export type NodeSearchHit = z.infer<typeof NodeSearchHit>;

/** A source page whose current transcript matches. */
export const PageSearchHit = z.object({
  kind: z.literal("page"),
  pageId: PageId,
  /** 1-based page or slide number. */
  pageIndex: z.number().int().min(1),
  fileId: FileId,
  fileName: z.string(),
  /** Where the file is filed, or null while it sits in the inbox. */
  nodeId: NodeId.nullable(),
  transcriptId: TranscriptId,
  snippet: z.string(),
});
export type PageSearchHit = z.infer<typeof PageSearchHit>;

/** A block of a document whose text matches. */
export const BlockSearchHit = z.object({
  kind: z.literal("block"),
  documentId: DocumentId,
  /** The library node the document belongs to. */
  nodeId: NodeId,
  documentTitle: z.string(),
  blockId: BlockId,
  blockType: BlockType,
  snippet: z.string(),
});
export type BlockSearchHit = z.infer<typeof BlockSearchHit>;

export const SearchHit = z.discriminatedUnion("kind", [
  NodeSearchHit,
  PageSearchHit,
  BlockSearchHit,
]);
export type SearchHit = z.infer<typeof SearchHit>;

/**
 * Query of `GET /api/search`. `kinds` is a comma-separated list ("node,page");
 * leave it out to search everything.
 */
export const SearchQuery = z.object({
  q: z.string().trim().min(1).max(200),
  kinds: z
    .string()
    .max(40)
    .transform((value, ctx) => {
      const parts = [
        ...new Set(
          value
            .split(",")
            .map((part) => part.trim())
            .filter((part) => part !== ""),
        ),
      ];
      const kinds: SearchKind[] = [];
      for (const part of parts) {
        const parsed = SearchKind.safeParse(part);
        if (!parsed.success) {
          ctx.addIssue({
            code: "custom",
            message: `"${part}" is not a kind of search hit. Use ${SEARCH_KINDS.join(", ")}.`,
          });
          return z.NEVER;
        }
        kinds.push(parsed.data);
      }
      if (kinds.length === 0) {
        ctx.addIssue({
          code: "custom",
          message: `Name at least one of ${SEARCH_KINDS.join(", ")}.`,
        });
        return z.NEVER;
      }
      return kinds;
    })
    .optional(),
  cursor: z.string().max(200).optional(),
  /** At most 100: each kind is asked for one more than this to know whether more is waiting. */
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type SearchQuery = z.infer<typeof SearchQuery>;

/** A page of mixed hits, best first. One cursor pages through all kinds. */
export const SearchPage = z.object({
  items: z.array(SearchHit),
  nextCursor: z.string().nullable(),
});
export type SearchPage = z.infer<typeof SearchPage>;
