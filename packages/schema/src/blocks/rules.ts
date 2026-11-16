import type { Actor } from "../common.js";
import { newId } from "../ids.js";
import type { Origin } from "./common.js";
import {
  BLOCK_REGISTRY,
  BLOCK_TYPES,
  type Block,
  type BlockInput,
  type BlockIssue,
  blockParts,
  EXAMPLE_CITATION,
} from "./registry.js";

/**
 * The two standing rules on generated blocks:
 *
 * 1. Citation rule (K1, K4). A block an agent writes, of a type whose
 *    registry entry says `citationsRequired`, must carry at least one
 *    citation (on the block or on any of its fields) or be marked
 *    `generalKnowledge: true`. Structural types (heading, divider), study
 *    tasks (checklist), images of her own pages and question placeholders
 *    are exempt, and anything she writes herself is exempt.
 *
 * 2. Edit protection (D11). An agent may overwrite a block only when the
 *    block's `origin` is "agent" and she has not marked it reviewed. Her
 *    edits and her reviews are protected: regeneration skips those blocks
 *    and reports them. An agent may change a protected block only when
 *    acting on her explicit request, by naming that request's ID.
 */

/** Block types exempt from the citation rule. */
export const CITATION_EXEMPT_TYPES = BLOCK_TYPES.filter(
  (type) => !BLOCK_REGISTRY[type].citationsRequired,
);

/** Every citation on a block, block-level first, then each field's, in reading order. */
export function countCitations(block: BlockInput): number {
  let count = block.citations.length;
  for (const part of blockParts(block)) count += part.field?.citations.length ?? 0;
  return count;
}

/** Plain-language statement of the citation rule, used in errors and docs. */
export const CITATION_RULE_TEXT = `Generated blocks must say where they came from. Add at least one citation to "citations", each naming the fileId, the pageId and the exact passage quoted from that page's transcript (plus a region on the page when you know it). If it comes from a trusted outside reference (a guideline, PharmGuides), put that in "references" ({"title", "url"}) and it is labelled with the reference, apart from her sources. If it is from neither, set "generalKnowledge": true and it will be labelled "not from your notes". Exempt: ${CITATION_EXEMPT_TYPES.join(", ")}, and anything she writes herself.`;

/** The citation rule for one block, or null when it is satisfied. */
export function citationRuleIssue(block: BlockInput, origin: Origin): BlockIssue | null {
  if (origin === "user") return null;
  const entry = BLOCK_REGISTRY[block.type];
  if (!entry.citationsRequired) return null;
  // A block drawn from an outside reference says where it came from too, with its own label.
  if (block.generalKnowledge || countCitations(block) > 0 || (block.references?.length ?? 0) > 0)
    return null;
  return {
    path: ["citations"],
    message: `This ${entry.label.toLowerCase()} has no citation. ${CITATION_RULE_TEXT} Example citation: ${JSON.stringify(EXAMPLE_CITATION)}`,
  };
}

/** Why a block is protected from agent overwrites, or null when an agent may overwrite it. */
export type ProtectionReason = "user_edited" | "reviewed";

export function protectionReason(block: Pick<Block, "origin" | "review">): ProtectionReason | null {
  if (block.origin === "user") return "user_edited";
  if (block.review.status === "reviewed") return "reviewed";
  return null;
}

export type OverwriteDecision =
  | { allowed: true }
  | { allowed: false; reason: ProtectionReason; message: string };

/**
 * Whether an agent may replace, patch, move into regeneration, or delete this
 * block. Pass `requestId` only when she asked, through a request, for this
 * block to be changed (for example "this card is wrong").
 */
export function canAgentOverwrite(
  block: Pick<Block, "origin" | "review">,
  options: { requestId?: string | undefined } = {},
): OverwriteDecision {
  const reason = protectionReason(block);
  if (reason === null || options.requestId) return { allowed: true };
  const what =
    reason === "user_edited"
      ? "She wrote or edited this block, so agents leave it alone."
      : "She reviewed this block, so agents leave it alone.";
  return {
    allowed: false,
    reason,
    message: `${what} To change it anyway, act on a request from her that asks for this change and pass its requestId.`,
  };
}

/** Context for stamping server fields. */
export interface StampContext {
  actor: Actor;
  /** ISO timestamp; defaults to now. */
  now?: string;
  /** Block ID to use; defaults to a new one. */
  id?: string;
}

function originOf(actor: Actor): Origin {
  return actor.type === "user" ? "user" : "agent";
}

/**
 * Turn a writer's block into a stored block. Agent blocks start unverified;
 * blocks she writes herself start reviewed, since they are her own words.
 */
export function stampNewBlock(input: BlockInput, context: StampContext): Block {
  const now = context.now ?? new Date().toISOString();
  const origin = originOf(context.actor);
  return {
    ...input,
    id: context.id ?? newId("block"),
    origin,
    review:
      origin === "user"
        ? { status: "reviewed", reviewedAt: now }
        : { status: "unverified", reviewedAt: null },
    provenance: {
      createdBy: context.actor,
      createdAt: now,
      lastEditedBy: context.actor,
      lastEditedAt: now,
    },
  } as Block;
}

/**
 * Apply a writer's new version of an existing block. Keeps the ID and
 * creation record. Her edit makes the block "user" (protected); an agent
 * edit makes it "agent" and unverified again. Check `canAgentOverwrite`
 * before calling this for an agent.
 */
export function stampEditedBlock(existing: Block, input: BlockInput, context: StampContext): Block {
  const now = context.now ?? new Date().toISOString();
  const origin = originOf(context.actor);
  return {
    ...input,
    id: existing.id,
    origin,
    review:
      origin === "agent" ? { status: "unverified", reviewedAt: null } : { ...existing.review },
    provenance: {
      createdBy: existing.provenance.createdBy,
      createdAt: existing.provenance.createdAt,
      lastEditedBy: context.actor,
      lastEditedAt: now,
    },
  } as Block;
}

/** Mark a block reviewed (D10). Reviewing is not editing: origin and provenance stay. */
export function markReviewed(block: Block, now: string = new Date().toISOString()): Block {
  return { ...block, review: { status: "reviewed", reviewedAt: now } };
}

/** The writer's fields of a stored block, for editing and patching. */
export function blockToInput(block: Block): BlockInput {
  const { id: _id, origin: _origin, review: _review, provenance: _provenance, ...input } = block;
  return input as BlockInput;
}
