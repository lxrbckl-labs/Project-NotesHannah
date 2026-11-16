import {
  BlockFlag,
  BlockStyle,
  BlockType,
  CreateDocumentInput,
  DeleteBlocksInput,
  InsertBlocksInput,
  MoveBlocksInput,
  OPERATION_EXAMPLES,
  type Problem,
  ReplaceGeneratedInput,
  RestoreRevisionInput,
  UpdateBlockInput,
  validateOperation,
  type WriterOperation,
} from "@notes/schema";
import { z } from "zod";
import { AppError } from "../../http/errors.js";
import { CITATION_TEXT, PublishedCitation } from "../citation.js";
import { exampleId } from "../errors.js";
import type { WriteSummary } from "../ports.js";
import { checkQuotes } from "../quotes.js";

type DocumentEditOperation = Exclude<WriterOperation, "create_document">;

import { describe, flattenActions, type JsonSchema, jsonOf } from "../schema.js";
import { defineTool, type ToolContext } from "../tool.js";

/**
 * The block as published in tool schemas: the envelope, with `content` left
 * open. The full union of every block type is about 18 KB of JSON Schema per
 * tool; instead start_here {"topic":"blocks"} lists each type's content with
 * an example, and the server validates each block exactly, answering a wrong
 * block with the path, the rule and a valid block of that type.
 */
const PublishedBlock = z.object({
  type: BlockType,
  content: z.record(z.string(), z.unknown()).optional(),
  style: BlockStyle.optional(),
  citations: z.array(PublishedCitation).max(20).optional(),
  generalKnowledge: z.boolean().optional(),
  flags: z.array(BlockFlag).max(20).optional(),
});
const blocks = z.array(PublishedBlock);

const BLOCK_DESCRIPTIONS: Record<string, string> = {
  type: 'The block type, e.g. paragraph, heading, callout, drug_card, table. start_here {"topic":"blocks"} lists each type\'s content fields with an example.',
  content:
    'The type-specific fields, e.g. for a paragraph {"text": "…"}; for a heading {"level": 2, "text": "…"}. Text accepts a plain string or rich-text runs.',
  style: 'Optional colours as tokens, e.g. {"background": "yellow"}.',
  citations: `${CITATION_TEXT} At least one for generated text blocks, unless generalKnowledge is true.`,
  "citations[].fileId": `The source file, e.g. "${exampleId("file")}".`,
  "citations[].pageId": `The source page, e.g. "${exampleId("page")}".`,
  "citations[].quote":
    "The supporting passage, copied character for character from that page's transcript (1 to 1000 characters).",
  "citations[].label": 'Optional short chip label, e.g. "Slide 12".',
  "style.color":
    "Text colour token: gray, brown, red, orange, yellow, green, teal, blue, purple or pink.",
  "style.background": "Background colour token (same list as color).",
  generalKnowledge:
    'True when nothing in the block is from her notes; it is labelled "not from your notes". Cannot be combined with citations.',
  flags: 'Things she should check, e.g. every dose: {"kind": "dose", "quote": "25 mg"}.',
  "flags[].kind": "uncertain, illegible, dose, unit, decimal, drug_name or source_conflict.",
  "flags[].quote": "Optional: the exact text the flag is about.",
  "flags[].note": "Optional: what to check.",
};

function describeBlocks(schema: JsonSchema, prefix: string): JsonSchema {
  const map: Record<string, string> = {};
  for (const [k, v] of Object.entries(BLOCK_DESCRIPTIONS)) {
    map[`${prefix}.${k}`] = v;
  }
  return describe(schema, map);
}

/** Turn validateOperation problems into one teaching error. */
function problemsError(tool: string, operation: string, problems: Problem[]): AppError {
  const shown = problems.slice(0, 6).map((p) => `${p.path}: ${p.message}`);
  const more =
    problems.length > shown.length ? ` (and ${problems.length - shown.length} more)` : "";
  return new AppError(
    "invalid_input",
    `Invalid input for ${tool} (${operation}): ${shown.join(" | ")}${more}`,
    {
      hint: "Paths start at $ (your input). Fix each named place; the example is a minimal valid value for the first problem (a block of that type, or a whole input).",
      example: problems[0]?.example ?? OPERATION_EXAMPLES[operation as WriterOperation],
    },
  );
}

function docs(ctx: ToolContext) {
  const port = ctx.backend.documents;
  if (!port) throw new AppError("internal", "Documents are not available.");
  return port;
}

function resultText(verb: string, r: WriteSummary): string {
  const lines = [
    `${verb} document ${r.documentId}${r.nodeId ? ` (node ${r.nodeId})` : ""}, now revision ${r.revision}. Pass expectedRevision ${r.revision} on your next edit. Check it with get_item {"id":"${r.documentId}"} (blocks and the references list).`,
  ];
  if (r.written.length) lines.push(`Written blocks: ${r.written.join(", ")}`);
  if (r.removed.length)
    lines.push(`Removed blocks (kept in revision history): ${r.removed.join(", ")}`);
  if (r.skipped.length) {
    lines.push(
      `Left alone because she edited or reviewed them: ${r.skipped.map((s) => `${s.blockId} (${s.type}, ${s.reason})`).join(", ")}. To change one, she must ask for it; then pass her requestId.`,
    );
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// write_document
// ---------------------------------------------------------------------------

const WritePublished = z.strictObject({ ...CreateDocumentInput.shape, blocks: blocks.optional() });

export const writeDocument = defineTool({
  name: "write_document",
  title: "Write a new document of study material",
  description: `Create a document (study material made of typed blocks) and its first blocks in one call. Give exactly one of nodeId (fill an existing lecture or document node, e.g. a lecture's merged note) or parentId (create a new document node in a section or folder, e.g. the course's "Study guides" section). Kinds: lecture_note, study_guide, practice_set, free. Every generated text block must cite its source (fileId, pageId and a passage quoted exactly from that page's transcript) or set generalKnowledge: true. Up to 100 blocks per call; add more with edit_blocks. Block types and examples: start_here {"topic":"blocks"}.`,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  inputSchema: describeBlocks(
    describe(jsonOf(WritePublished), {
      nodeId: `An existing lecture or document node to fill, e.g. "${exampleId("node")}". Use this or parentId, not both.`,
      parentId: `A section or folder to create a new document node in. Use this or nodeId, not both.`,
      kind: '"lecture_note" (a lecture\'s merged note), "study_guide", "practice_set" or "free".',
      title: "The document title, 1 to 200 characters.",
      blocks: "The blocks in reading order, at most 100.",
    }),
    "blocks[]",
  ),
  parse(raw) {
    // Checked here for errors that name this tool; the domain checks again (and the quotes).
    const result = validateOperation("create_document", raw, { writer: "agent" });
    if (!result.ok) throw problemsError("write_document", "create_document", result.problems);
    return raw;
  },
  writes: () => true,
  action: () => "create_document",
  run(ctx, input) {
    const body = input as { nodeId?: string; parentId?: string };
    ctx.claims.assertFree(
      ctx.userId,
      [body.nodeId, body.parentId].filter((x): x is string => typeof x === "string"),
      ctx.keyId,
    );
    checkQuotes(ctx, input);
    const r = docs(ctx).write(ctx.auth, "create_document", input);
    return { text: resultText("Created", r), structured: { ...r } };
  },
});

// ---------------------------------------------------------------------------
// edit_blocks
// ---------------------------------------------------------------------------

const [replaceBranch, patchBranch] = UpdateBlockInput.options;
const PUBLISHED_OPERATIONS: Record<DocumentEditOperation, z.ZodObject> = {
  insert_blocks: z.object({ ...InsertBlocksInput.shape, blocks }),
  update_block: z.object({
    ...replaceBranch.shape,
    ...patchBranch.shape,
    mode: z.enum(["replace", "patch"]),
    // Same shapes as an item of "blocks"; left open here to keep the schema small.
    block: z.record(z.string(), z.unknown()).optional(),
    patch: z.record(z.string(), z.unknown()).optional(),
  }),
  move_blocks: MoveBlocksInput,
  delete_blocks: DeleteBlocksInput,
  replace_generated: z.object({ ...ReplaceGeneratedInput.shape, blocks }),
  restore_revision: RestoreRevisionInput,
};
const OPERATIONS = Object.keys(PUBLISHED_OPERATIONS) as DocumentEditOperation[];

export const editBlocks = defineTool({
  name: "edit_blocks",
  title: "Change the blocks of a document",
  description: `Change an existing document with one "operation": insert_blocks (add blocks at a position), update_block (mode "replace" with a whole new block, or mode "patch" with only the fields to change), move_blocks (reorder, or move to another document), delete_blocks (removed blocks stay in revision history), replace_generated (regenerate: removes your earlier unreviewed blocks, keeps hers and reports them as skipped), restore_revision. Protection: you may only overwrite blocks an agent wrote that she has not edited or reviewed, unless you pass the requestId of her request about that document or block, claimed by you (requests tool). Pass expectedRevision (from get_item) so a write is refused instead of overwriting her newer changes. Positions: "start", "end", {"after":"blk_…"}, {"before":"blk_…"}, {"index":0}.`,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  inputSchema: describeBlocks(
    describe(
      flattenActions(
        "operation",
        Object.fromEntries(OPERATIONS.map((op) => [op, jsonOf(PUBLISHED_OPERATIONS[op])])),
        "What to do; see the tool description.",
      ),
      {
        documentId: `The document, e.g. "${exampleId("document")}".`,
        blocks: "insert_blocks: 1 to 100 blocks; replace_generated: the new blocks, up to 300.",
        position:
          'Where: "start", "end" (default for inserts), {"after":"blk_…"}, {"before":"blk_…"} or {"index":0}.',
        mode: 'update_block: "replace" (send block) or "patch" (send patch); inferred from which of the two you send.',
        blockId: `update_block: the block to change, e.g. "${exampleId("block")}".`,
        block:
          'update_block mode replace: the whole new block, shaped like an item of "blocks" ({"type", "content", "citations", ...}).',
        patch:
          'update_block mode patch: the top-level fields to replace, e.g. {"content": {"text": "…"}}; inside content only the named fields change; "style": null clears the style.',
        blockIds: "move_blocks and delete_blocks: the blocks, in the order to keep.",
        toDocumentId: "move_blocks: move into this other document instead.",
        scope: "replace_generated: only regenerate these blocks; omit for the whole document.",
        revision: "restore_revision: the revision number to bring back.",
        "position.after": "Insert after this block ID.",
        "position.before": "Insert before this block ID.",
        "position.index": "Insert at this 0-based index.",
      },
    ),
    "blocks[]",
  ),
  parse(raw) {
    const body = (raw ?? {}) as Record<string, unknown>;
    const operation = body.operation;
    if (typeof operation !== "string" || !OPERATIONS.includes(operation as never)) {
      const isCreate = operation === "create_document";
      throw new AppError(
        "invalid_input",
        isCreate
          ? "edit_blocks changes existing documents; create one with write_document."
          : `Invalid input for edit_blocks: "operation" must be one of: ${OPERATIONS.join(", ")}.`,
        {
          hint: isCreate
            ? "Call write_document with nodeId or parentId, kind, title and blocks."
            : "Pick the operation for what you want to change.",
          example: isCreate
            ? OPERATION_EXAMPLES.create_document
            : { operation: "insert_blocks", ...(OPERATION_EXAMPLES.insert_blocks as object) },
        },
      );
    }
    const { operation: _op, ...rest } = body;
    // update_block: the mode follows from what was sent (block: replace, patch: patch), as the HTTP route does.
    if (operation === "update_block" && rest.mode === undefined) {
      if (rest.block !== undefined && rest.patch === undefined) rest.mode = "replace";
      else if (rest.patch !== undefined && rest.block === undefined) rest.mode = "patch";
    }
    const result = validateOperation(operation as DocumentEditOperation, rest, {
      writer: "agent",
    });
    if (!result.ok) {
      const problems = result.problems.map((p) =>
        p.example === OPERATION_EXAMPLES[operation as WriterOperation]
          ? { ...p, example: { operation, ...(p.example as object) } }
          : p,
      );
      throw problemsError("edit_blocks", operation, problems);
    }
    return { operation: operation as DocumentEditOperation, value: rest };
  },
  writes: () => true,
  action: (input) => (input as { operation: string }).operation,
  run(ctx, input) {
    const { operation, value } = input as {
      operation: DocumentEditOperation;
      value: never;
    };
    const port = docs(ctx);
    const target = (value as { documentId: string }).documentId;
    try {
      const { document } = port.getDocument(ctx.auth, target, { offset: 0, limit: 1 });
      ctx.claims.assertFree(ctx.userId, [document.nodeId], ctx.keyId);
    } catch (error) {
      if (error instanceof AppError && error.code === "conflict") throw error;
      // a missing document is the domain's error to report
    }
    checkQuotes(ctx, value);
    const r = port.write(ctx.auth, operation, value);
    return { text: resultText(`Applied ${operation} to`, r), structured: { operation, ...r } };
  },
});
