import {
  type Actor,
  applyBlockPatch,
  type Block,
  type BlockInput,
  type BlockPosition,
  blockToInput,
  type DocumentWithBlocks,
  documentReviewStatus,
  insertIds,
  markReviewed,
  moveIds,
  newId,
  type Problem,
  stampEditedBlock,
  stampNewBlock,
  validateOperation,
  type WRITER_OPERATIONS,
} from "@notes/schema";
import type { z } from "zod";

/**
 * Writer operations as the editor emits them. Every editing gesture becomes a
 * list of these (WRITER_OPERATIONS bodies), applied optimistically on the
 * client and sent to the store in order.
 */
export type EditorOperation = "insert_blocks" | "update_block" | "move_blocks" | "delete_blocks";

export type OperationInput<K extends EditorOperation> = z.input<(typeof WRITER_OPERATIONS)[K]>;

export type OperationCall = {
  [K in EditorOperation]: { operation: K; input: OperationInput<K> };
}[EditorOperation];

/** Result of one operation, as the API returns it. */
export type OperationResult =
  | { operation: "insert_blocks"; blockIds: string[] }
  | { operation: "update_block"; block?: Block }
  | { operation: "move_blocks"; blockIds?: string[] }
  | { operation: "delete_blocks"; removed?: string[] };

/**
 * A call plus the client IDs the editor gives the blocks it inserts, so later
 * gestures (and undo) can name them before the server has answered.
 */
export interface PendingCall {
  call: OperationCall;
  clientIds?: string[];
}

export class OperationError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly problems: Problem[] = [],
  ) {
    super(message);
    this.name = "OperationError";
  }
}

export interface ApplyContext {
  actor: Actor;
  now?: string;
}

function findBlock(doc: DocumentWithBlocks, id: string): Block {
  const block = doc.blocks.find((b) => b.id === id);
  if (!block) throw new OperationError(`Block ${id} is not in this document.`, "not_found");
  return block;
}

function withBlocks(doc: DocumentWithBlocks, blocks: Block[]): DocumentWithBlocks {
  return {
    ...doc,
    blocks,
    blockIds: blocks.map((b) => b.id),
    reviewStatus: documentReviewStatus(blocks),
  };
}

function reorder(blocks: Block[], order: string[]): Block[] {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  return order.map((id) => byId.get(id) as Block);
}

function validated<K extends EditorOperation>(operation: K, input: unknown) {
  const result = validateOperation(operation, input, { writer: "user" });
  if (!result.ok) {
    const first = result.problems[0];
    throw new OperationError(
      first ? `${first.path}: ${first.message}` : "Invalid operation.",
      "invalid_input",
      result.problems,
    );
  }
  return result.value;
}

/**
 * Apply one writer operation to a document as her edit, the way the server
 * does: stamping provenance, keeping edit protection's "her edit makes it
 * hers", and refusing invalid input. Does not bump the revision.
 * `ids` are the IDs for inserted blocks (generated when left out).
 */
export function applyCall(
  doc: DocumentWithBlocks,
  pending: PendingCall,
  context: ApplyContext,
): { doc: DocumentWithBlocks; result: OperationResult } {
  const now = context.now ?? new Date().toISOString();
  const stamp = { actor: context.actor, now };
  const { call } = pending;
  switch (call.operation) {
    case "insert_blocks": {
      const value = validated("insert_blocks", call.input);
      const ids = value.blocks.map((_, i) => pending.clientIds?.[i] ?? newId("block"));
      const fresh = value.blocks.map((input, i) =>
        stampNewBlock(input as BlockInput, { ...stamp, id: ids[i] as string }),
      );
      const order = insertIds(doc.blockIds, ids, value.position as BlockPosition);
      if (!order)
        throw new OperationError("The position names a block that is not here.", "not_found");
      const blocks = reorder([...doc.blocks, ...fresh], order);
      return {
        doc: withBlocks(doc, blocks),
        result: { operation: "insert_blocks", blockIds: ids },
      };
    }
    case "update_block": {
      const value = validated("update_block", call.input);
      const existing = findBlock(doc, value.blockId);
      let next: Block;
      if (value.mode === "replace") {
        next = stampEditedBlock(existing, value.block as BlockInput, stamp);
      } else {
        const patched = applyBlockPatch(existing, value.patch, { writer: "user" });
        if (!patched.ok) {
          const first = patched.problems[0];
          throw new OperationError(
            first ? `${first.path}: ${first.message}` : "Invalid patch.",
            "invalid_input",
            patched.problems,
          );
        }
        next = stampEditedBlock(existing, patched.block, stamp);
      }
      const blocks = doc.blocks.map((b) => (b.id === next.id ? next : b));
      return { doc: withBlocks(doc, blocks), result: { operation: "update_block", block: next } };
    }
    case "move_blocks": {
      const value = validated("move_blocks", call.input);
      const order = moveIds(doc.blockIds, value.blockIds, value.position as BlockPosition);
      if (!order) throw new OperationError("Cannot move those blocks there.", "invalid_input");
      return {
        doc: withBlocks(doc, reorder(doc.blocks, order)),
        result: { operation: "move_blocks", blockIds: value.blockIds },
      };
    }
    case "delete_blocks": {
      const value = validated("delete_blocks", call.input);
      for (const id of value.blockIds) findBlock(doc, id);
      const blocks = doc.blocks.filter((b) => !value.blockIds.includes(b.id));
      return {
        doc: withBlocks(doc, blocks),
        result: { operation: "delete_blocks", removed: value.blockIds },
      };
    }
  }
}

/** Apply several calls in order. */
export function applyCalls(
  doc: DocumentWithBlocks,
  calls: readonly PendingCall[],
  context: ApplyContext,
): { doc: DocumentWithBlocks; results: OperationResult[] } {
  let current = doc;
  const results: OperationResult[] = [];
  for (const call of calls) {
    const step = applyCall(current, call, context);
    current = step.doc;
    results.push(step.result);
  }
  return { doc: current, results };
}

/** Set review status on blocks (all when `blockIds` is left out). Returns the changed IDs. */
export function applyReview(
  doc: DocumentWithBlocks,
  status: "reviewed" | "unverified",
  blockIds: readonly string[] | undefined,
  now: string = new Date().toISOString(),
): { doc: DocumentWithBlocks; changed: string[] } {
  const changed: string[] = [];
  const blocks = doc.blocks.map((block) => {
    if (blockIds && !blockIds.includes(block.id)) return block;
    if (block.review.status === status) return block;
    if (status === "reviewed" && block.type === "divider") return block;
    changed.push(block.id);
    return status === "reviewed"
      ? markReviewed(block, now)
      : { ...block, review: { status: "unverified" as const, reviewedAt: null } };
  });
  return { doc: withBlocks(doc, blocks), changed };
}

// ---------------------------------------------------------------------------
// Inverses, for undo.
// ---------------------------------------------------------------------------

/** Writer fields of a stored block, ready to send again. */
export function inputOf(block: Block): BlockInput {
  return blockToInput(block);
}

/**
 * The calls that undo `pending` when applied to the document that results
 * from it. `doc` is the document before `pending`.
 */
export function inverseOf(doc: DocumentWithBlocks, pending: PendingCall): PendingCall[] {
  const { call } = pending;
  const documentId = doc.id;
  switch (call.operation) {
    case "insert_blocks": {
      const ids = pending.clientIds ?? [];
      return ids.length > 0
        ? [{ call: { operation: "delete_blocks", input: { documentId, blockIds: ids } } }]
        : [];
    }
    case "update_block": {
      const old = findBlock(doc, call.input.blockId);
      return [
        {
          call: {
            operation: "update_block",
            input: { mode: "replace", documentId, blockId: old.id, block: inputOf(old) },
          },
        },
      ];
    }
    case "move_blocks": {
      const ids = call.input.blockIds;
      const first = doc.blockIds.indexOf(ids[0] as string);
      return [
        {
          call: {
            operation: "move_blocks",
            input: { documentId, blockIds: [...ids], position: { index: Math.max(0, first) } },
          },
        },
      ];
    }
    case "delete_blocks": {
      const ids = new Set(call.input.blockIds);
      return doc.blocks
        .map((block, index) => ({ block, index }))
        .filter(({ block }) => ids.has(block.id))
        .map(({ block, index }) => ({
          call: {
            operation: "insert_blocks",
            input: { documentId, blocks: [inputOf(block)], position: { index } },
          },
          clientIds: [block.id],
        }));
    }
  }
}

/**
 * Inverse of a list of calls: each call's inverse computed against the state
 * before it, in reverse order.
 */
export function inverseOfAll(
  doc: DocumentWithBlocks,
  calls: readonly PendingCall[],
  context: ApplyContext,
): PendingCall[] {
  let current = doc;
  const inverses: PendingCall[][] = [];
  for (const call of calls) {
    inverses.push(inverseOf(current, call));
    current = applyCall(current, call, context).doc;
  }
  return inverses.reverse().flat();
}

// ---------------------------------------------------------------------------
// Translating client block IDs to the server's.
// ---------------------------------------------------------------------------

function mapPosition(position: unknown, map: (id: string) => string): unknown {
  if (position && typeof position === "object") {
    if ("after" in position) return { after: map((position as { after: string }).after) };
    if ("before" in position) return { before: map((position as { before: string }).before) };
  }
  return position;
}

/** The call with every block ID passed through `map`. */
export function mapCallIds(call: OperationCall, map: (id: string) => string): OperationCall {
  switch (call.operation) {
    case "insert_blocks":
      return {
        operation: call.operation,
        input: { ...call.input, position: mapPosition(call.input.position, map) as BlockPosition },
      };
    case "update_block":
      return {
        operation: call.operation,
        input: { ...call.input, blockId: map(call.input.blockId) },
      } as OperationCall;
    case "move_blocks":
      return {
        operation: call.operation,
        input: {
          ...call.input,
          blockIds: call.input.blockIds.map(map),
          position: mapPosition(call.input.position, map) as BlockPosition,
        },
      };
    case "delete_blocks":
      return {
        operation: call.operation,
        input: { ...call.input, blockIds: call.input.blockIds.map(map) },
      };
  }
}
