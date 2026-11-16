import { z } from "zod";
import { BlockFlag } from "./blocks/common.js";
import {
  BLOCK_REGISTRY,
  Block,
  BlockInput,
  BlockStyle,
  BlockType,
  blockCitations,
  blockConceptMentions,
  blockPlainText,
  blockToInput,
  canAgentOverwrite,
  formatPath,
  type Problem,
  type ProtectionReason,
  type StampContext,
  stampNewBlock,
  type ValidateOptions,
  validateBlockInput,
  validateBlockInputs,
} from "./blocks/index.js";
import { Citation, CitingLocation, citationKey, NormalizedBox } from "./citations.js";
import { Actor, Timestamp } from "./common.js";
import { BlockId, DocumentId, FileId, NodeId, PageId, RequestId, RevisionId } from "./ids.js";
import { ReviewStatus } from "./sources.js";

/**
 * Documents are ordered lists of typed blocks (see docs/blocks.md for why a
 * flat list and not a tree). A document is the body of a library node: a
 * node of kind "document", or a lecture's merged note.
 */

export const DOCUMENT_LIMITS = {
  titleChars: 200,
  /** Most blocks in one document. */
  blocks: 1000,
  /** Most blocks written or moved by one call. */
  blocksPerCall: 100,
  /** Most blocks in one regeneration. */
  regenerateBlocks: 300,
  summaryChars: 300,
} as const;

/** What a document is for. Decides where it is filed and how it is presented. */
export const DocumentKind = z.enum(["lecture_note", "study_guide", "practice_set", "free"]);
export type DocumentKind = z.infer<typeof DocumentKind>;

export const DocumentTitle = z.string().trim().min(1).max(DOCUMENT_LIMITS.titleChars);

export const Document = z.object({
  id: DocumentId,
  /** The library node this document is the body of (a "document" node or a "lecture"). */
  nodeId: NodeId,
  kind: DocumentKind,
  title: DocumentTitle,
  /** The blocks, in reading order. */
  blockIds: z.array(BlockId).max(DOCUMENT_LIMITS.blocks),
  /** "reviewed" once every block in it is reviewed; kept in step by the server. */
  reviewStatus: ReviewStatus,
  /** Current revision number; increases by one with every saved change. */
  revision: z.number().int().min(1),
  createdBy: Actor,
  createdAt: Timestamp,
  lastEditedBy: Actor,
  updatedAt: Timestamp,
  trashedAt: Timestamp.nullable(),
});
export type Document = z.infer<typeof Document>;

/** A document with its blocks, as returned when full content is asked for. */
export const DocumentWithBlocks = Document.extend({
  blocks: z.array(Block).max(DOCUMENT_LIMITS.blocks),
}).refine(
  (doc) =>
    doc.blocks.length === doc.blockIds.length &&
    doc.blocks.every((block, index) => block.id === doc.blockIds[index]),
  { error: "blocks must be the blocks named in blockIds, in the same order.", path: ["blocks"] },
);
export type DocumentWithBlocks = z.infer<typeof DocumentWithBlocks>;

/**
 * Revision history (D12) is a list of full snapshots. Restoring writes the
 * old snapshot as a new revision, so history is never rewritten and a
 * restore can itself be undone.
 */
export const RevisionSnapshot = z.object({
  title: DocumentTitle,
  kind: DocumentKind,
  blocks: z.array(Block).max(DOCUMENT_LIMITS.blocks),
});
export type RevisionSnapshot = z.infer<typeof RevisionSnapshot>;

export const Revision = z.object({
  id: RevisionId,
  documentId: DocumentId,
  number: z.number().int().min(1),
  author: Actor,
  createdAt: Timestamp,
  /** What changed, e.g. "Inserted 3 blocks" or "Restored revision 4". */
  summary: z.string().max(DOCUMENT_LIMITS.summaryChars).nullable(),
  /** Set when this revision restored an earlier one. */
  restoredFrom: z.number().int().min(1).nullable(),
  snapshot: RevisionSnapshot,
});
export type Revision = z.infer<typeof Revision>;

/** A revision in the history list, without its snapshot. */
export const RevisionSummary = Revision.omit({ snapshot: true }).extend({
  blockCount: z.number().int().min(0),
});
export type RevisionSummary = z.infer<typeof RevisionSummary>;

/** The snapshot of a document as it is now. */
export function snapshotDocument(doc: DocumentWithBlocks): RevisionSnapshot {
  return { title: doc.title, kind: doc.kind, blocks: doc.blocks };
}

/**
 * The document after restoring an earlier revision: its title, kind and
 * blocks (with their recorded provenance) under the next revision number.
 */
export function restoreRevision(
  current: DocumentWithBlocks,
  revision: Revision,
  context: { actor: Actor; now?: string },
): DocumentWithBlocks {
  const now = context.now ?? new Date().toISOString();
  const blocks = revision.snapshot.blocks;
  return {
    ...current,
    title: revision.snapshot.title,
    kind: revision.snapshot.kind,
    blocks,
    blockIds: blocks.map((block) => block.id),
    reviewStatus: documentReviewStatus(blocks),
    revision: current.revision + 1,
    lastEditedBy: context.actor,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// Writer operations. These are the bodies of the API and the MCP tool inputs.
// Writers supply content only; IDs, provenance and timestamps are stamped by
// the server with stampNewBlock / stampEditedBlock.
// ---------------------------------------------------------------------------

/** If given, the write is refused with "conflict" when the document has moved past this revision. */
const expectedRevision = z
  .number()
  .int()
  .min(1)
  .optional()
  .meta({ description: "Refuse the write if the document is no longer at this revision." });

/** Her request this write answers, which lets an agent change blocks she wrote or reviewed. */
const requestId = RequestId.optional().meta({
  description:
    "The ID of her request this change answers. Needed to change a block she wrote or reviewed.",
});

/**
 * Where blocks go: "start", "end" (the default), after or before a block, or
 * at a 0-based index in the document's block list.
 */
export const BlockPosition = z.union(
  [
    z.literal("start"),
    z.literal("end"),
    z.strictObject({ after: BlockId }),
    z.strictObject({ before: BlockId }),
    z.strictObject({ index: z.number().int().min(0) }),
  ],
  {
    error: 'A position is "start", "end", {"after": "blk_…"}, {"before": "blk_…"} or {"index": 0}.',
  },
);
export type BlockPosition = z.infer<typeof BlockPosition>;

const blockList = (max: number) =>
  z.array(BlockInput).max(max, { error: `At most ${max} blocks per call; split the write.` });

export const CreateDocumentInput = z
  .strictObject({
    /** An existing lecture or document node to hold this document. */
    nodeId: NodeId.optional(),
    /** Or: create a new document node under this section or folder. */
    parentId: NodeId.optional(),
    kind: DocumentKind,
    title: DocumentTitle,
    blocks: blockList(DOCUMENT_LIMITS.blocksPerCall).default([]),
  })
  .refine((input) => (input.nodeId === undefined) !== (input.parentId === undefined), {
    error:
      'Give exactly one of "nodeId" (an existing lecture or document node to fill) or "parentId" (a section or folder to create a new document in).',
    path: ["nodeId"],
  });
export type CreateDocumentInput = z.infer<typeof CreateDocumentInput>;

export const InsertBlocksInput = z.strictObject({
  documentId: DocumentId,
  blocks: blockList(DOCUMENT_LIMITS.blocksPerCall).min(1),
  position: BlockPosition.default("end"),
  expectedRevision,
});
export type InsertBlocksInput = z.infer<typeof InsertBlocksInput>;

/**
 * A field patch: each top-level key given replaces that key. Inside
 * `content`, each named content field is replaced and the others kept.
 * `style: null` clears the style. The block's type cannot change by patch.
 */
export const BlockPatch = z
  .strictObject({
    content: z.record(z.string(), z.unknown()).optional(),
    style: BlockStyle.nullable().optional(),
    citations: z.array(Citation).optional(),
    generalKnowledge: z.boolean().optional(),
    flags: z.array(BlockFlag).optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, {
    error:
      "The patch is empty: give at least one of content, style, citations, generalKnowledge, flags.",
  });
export type BlockPatch = z.infer<typeof BlockPatch>;

export const UpdateBlockInput = z.discriminatedUnion("mode", [
  z.strictObject({
    mode: z.literal("replace"),
    documentId: DocumentId,
    blockId: BlockId,
    /** The whole new block. Its type may differ from the old one. */
    block: BlockInput,
    requestId,
    expectedRevision,
  }),
  z.strictObject({
    mode: z.literal("patch"),
    documentId: DocumentId,
    blockId: BlockId,
    patch: BlockPatch,
    requestId,
    expectedRevision,
  }),
]);
export type UpdateBlockInput = z.infer<typeof UpdateBlockInput>;

export const MoveBlocksInput = z.strictObject({
  documentId: DocumentId,
  /** Blocks to move, kept in this order at the new position. */
  blockIds: z.array(BlockId).min(1).max(DOCUMENT_LIMITS.blocksPerCall),
  position: BlockPosition,
  /** Move into another document instead; position then refers to that document. */
  toDocumentId: DocumentId.optional(),
  expectedRevision,
});
export type MoveBlocksInput = z.infer<typeof MoveBlocksInput>;

/** Removes blocks from the document. They stay in revision history and can be restored. */
export const DeleteBlocksInput = z.strictObject({
  documentId: DocumentId,
  blockIds: z.array(BlockId).min(1).max(DOCUMENT_LIMITS.blocksPerCall),
  requestId,
  expectedRevision,
});
export type DeleteBlocksInput = z.infer<typeof DeleteBlocksInput>;

/**
 * Regenerate a document's generated content. Agent blocks that she has not
 * edited or reviewed (within `scope`, or the whole document) are removed and
 * the new blocks placed where the first of them stood. Her blocks stay where
 * they are and are reported as skipped.
 */
export const ReplaceGeneratedInput = z.strictObject({
  documentId: DocumentId,
  blocks: blockList(DOCUMENT_LIMITS.regenerateBlocks),
  /** Only regenerate these blocks; omit for the whole document. */
  scope: z.array(BlockId).min(1).max(DOCUMENT_LIMITS.blocks).optional(),
  /** With her request, protected blocks in scope are replaced too. */
  requestId,
  expectedRevision,
});
export type ReplaceGeneratedInput = z.infer<typeof ReplaceGeneratedInput>;

export const SkippedBlock = z.object({
  blockId: BlockId,
  type: BlockType,
  reason: z.enum(["user_edited", "reviewed"]),
});
export type SkippedBlock = z.infer<typeof SkippedBlock>;

export const ReplaceGeneratedResult = z.object({
  documentId: DocumentId,
  revision: z.number().int().min(1),
  /** New blocks, in order. */
  written: z.array(BlockId),
  removed: z.array(BlockId),
  /** Her blocks left alone. */
  skipped: z.array(SkippedBlock),
});
export type ReplaceGeneratedResult = z.infer<typeof ReplaceGeneratedResult>;

export const RestoreRevisionInput = z.strictObject({
  documentId: DocumentId,
  /** The revision number to bring back. */
  revision: z.number().int().min(1),
  expectedRevision,
});
export type RestoreRevisionInput = z.infer<typeof RestoreRevisionInput>;

/** Writer operations by name, for the MCP layer and the API router. */
export const WRITER_OPERATIONS = {
  create_document: CreateDocumentInput,
  insert_blocks: InsertBlocksInput,
  update_block: UpdateBlockInput,
  move_blocks: MoveBlocksInput,
  delete_blocks: DeleteBlocksInput,
  replace_generated: ReplaceGeneratedInput,
  restore_revision: RestoreRevisionInput,
} as const;
export type WriterOperation = keyof typeof WRITER_OPERATIONS;

const ex = { document: "doc_01J9Z8Y7X6W5V4T3S2R1Q0P9N8", block: "blk_01J9Z8Y7X6W5V4T3S2R1Q0P9N8" };

/** A minimal valid body for each operation, shown in errors and the agent overview. */
export const OPERATION_EXAMPLES: Record<WriterOperation, unknown> = {
  create_document: {
    parentId: "nod_01J9Z8Y7X6W5V4T3S2R1Q0P9N8",
    kind: "study_guide",
    title: "Beta blockers",
    blocks: [BLOCK_REGISTRY.heading.example, BLOCK_REGISTRY.paragraph.example],
  },
  insert_blocks: {
    documentId: ex.document,
    blocks: [BLOCK_REGISTRY.callout.example],
    position: { after: ex.block },
  },
  update_block: {
    mode: "patch",
    documentId: ex.document,
    blockId: ex.block,
    patch: { content: { text: "Atenolol is renally cleared." } },
  },
  move_blocks: { documentId: ex.document, blockIds: [ex.block], position: "start" },
  delete_blocks: { documentId: ex.document, blockIds: [ex.block] },
  replace_generated: { documentId: ex.document, blocks: [BLOCK_REGISTRY.paragraph.example] },
  restore_revision: { documentId: ex.document, revision: 3 },
};

/**
 * Validate an operation body with teaching errors. Blocks inside it are
 * checked one by one (including the citation rule for the writer), so a
 * problem points at `$.blocks[2].content.text` with an example of that
 * block type; other problems carry an example body of the operation.
 */
export function validateOperation<K extends WriterOperation>(
  operation: K,
  input: unknown,
  options: Pick<ValidateOptions, "writer"> = {},
):
  | { ok: true; value: z.output<(typeof WRITER_OPERATIONS)[K]> }
  | { ok: false; problems: Problem[] } {
  const schema = WRITER_OPERATIONS[operation] as z.ZodType;
  const example = OPERATION_EXAMPLES[operation];
  const problems: Problem[] = [];
  const body =
    typeof input === "object" && input !== null ? (input as Record<string, unknown>) : null;

  const blockPaths: string[] = [];
  if (body && Array.isArray(body.blocks)) {
    blockPaths.push("blocks");
    const result = validateBlockInputs(body.blocks, { writer: options.writer ?? "agent" });
    if (!result.ok) problems.push(...result.problems);
  }
  if (body && body.mode === "replace" && body.block !== undefined) {
    blockPaths.push("block");
    const result = validateBlockInput(body.block, {
      writer: options.writer ?? "agent",
      pathPrefix: "$.block",
    });
    if (!result.ok) problems.push(...result.problems);
  }

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const head = issue.path[0];
      if (typeof head === "string" && blockPaths.includes(head) && issue.path.length > 1) continue;
      problems.push({ path: formatPath(issue.path), message: issue.message, example });
    }
  }
  if (problems.length > 0 || !parsed.success) {
    return { ok: false, problems };
  }
  return { ok: true, value: parsed.data as z.output<(typeof WRITER_OPERATIONS)[K]> };
}

/**
 * Apply a field patch to a stored block and validate the result as the
 * writer's new version of the block.
 */
export function applyBlockPatch(block: Block, patch: BlockPatch, options: ValidateOptions = {}) {
  const current = blockToInput(block);
  const next: Record<string, unknown> = { ...current };
  if (patch.content) next.content = { ...(current.content as object), ...patch.content };
  if (patch.style === null) delete next.style;
  else if (patch.style !== undefined) next.style = patch.style;
  if (patch.citations !== undefined) next.citations = patch.citations;
  if (patch.generalKnowledge !== undefined) next.generalKnowledge = patch.generalKnowledge;
  if (patch.flags !== undefined) next.flags = patch.flags;
  return validateBlockInput(next, options);
}

// ---------------------------------------------------------------------------
// Ordering helpers.
// ---------------------------------------------------------------------------

/** The 0-based index a position means in `order`, or null when it names a block not in it. */
export function resolvePosition(order: readonly string[], position: BlockPosition): number | null {
  if (position === "start") return 0;
  if (position === "end") return order.length;
  if ("index" in position) return Math.min(position.index, order.length);
  const anchor = "after" in position ? position.after : position.before;
  const at = order.indexOf(anchor);
  if (at < 0) return null;
  return "after" in position ? at + 1 : at;
}

/** `order` with `ids` inserted at `position`, or null when the anchor block is missing. */
export function insertIds(
  order: readonly string[],
  ids: readonly string[],
  position: BlockPosition,
): string[] | null {
  const at = resolvePosition(order, position);
  if (at === null) return null;
  return [...order.slice(0, at), ...ids, ...order.slice(at)];
}

/**
 * `order` with `ids` moved to `position` (resolved after taking them out).
 * Null when an ID is not in the document or the anchor is one of the moved blocks.
 */
export function moveIds(
  order: readonly string[],
  ids: readonly string[],
  position: BlockPosition,
): string[] | null {
  if (!ids.every((id) => order.includes(id))) return null;
  const rest = order.filter((id) => !ids.includes(id));
  return insertIds(rest, ids, position);
}

// ---------------------------------------------------------------------------
// Regeneration (D11).
// ---------------------------------------------------------------------------

export interface RegenerationPlan {
  /** The document's blocks after regeneration, in order. */
  blocks: Block[];
  written: string[];
  removed: string[];
  skipped: Array<{ blockId: string; type: BlockType; reason: ProtectionReason }>;
}

/**
 * Plan a "replace generated content" write. In scope (default: every block),
 * blocks an agent may overwrite are removed; blocks she wrote or reviewed are
 * kept in place and reported as skipped, unless `requestId` says she asked
 * for them to be replaced. The new blocks go where the first removed block
 * stood, or at the end when nothing was removed.
 */
export function planRegeneration(
  existing: readonly Block[],
  incoming: readonly BlockInput[],
  options: StampContext & { scope?: readonly string[]; requestId?: string | undefined },
): RegenerationPlan {
  const inScope = (block: Block) => !options.scope || options.scope.includes(block.id);
  const removed: string[] = [];
  const skipped: RegenerationPlan["skipped"] = [];
  let insertAt: number | null = null;
  const kept: Block[] = [];
  for (const block of existing) {
    if (!inScope(block)) {
      kept.push(block);
      continue;
    }
    const decision = canAgentOverwrite(block, { requestId: options.requestId });
    if (decision.allowed) {
      removed.push(block.id);
      if (insertAt === null) insertAt = kept.length;
    } else {
      skipped.push({ blockId: block.id, type: block.type, reason: decision.reason });
      kept.push(block);
    }
  }
  const { id: _ignored, ...context } = options;
  const fresh = incoming.map((input) => stampNewBlock(input, context));
  const at = insertAt ?? kept.length;
  return {
    blocks: [...kept.slice(0, at), ...fresh, ...kept.slice(at)],
    written: fresh.map((block) => block.id),
    removed,
    skipped,
  };
}

// ---------------------------------------------------------------------------
// Read helpers over a document's blocks.
// ---------------------------------------------------------------------------

/** Plain text of a document for search and previews: blocks separated by blank lines. */
export function documentPlainText(blocks: readonly BlockInput[]): string {
  return blocks
    .map((block) => blockPlainText(block))
    .filter((text) => text.length > 0)
    .join("\n\n");
}

/** One entry of a document's references list (K7). */
export interface Reference {
  /** Chip number: order of first appearance in the document, from 1. */
  number: number;
  citation: Citation;
  /** Every place the same passage is cited. `field` is a JSON path in the block, or null for the block's own list. */
  uses: Array<{ blockId: string; field: string | null }>;
}

/**
 * The references list (K7): every cited passage once, numbered in order of
 * first appearance (block by block; within a block, its own citations then
 * its fields' in reading order). The same passage cited twice keeps one number.
 */
export function listReferences(blocks: readonly Block[]): Reference[] {
  const byKey = new Map<string, Reference>();
  for (const block of blocks) {
    for (const use of blockCitations(block)) {
      const key = citationKey(use.citation);
      let reference = byKey.get(key);
      if (!reference) {
        reference = { number: byKey.size + 1, citation: use.citation, uses: [] };
        byKey.set(key, reference);
      }
      reference.uses.push({
        blockId: block.id,
        field: use.field ? formatPath(use.field) : null,
      });
    }
  }
  return [...byKey.values()];
}

/** Every concept named in a document, with the block it is named in. */
export function listConceptMentions(
  blocks: readonly Block[],
): Array<{ conceptId: string; text: string; blockId: string; path: string }> {
  return blocks.flatMap((block) =>
    blockConceptMentions(block).map((use) => ({
      conceptId: use.conceptId,
      text: use.text,
      blockId: block.id,
      path: formatPath(use.path),
    })),
  );
}

/** Blocks still waiting for her review. Dividers have nothing to review and are not counted. */
export function countUnverified(blocks: readonly Block[]): number {
  return blocks.filter((block) => block.type !== "divider" && block.review.status === "unverified")
    .length;
}

/** The document's review status: reviewed once nothing is waiting for review. */
export function documentReviewStatus(blocks: readonly Block[]): ReviewStatus {
  return countUnverified(blocks) === 0 ? "reviewed" : "unverified";
}

/** A row of the citation index behind "what cites this page" (K5). */
export const CitationIndexRow = z.object({
  fileId: FileId,
  pageId: PageId,
  location: CitingLocation,
  itemType: z.string(),
  quote: z.string(),
  region: NormalizedBox.optional(),
});
export type CitationIndexRow = z.infer<typeof CitationIndexRow>;

/** Index rows for every citation in a document, to rebuild the reverse lookup after a write. */
export function citationIndexRows(
  documentId: string,
  blocks: readonly Block[],
): CitationIndexRow[] {
  return blocks.flatMap((block) =>
    blockCitations(block).map((use) => ({
      fileId: use.citation.fileId,
      pageId: use.citation.pageId,
      location: {
        kind: "block" as const,
        documentId,
        blockId: block.id,
        field: use.field ? formatPath(use.field) : null,
      },
      itemType: block.type,
      quote: use.citation.quote,
      ...(use.citation.region ? { region: use.citation.region } : {}),
    })),
  );
}

/** JSON Schema of a writer input, as the MCP layer publishes it for a tool. */
export function writerJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { io: "input", reused: "ref" }) as Record<string, unknown>;
}
