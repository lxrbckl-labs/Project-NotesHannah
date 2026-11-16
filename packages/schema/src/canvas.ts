import { z } from "zod";
import { EXAMPLE_IDS } from "./blocks/registry.js";
import { normalizeRichText, type RichText, richText, richTextToPlain } from "./blocks/rich-text.js";
import { ColorToken } from "./blocks/tokens.js";
import { formatPath, type Problem } from "./blocks/validate.js";
import { Actor, Timestamp } from "./common.js";
import { BlockId, CardId, ConceptId, DocumentId, EdgeId, FrameId, idKind, newId } from "./ids.js";

/**
 * The canvas: a second view of a document (E1–E5). Cards show document
 * blocks, concepts, free notes or stickers; connectors join cards with a
 * labelled, typed line; frames group cards and can be stepped through like
 * slides.
 *
 * Editor-neutral and agent-friendly on purpose:
 * - Agents describe STRUCTURE only (which cards, which frame, how they
 *   connect). Nothing an agent sends carries coordinates; the app lays the
 *   canvas out automatically (see canvas-layout.ts).
 * - A card's `position` and `dimensions` are either null (auto-laid-out) or
 *   pinned by her, with who placed it and when. Only she pins.
 * - The pin rule, mirrored from blocks (D11): agent structure changes never
 *   move or resize a card she pinned, and never delete or change a card,
 *   connector or frame she created or edited (or a card she pinned), unless
 *   the agent acts on her request and passes its requestId.
 *
 * See docs/canvas.md.
 */

// ---------------------------------------------------------------------------
// Vocabulary.
// ---------------------------------------------------------------------------

export const CANVAS_LIMITS = {
  cards: 500,
  connectors: 1000,
  frames: 80,
  frameMembers: 200,
  /** Frames may nest: a frame inside a frame inside a frame, no deeper. */
  frameDepth: 3,
  blocksPerCard: 12,
  titleChars: 120,
  noteChars: 2000,
  labelChars: 80,
  conceptLabelChars: 120,
  opsPerCall: 200,
  /** Largest coordinate magnitude, in canvas units. */
  coordinate: 1_000_000,
  minCardSide: 40,
  maxCardSide: 4000,
} as const;

/** Original, simple sticker shapes drawn by the app. */
export const STICKERS = [
  "pin",
  "star",
  "eyes",
  "lightbulb",
  "warning",
  "heart",
  "question",
  "check",
  "arrow",
] as const;
export const Sticker = z.enum(STICKERS, {
  error: `Use a sticker from the set: ${STICKERS.join(", ")}.`,
});
export type Sticker = z.infer<typeof Sticker>;

/**
 * Width class of a card. "auto" lets the app choose from the content (a
 * short paragraph is small, a table wide). Heights always follow content.
 */
export const CARD_SIZES = ["auto", "small", "medium", "large", "wide"] as const;
export const CardSize = z.enum(CARD_SIZES, {
  error: `A card size is one of ${CARD_SIZES.join(", ")}. Heights follow the content.`,
});
export type CardSize = z.infer<typeof CardSize>;

/** What a connector says about the two cards it joins. */
export const CONNECTOR_KINDS = [
  "leads_to",
  "causes",
  "treats",
  "contrasts",
  "part_of",
  "related",
] as const;
export const ConnectorKind = z.enum(CONNECTOR_KINDS, {
  error: `A connector kind is one of ${CONNECTOR_KINDS.join(", ")}.`,
});
export type ConnectorKind = z.infer<typeof ConnectorKind>;

export const LINE_STYLES = ["solid", "dashed", "dotted"] as const;
export const LineStyle = z.enum(LINE_STYLES, {
  error: `A line style is one of ${LINE_STYLES.join(", ")}.`,
});
export type LineStyle = z.infer<typeof LineStyle>;

/** Default line style per kind, used when a connector names none. */
export const CONNECTOR_DEFAULT_LINE: Record<ConnectorKind, LineStyle> = {
  leads_to: "solid",
  causes: "solid",
  treats: "solid",
  contrasts: "dashed",
  part_of: "dotted",
  related: "dashed",
};

/** Which ends get an arrowhead: forward = at `to`. */
export const CONNECTOR_DIRECTIONS = ["forward", "backward", "both", "none"] as const;
export const ConnectorDirection = z.enum(CONNECTOR_DIRECTIONS, {
  error: `A direction is one of ${CONNECTOR_DIRECTIONS.join(", ")} ("forward" puts the arrowhead at "to").`,
});
export type ConnectorDirection = z.infer<typeof ConnectorDirection>;

/**
 * Who made a canvas item, which decides what an agent may change:
 * - "document": derived automatically from the document's blocks;
 * - "agent": written by an agent;
 * - "user": she made it, or edited it since (sticky, like blocks).
 */
export const CANVAS_ORIGINS = ["document", "agent", "user"] as const;
export const CanvasOrigin = z.enum(CANVAS_ORIGINS);
export type CanvasOrigin = z.infer<typeof CanvasOrigin>;

// ---------------------------------------------------------------------------
// Card content.
// ---------------------------------------------------------------------------

const title = z
  .string()
  .trim()
  .min(1, { error: "A title needs at least one character; leave it out instead." })
  .max(CANVAS_LIMITS.titleChars, {
    error: `Titles hold at most ${CANVAS_LIMITS.titleChars} characters.`,
  });

export const BlockCardContent = z.strictObject({
  kind: z.literal("block"),
  /** One or more blocks of the canvas's document, shown in this order. */
  blockIds: z
    .array(BlockId)
    .min(1, { error: "A block card shows at least one block." })
    .max(CANVAS_LIMITS.blocksPerCard, {
      error: `A card shows at most ${CANVAS_LIMITS.blocksPerCard} blocks; use several cards in a frame.`,
    }),
});

export const ConceptCardContent = z.strictObject({
  kind: z.literal("concept"),
  conceptId: ConceptId,
  /** How the card names the concept, e.g. "metoprolol". Defaults to the concept's name. */
  label: z.string().trim().min(1).max(CANVAS_LIMITS.conceptLabelChars).optional(),
});

export const NoteCardContent = z.strictObject({
  kind: z.literal("note"),
  /** Rich text or a plain string. */
  text: richText(CANVAS_LIMITS.noteChars),
});

export const StickerCardContent = z.strictObject({
  kind: z.literal("sticker"),
  sticker: Sticker,
});

export const CARD_KINDS = ["block", "concept", "note", "sticker"] as const;
export type CardKind = (typeof CARD_KINDS)[number];

export const CardContent = z
  .discriminatedUnion(
    "kind",
    [BlockCardContent, ConceptCardContent, NoteCardContent, StickerCardContent],
    {
      error: `Card content needs "kind": one of ${CARD_KINDS.join(", ")}. For example {"kind": "block", "blockIds": ["blk_…"]} or {"kind": "note", "text": "…"}.`,
    },
  )
  .meta({ id: "CardContent" });
export type CardContent = z.output<typeof CardContent>;

// ---------------------------------------------------------------------------
// Stored objects.
// ---------------------------------------------------------------------------

const coordinate = z.number().finite().min(-CANVAS_LIMITS.coordinate).max(CANVAS_LIMITS.coordinate);
const side = z.number().finite().min(CANVAS_LIMITS.minCardSide).max(CANVAS_LIMITS.maxCardSide);

/** Where she put a card (top-left corner, canvas units), and when. */
export const PinnedPosition = z.object({
  x: coordinate,
  y: coordinate,
  placedBy: Actor,
  placedAt: Timestamp,
});
export type PinnedPosition = z.infer<typeof PinnedPosition>;

/** The size she gave a card by resizing it. */
export const PinnedSize = z.object({
  width: side,
  height: side,
  placedBy: Actor,
  placedAt: Timestamp,
});
export type PinnedSize = z.infer<typeof PinnedSize>;

export const Card = z.object({
  id: CardId,
  content: CardContent,
  size: CardSize.default("auto"),
  color: ColorToken.optional(),
  title: title.optional(),
  origin: CanvasOrigin,
  /** null: the app lays it out. Set: she pinned it here. */
  position: PinnedPosition.nullable().default(null),
  /** null: size from the size class and content. Set: she resized it. */
  dimensions: PinnedSize.nullable().default(null),
});
export type Card = z.output<typeof Card>;

export const Connector = z.object({
  id: EdgeId,
  from: CardId,
  to: CardId,
  label: z.string().trim().min(1).max(CANVAS_LIMITS.labelChars).optional(),
  kind: ConnectorKind.default("related"),
  /** Defaults by kind (CONNECTOR_DEFAULT_LINE). */
  line: LineStyle.optional(),
  direction: ConnectorDirection.default("forward"),
  origin: CanvasOrigin,
});
export type Connector = z.output<typeof Connector>;

export const Frame = z.object({
  id: FrameId,
  title,
  /** Cards in this frame, in reading order. A card belongs to at most one frame. */
  members: z.array(CardId).max(CANVAS_LIMITS.frameMembers),
  /** The frame this one sits inside, if any. */
  parent: FrameId.optional(),
  color: ColorToken.optional(),
  /** Position in step-through (E5), from 0. */
  order: z.number().int().min(0),
  /** For a frame derived from a heading: that heading block. */
  headingBlockId: BlockId.optional(),
  origin: CanvasOrigin,
});
export type Frame = z.output<typeof Frame>;

/** One canvas per document. */
export const Canvas = z.object({
  documentId: DocumentId,
  /** Increases by one with every saved change. */
  revision: z.number().int().min(1),
  cards: z.array(Card).max(CANVAS_LIMITS.cards),
  connectors: z.array(Connector).max(CANVAS_LIMITS.connectors),
  frames: z.array(Frame).max(CANVAS_LIMITS.frames),
  /** The document's block IDs at the last merge, so later merges know what is new. */
  syncedBlockIds: z.array(BlockId),
  /** Whether a connector may join a card to itself. */
  allowSelfLinks: z.boolean().default(false),
  updatedAt: Timestamp,
});
export type Canvas = z.output<typeof Canvas>;

// ---------------------------------------------------------------------------
// Agent-facing structure inputs: no coordinates anywhere.
// ---------------------------------------------------------------------------

const LOCAL_REF = /^[a-z][a-z0-9_-]{0,39}$/;
const REF_HELP =
  'A reference is an existing ID ("crd_…" for cards, "frm_…" for frames) or a short local name you gave with "ref" in this same request, such as "mechanism" (lowercase letters, digits, "-" and "_").';

/** A short name an agent gives a new card or frame so other parts of the same request can point at it. */
export const LocalRef = z.string().regex(LOCAL_REF, {
  error: `A ref is a short lowercase name such as "mechanism" or "step-2": a letter first, then letters, digits, "-" or "_", at most 40 characters.`,
});

const cardRef = z.string().refine((v) => LOCAL_REF.test(v) || idKind(v) === "card", {
  error: `Expected a card reference. ${REF_HELP}`,
});
const frameRef = z.string().refine((v) => LOCAL_REF.test(v) || idKind(v) === "frame", {
  error: `Expected a frame reference. ${REF_HELP}`,
});

export const CardInput = z.strictObject({
  /** Your local name for a new card, used by connectors and frames in the same request. */
  ref: LocalRef.optional(),
  /** An existing card to keep or update. Leave out for a new card. */
  id: CardId.optional(),
  content: CardContent,
  size: CardSize.optional(),
  color: ColorToken.optional(),
  title: title.optional(),
});
export type CardInput = z.output<typeof CardInput>;

export const ConnectorInput = z.strictObject({
  /** An existing connector to keep or update. Leave out for a new one. */
  id: EdgeId.optional(),
  from: cardRef,
  to: cardRef,
  label: z.string().trim().min(1).max(CANVAS_LIMITS.labelChars).optional(),
  kind: ConnectorKind.optional(),
  line: LineStyle.optional(),
  direction: ConnectorDirection.optional(),
});
export type ConnectorInput = z.output<typeof ConnectorInput>;

export const FrameInput = z.strictObject({
  ref: LocalRef.optional(),
  id: FrameId.optional(),
  title,
  /** Cards in reading order, by ref or ID. */
  members: z.array(cardRef).max(CANVAS_LIMITS.frameMembers).default([]),
  parent: frameRef.optional(),
  color: ColorToken.optional(),
  /** Step-through position; defaults to the order frames are listed in. */
  order: z.number().int().min(0).optional(),
});
export type FrameInput = z.output<typeof FrameInput>;

const requestId = z
  .string()
  .regex(/^req_[0-9A-HJKMNP-TV-Z]{26}$/, { error: 'A request ID looks like "req_01HZX…".' })
  .optional()
  .meta({
    description:
      "The ID of her request this change answers. Needed to change or remove what she made, edited or pinned.",
  });
const expectedRevision = z.number().int().min(1).optional().meta({
  description: "Refuse with a conflict if the canvas has moved past this revision.",
});

/**
 * Replace the canvas structure in one go. Lists the whole intended
 * structure: what is left out is removed, except what she made, edited or
 * pinned (kept and reported as skipped). Cards showing the same blocks as
 * an existing card are matched to it automatically, so their placement
 * survives.
 */
export const SetCanvasStructureInput = z.strictObject({
  documentId: DocumentId,
  cards: z.array(CardInput).max(CANVAS_LIMITS.cards, {
    error: `A canvas holds at most ${CANVAS_LIMITS.cards} cards.`,
  }),
  connectors: z
    .array(ConnectorInput)
    .max(CANVAS_LIMITS.connectors, {
      error: `A canvas holds at most ${CANVAS_LIMITS.connectors} connectors.`,
    })
    .default([]),
  frames: z
    .array(FrameInput)
    .max(CANVAS_LIMITS.frames, { error: `A canvas holds at most ${CANVAS_LIMITS.frames} frames.` })
    .default([]),
  allowSelfLinks: z.boolean().optional(),
  requestId,
  expectedRevision,
});
export type SetCanvasStructureInput = z.output<typeof SetCanvasStructureInput>;

const nullableTitle = title.nullable();

/** Incremental structure operations, applied in order and all-or-nothing. */
export const CanvasOp = z.discriminatedUnion(
  "op",
  [
    z.strictObject({ op: z.literal("add_card"), card: CardInput.omit({ id: true }) }),
    z.strictObject({
      op: z.literal("update_card"),
      id: cardRef,
      patch: z.strictObject({
        content: CardContent.optional(),
        size: CardSize.optional(),
        color: ColorToken.nullable().optional(),
        title: nullableTitle.optional(),
      }),
    }),
    z.strictObject({ op: z.literal("remove_card"), id: cardRef }),
    z.strictObject({
      op: z.literal("add_connector"),
      connector: ConnectorInput.omit({ id: true }),
    }),
    z.strictObject({
      op: z.literal("update_connector"),
      id: EdgeId,
      patch: z.strictObject({
        label: z.string().trim().min(1).max(CANVAS_LIMITS.labelChars).nullable().optional(),
        kind: ConnectorKind.optional(),
        line: LineStyle.nullable().optional(),
        direction: ConnectorDirection.optional(),
        from: cardRef.optional(),
        to: cardRef.optional(),
      }),
    }),
    z.strictObject({ op: z.literal("remove_connector"), id: EdgeId }),
    z.strictObject({ op: z.literal("add_frame"), frame: FrameInput.omit({ id: true }) }),
    z.strictObject({
      op: z.literal("update_frame"),
      id: frameRef,
      patch: z.strictObject({
        title: title.optional(),
        color: ColorToken.nullable().optional(),
        order: z.number().int().min(0).optional(),
        parent: frameRef.nullable().optional(),
      }),
    }),
    z.strictObject({ op: z.literal("remove_frame"), id: frameRef }),
    /** Put cards into a frame (in this order, after its current members). A card leaves its old frame. */
    z.strictObject({
      op: z.literal("add_to_frame"),
      frame: frameRef,
      cards: z.array(cardRef).min(1).max(CANVAS_LIMITS.frameMembers),
    }),
    /** Take cards out of whatever frame holds them. */
    z.strictObject({
      op: z.literal("remove_from_frame"),
      cards: z.array(cardRef).min(1).max(CANVAS_LIMITS.frameMembers),
    }),
    /** Her placements: pins cards where she dropped or resized them. Not for agents. */
    z.strictObject({
      op: z.literal("place_cards"),
      placements: z
        .array(
          z.strictObject({
            id: cardRef,
            x: coordinate,
            y: coordinate,
            width: side.optional(),
            height: side.optional(),
          }),
        )
        .min(1)
        .max(CANVAS_LIMITS.cards),
    }),
    /** Hand cards back to automatic layout: all of them when `ids` is left out. Not for agents. */
    z.strictObject({
      op: z.literal("release_pins"),
      ids: z.array(cardRef).max(CANVAS_LIMITS.cards).optional(),
      /** Also forget sizes she gave cards. Default true. */
      sizes: z.boolean().optional(),
    }),
  ],
  { error: 'Each op needs a valid "op"; see the examples.' },
);
export type CanvasOp = z.output<typeof CanvasOp>;
export type CanvasOpName = CanvasOp["op"];

export const CANVAS_OP_NAMES = [
  "add_card",
  "update_card",
  "remove_card",
  "add_connector",
  "update_connector",
  "remove_connector",
  "add_frame",
  "update_frame",
  "remove_frame",
  "add_to_frame",
  "remove_from_frame",
  "place_cards",
  "release_pins",
] as const satisfies readonly CanvasOpName[];

/** Ops only she can make: agents describe structure, never placement. */
export const USER_ONLY_OPS: readonly CanvasOpName[] = ["place_cards", "release_pins"];

export const CanvasChangeInput = z.strictObject({
  documentId: DocumentId,
  ops: z
    .array(z.unknown())
    .min(1, { error: "Give at least one op." })
    .max(CANVAS_LIMITS.opsPerCall, {
      error: `At most ${CANVAS_LIMITS.opsPerCall} ops per call; split the change.`,
    }),
  requestId,
  expectedRevision,
});
export interface CanvasChange {
  documentId: string;
  ops: CanvasOp[];
  requestId?: string | undefined;
  expectedRevision?: number | undefined;
}

// ---------------------------------------------------------------------------
// Examples (shown in errors and in docs/canvas.md).
// ---------------------------------------------------------------------------

const exBlock2 = "blk_01J9Z8Y7X6W5V4T3S2R1Q0P9N9";
export const CANVAS_EXAMPLE_IDS = {
  document: EXAMPLE_IDS.document,
  block: EXAMPLE_IDS.block,
  block2: exBlock2,
  card: "crd_01J9Z8Y7X6W5V4T3S2R1Q0P9N8",
  edge: "edg_01J9Z8Y7X6W5V4T3S2R1Q0P9N8",
  frame: "frm_01J9Z8Y7X6W5V4T3S2R1Q0P9N8",
  concept: EXAMPLE_IDS.concept,
} as const;

export const CANVAS_EXAMPLES = {
  card: { ref: "mechanism", content: { kind: "block", blockIds: [EXAMPLE_IDS.block] } },
  noteCard: { ref: "tip", content: { kind: "note", text: "Think: -olol = beta blocker" } },
  conceptCard: {
    ref: "metoprolol",
    content: { kind: "concept", conceptId: EXAMPLE_IDS.concept, label: "metoprolol" },
  },
  stickerCard: { content: { kind: "sticker", sticker: "lightbulb" } },
  connector: { from: "mechanism", to: "effects", label: "lowers heart rate", kind: "causes" },
  frame: { ref: "mech", title: "Mechanism", members: ["mechanism", "effects"] },
  setStructure: {
    documentId: EXAMPLE_IDS.document,
    cards: [
      { ref: "mechanism", content: { kind: "block", blockIds: [EXAMPLE_IDS.block] } },
      { ref: "effects", content: { kind: "block", blockIds: [exBlock2] }, size: "wide" },
      {
        ref: "tip",
        content: { kind: "note", text: "Think: -olol = beta blocker" },
        color: "yellow",
      },
    ],
    connectors: [{ from: "mechanism", to: "effects", label: "lowers heart rate", kind: "causes" }],
    frames: [{ ref: "mech", title: "Mechanism", members: ["mechanism", "effects", "tip"] }],
  },
  change: {
    documentId: EXAMPLE_IDS.document,
    ops: [
      { op: "add_card", card: { ref: "tip", content: { kind: "note", text: "β1 = 1 heart" } } },
      {
        op: "add_connector",
        connector: { from: "tip", to: "crd_01J9Z8Y7X6W5V4T3S2R1Q0P9N8", kind: "related" },
      },
    ],
  },
} as const;

const OP_EXAMPLES: Record<CanvasOpName, unknown> = {
  add_card: { op: "add_card", card: CANVAS_EXAMPLES.noteCard },
  update_card: { op: "update_card", id: CANVAS_EXAMPLE_IDS.card, patch: { color: "yellow" } },
  remove_card: { op: "remove_card", id: CANVAS_EXAMPLE_IDS.card },
  add_connector: {
    op: "add_connector",
    connector: { from: CANVAS_EXAMPLE_IDS.card, to: "tip", kind: "leads_to", label: "then" },
  },
  update_connector: {
    op: "update_connector",
    id: CANVAS_EXAMPLE_IDS.edge,
    patch: { label: "treats", kind: "treats" },
  },
  remove_connector: { op: "remove_connector", id: CANVAS_EXAMPLE_IDS.edge },
  add_frame: {
    op: "add_frame",
    frame: { title: "Adverse effects", members: [CANVAS_EXAMPLE_IDS.card] },
  },
  update_frame: { op: "update_frame", id: CANVAS_EXAMPLE_IDS.frame, patch: { title: "Mechanism" } },
  remove_frame: { op: "remove_frame", id: CANVAS_EXAMPLE_IDS.frame },
  add_to_frame: {
    op: "add_to_frame",
    frame: CANVAS_EXAMPLE_IDS.frame,
    cards: [CANVAS_EXAMPLE_IDS.card],
  },
  remove_from_frame: { op: "remove_from_frame", cards: [CANVAS_EXAMPLE_IDS.card] },
  place_cards: {
    op: "place_cards",
    placements: [{ id: CANVAS_EXAMPLE_IDS.card, x: 120, y: 80 }],
  },
  release_pins: { op: "release_pins", ids: [CANVAS_EXAMPLE_IDS.card] },
};

/** A minimal valid op of each kind. */
export const CANVAS_OP_EXAMPLES: Readonly<Record<CanvasOpName, unknown>> = OP_EXAMPLES;

// ---------------------------------------------------------------------------
// Problems from zod issues.
// ---------------------------------------------------------------------------

type Issue = z.core.$ZodIssue;

function issueProblems(
  issue: Issue,
  base: PropertyKey[],
): Array<{ path: PropertyKey[]; message: string }> {
  const path = [...base, ...issue.path];
  if (issue.code === "invalid_union" && issue.errors.length > 0) {
    const branches = issue.errors.filter((b) => b.length > 0);
    if (branches.length === 0) return [{ path, message: issue.message }];
    const depth = (b: Issue[]) => Math.max(...b.map((i) => i.path.length));
    const best = branches.reduce((a, b) => (depth(b) > depth(a) ? b : a));
    if (depth(best) === 0) return [{ path, message: issue.message }];
    return best.flatMap((inner) => issueProblems(inner, path));
  }
  if (issue.code === "unrecognized_keys") {
    return issue.keys.map((key) => ({
      path: [...path, key],
      message:
        key === "x" || key === "y" || key === "position" || key === "width" || key === "height"
          ? `"${key}" is not accepted: agents describe structure and the app lays the canvas out. Use "size" (${CARD_SIZES.join(", ")}) to suggest a width class.`
          : `Unknown field "${key}" here. Check the spelling against the example.`,
    }));
  }
  if (issue.code === "invalid_type" && /received undefined/.test(issue.message)) {
    return [{ path, message: `Missing required field "${String(path[path.length - 1])}".` }];
  }
  return [{ path, message: issue.message }];
}

function zodToProblems(error: z.ZodError, prefix: string, example: unknown): Problem[] {
  return error.issues.flatMap((issue) =>
    issueProblems(issue, []).map((p) => ({
      path: formatPath(p.path, prefix),
      message: p.message,
      example,
    })),
  );
}

// ---------------------------------------------------------------------------
// Protection: the pin rule.
// ---------------------------------------------------------------------------

export type CanvasProtectionReason = "user_edited" | "pinned";

/** Why an agent may not change or remove a card, or null when it may. */
export function cardProtection(
  card: Pick<Card, "origin" | "position" | "dimensions">,
): CanvasProtectionReason | null {
  if (card.origin === "user") return "user_edited";
  if (card.position || card.dimensions) return "pinned";
  return null;
}

/** Why an agent may not change or remove a connector or frame, or null when it may. */
export function itemProtection(item: { origin: CanvasOrigin }): CanvasProtectionReason | null {
  return item.origin === "user" ? "user_edited" : null;
}

export function protectionMessage(what: string, reason: CanvasProtectionReason): string {
  const why =
    reason === "pinned"
      ? `She placed this ${what} by hand, so agents leave it alone.`
      : `She made or edited this ${what}, so agents leave it alone.`;
  return `${why} To change it anyway, act on a request from her that asks for this change and pass its requestId.`;
}

/** Whether a writer is an agent. Placement and pins are hers alone. */
function isAgent(writer: Actor): boolean {
  return writer.type === "agent";
}

// ---------------------------------------------------------------------------
// Validation of structure inputs.
// ---------------------------------------------------------------------------

export interface CanvasValidateContext {
  /** The current canvas, for references to existing cards and frames. */
  canvas?: Canvas | undefined;
  /** The document's block IDs; when given, block cards must name blocks in it. */
  documentBlockIds?: readonly string[] | undefined;
}

export type CanvasValidation<T> = { ok: true; value: T } | { ok: false; problems: Problem[] };

function blockProblems(
  content: CardContent,
  path: string,
  ctx: CanvasValidateContext,
  example: unknown,
): Problem[] {
  if (content.kind !== "block") return [];
  const out: Problem[] = [];
  const seen = new Set<string>();
  content.blockIds.forEach((id, i) => {
    if (seen.has(id)) {
      out.push({
        path: `${path}.content.blockIds[${i}]`,
        message: `Block "${id}" is listed twice on this card.`,
        example,
      });
    }
    seen.add(id);
    if (ctx.documentBlockIds && !ctx.documentBlockIds.includes(id)) {
      out.push({
        path: `${path}.content.blockIds[${i}]`,
        message: `Block "${id}" is not in this document. A block card shows blocks of the canvas's own document; list them with the document tools first.`,
        example,
      });
    }
  });
  return out;
}

/** Validate a set-structure body: shape, limits and every reference. */
export function validateSetStructure(
  input: unknown,
  ctx: CanvasValidateContext = {},
): CanvasValidation<SetCanvasStructureInput> {
  const example = CANVAS_EXAMPLES.setStructure;
  const parsed = SetCanvasStructureInput.safeParse(input);
  if (!parsed.success) return { ok: false, problems: zodToProblems(parsed.error, "$", example) };
  const value = parsed.data;
  const problems: Problem[] = [];

  if (ctx.canvas && value.documentId !== ctx.canvas.documentId) {
    problems.push({
      path: "$.documentId",
      message: `This canvas belongs to document "${ctx.canvas.documentId}", not "${value.documentId}".`,
      example,
    });
  }

  const existingCards = new Set(ctx.canvas?.cards.map((c) => c.id) ?? []);
  const existingFrames = new Set(ctx.canvas?.frames.map((f) => f.id) ?? []);
  const cardRefs = new Set<string>();
  const cardIds = new Set<string>();
  value.cards.forEach((card, i) => {
    const at = `$.cards[${i}]`;
    if (card.ref) {
      if (cardRefs.has(card.ref))
        problems.push({
          path: `${at}.ref`,
          message: `The ref "${card.ref}" is used by two cards; refs must be unique.`,
          example: CANVAS_EXAMPLES.card,
        });
      cardRefs.add(card.ref);
    }
    if (card.id) {
      if (!existingCards.has(card.id))
        problems.push({
          path: `${at}.id`,
          message: `No card "${card.id}" on this canvas. Give "id" only to keep an existing card; for a new card leave "id" out (use "ref" to name it).`,
          example: CANVAS_EXAMPLES.card,
        });
      if (cardIds.has(card.id))
        problems.push({
          path: `${at}.id`,
          message: `Card "${card.id}" is listed twice.`,
          example: CANVAS_EXAMPLES.card,
        });
      cardIds.add(card.id);
    }
    problems.push(...blockProblems(card.content, at, ctx, CANVAS_EXAMPLES.card));
  });

  // In a set-structure call the listed cards are the whole set, so an existing card
  // that is not listed is going away and cannot be referenced.
  const knownCard = (ref: string) => cardRefs.has(ref) || cardIds.has(ref);
  const cardHint = () =>
    cardRefs.size > 0 ? ` Refs in this request: ${[...cardRefs].slice(0, 20).join(", ")}.` : "";

  const allowSelf = value.allowSelfLinks ?? ctx.canvas?.allowSelfLinks ?? false;
  value.connectors.forEach((c, i) => {
    const at = `$.connectors[${i}]`;
    for (const end of ["from", "to"] as const) {
      if (!knownCard(c[end])) {
        problems.push({
          path: `${at}.${end}`,
          message: `"${c[end]}" is not a card in this structure. Each end of a connector names a card listed in "cards", by its "ref" or its "id".${cardHint()}`,
          example: CANVAS_EXAMPLES.connector,
        });
      }
    }
    if (c.from === c.to && !allowSelf) {
      problems.push({
        path: at,
        message: `This connector joins "${c.from}" to itself. Self-links are off for this canvas; join two different cards, or set "allowSelfLinks": true.`,
        example: CANVAS_EXAMPLES.connector,
      });
    }
  });

  const frameRefs = new Set<string>();
  const frameIds = new Set<string>();
  value.frames.forEach((f, i) => {
    if (f.ref) {
      if (frameRefs.has(f.ref))
        problems.push({
          path: `$.frames[${i}].ref`,
          message: `The ref "${f.ref}" is used by two frames.`,
          example: CANVAS_EXAMPLES.frame,
        });
      frameRefs.add(f.ref);
    }
    if (f.id) {
      if (!existingFrames.has(f.id))
        problems.push({
          path: `$.frames[${i}].id`,
          message: `No frame "${f.id}" on this canvas. Leave "id" out for a new frame.`,
          example: CANVAS_EXAMPLES.frame,
        });
      frameIds.add(f.id);
    }
  });
  const memberOf = new Map<string, number>();
  value.frames.forEach((f, i) => {
    const at = `$.frames[${i}]`;
    f.members.forEach((m, j) => {
      if (!knownCard(m)) {
        problems.push({
          path: `${at}.members[${j}]`,
          message: `"${m}" is not a card in this structure. Frame members name cards listed in "cards", by "ref" or "id".${cardHint()}`,
          example: CANVAS_EXAMPLES.frame,
        });
      }
      const other = memberOf.get(m);
      if (other !== undefined) {
        problems.push({
          path: `${at}.members[${j}]`,
          message: `Card "${m}" is already in frame ${other === i ? "this frame" : `$.frames[${other}]`}. A card belongs to one frame at most; nest frames with "parent" instead.`,
          example: CANVAS_EXAMPLES.frame,
        });
      } else memberOf.set(m, i);
    });
    if (f.parent !== undefined && !frameRefs.has(f.parent) && !frameIds.has(f.parent)) {
      problems.push({
        path: `${at}.parent`,
        message: `"${f.parent}" is not a frame in this structure. "parent" names another frame listed in "frames", by "ref" or "id".`,
        example: CANVAS_EXAMPLES.frame,
      });
    }
  });
  // Nesting: no cycles, bounded depth.
  const keyOf = (f: FrameInput, i: number) => f.id ?? f.ref ?? `#${i}`;
  const parentOf = new Map<string, string | undefined>();
  value.frames.forEach((f, i) => {
    parentOf.set(keyOf(f, i), f.parent);
  });
  value.frames.forEach((f, i) => {
    let depth = 1;
    let cur = f.parent;
    const seen = new Set([keyOf(f, i)]);
    while (cur !== undefined) {
      if (seen.has(cur)) {
        problems.push({
          path: `$.frames[${i}].parent`,
          message: "Frames nest in a loop; a frame cannot sit inside itself.",
          example: CANVAS_EXAMPLES.frame,
        });
        break;
      }
      seen.add(cur);
      depth += 1;
      cur = parentOf.get(cur);
    }
    if (depth > CANVAS_LIMITS.frameDepth) {
      problems.push({
        path: `$.frames[${i}].parent`,
        message: `Frames nest at most ${CANVAS_LIMITS.frameDepth} deep; this one is ${depth} deep.`,
        example: CANVAS_EXAMPLES.frame,
      });
    }
  });

  return problems.length > 0 ? { ok: false, problems } : { ok: true, value };
}

/** Parse each op with teaching errors (shape only; references are checked when applied). */
export function validateCanvasChange(input: unknown): CanvasValidation<CanvasChange> {
  const parsed = CanvasChangeInput.safeParse(input);
  if (!parsed.success)
    return { ok: false, problems: zodToProblems(parsed.error, "$", CANVAS_EXAMPLES.change) };
  const problems: Problem[] = [];
  const ops: CanvasOp[] = [];
  parsed.data.ops.forEach((raw, i) => {
    const at = `$.ops[${i}]`;
    const name =
      typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>).op : undefined;
    if (typeof name !== "string" || !(CANVAS_OP_NAMES as readonly string[]).includes(name)) {
      problems.push({
        path: `${at}.op`,
        message: `${name === undefined ? 'No "op" given.' : `Unknown op ${JSON.stringify(name)}.`} Valid ops: ${CANVAS_OP_NAMES.join(", ")}.`,
        example: OP_EXAMPLES.add_card,
      });
      return;
    }
    const result = CanvasOp.safeParse(raw);
    if (!result.success) {
      problems.push(...zodToProblems(result.error, at, OP_EXAMPLES[name as CanvasOpName]));
    } else ops.push(result.data);
  });
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    value: {
      documentId: parsed.data.documentId,
      ops,
      requestId: parsed.data.requestId,
      expectedRevision: parsed.data.expectedRevision,
    },
  };
}

// ---------------------------------------------------------------------------
// Applying changes.
// ---------------------------------------------------------------------------

export interface CanvasApplyContext {
  actor: Actor;
  /** Her request this change answers; lifts the pin rule for agents. */
  requestId?: string | undefined;
  now?: string | undefined;
  /** ID factory, for deterministic tests. */
  newId?: ((kind: "card" | "edge" | "frame") => string) | undefined;
  documentBlockIds?: readonly string[] | undefined;
}

export interface SkippedItem {
  id: string;
  type: "card" | "connector" | "frame";
  reason: CanvasProtectionReason;
  message: string;
}

export interface CanvasApplyReport {
  added: string[];
  updated: string[];
  removed: string[];
  skipped: SkippedItem[];
  /** Local refs given in the request, and the IDs they became. */
  refs: Record<string, string>;
}

export type CanvasApplyResult =
  | { ok: true; canvas: Canvas; report: CanvasApplyReport; changed: boolean }
  | { ok: false; problems: Problem[] };

function emptyReport(): CanvasApplyReport {
  return { added: [], updated: [], removed: [], skipped: [], refs: {} };
}

function idFactory(ctx: CanvasApplyContext) {
  return ctx.newId ?? ((kind: "card" | "edge" | "frame") => newId(kind));
}

function sameBlocks(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/** A key that identifies what a card shows, for matching agent cards to existing ones. */
function contentKey(content: CardContent): string {
  if (content.kind === "block") return `block:${content.blockIds.join(",")}`;
  if (content.kind === "concept") return `concept:${content.conceptId}`;
  if (content.kind === "note") return `note:${richTextToPlain(content.text)}`;
  return `sticker:${content.sticker}`;
}

/** JSON with sorted keys, so equal objects compare equal whatever their key order. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, (v as Record<string, unknown>)[k]]),
        )
      : v,
  );
}

function same(a: unknown, b: unknown): boolean {
  return stable(a) === stable(b);
}

function stripUndefined<T extends object>(value: T): T {
  const out = { ...value } as Record<string, unknown>;
  for (const key of Object.keys(out)) if (out[key] === undefined) delete out[key];
  return out as T;
}

function conflictProblem(canvas: Canvas, expected: number | undefined): Problem | null {
  if (expected === undefined || expected === canvas.revision) return null;
  return {
    path: "$.expectedRevision",
    message: `Conflict: the canvas is at revision ${canvas.revision}, not ${expected}. Read it again and resend your change against the current structure.`,
    example: { expectedRevision: canvas.revision },
  };
}

/** Remove cards from every frame and drop connectors that touch them. */
function dropCards(canvas: Canvas, ids: ReadonlySet<string>): void {
  canvas.cards = canvas.cards.filter((c) => !ids.has(c.id));
  canvas.connectors = canvas.connectors.filter((c) => !ids.has(c.from) && !ids.has(c.to));
  for (const f of canvas.frames) f.members = f.members.filter((m) => !ids.has(m));
}

/** Remove a frame: its cards are ungrouped into its parent, child frames move up. */
function dropFrame(canvas: Canvas, id: string): void {
  const frame = canvas.frames.find((f) => f.id === id);
  if (!frame) return;
  const parent = frame.parent ? canvas.frames.find((f) => f.id === frame.parent) : undefined;
  if (parent) parent.members.push(...frame.members);
  for (const f of canvas.frames) if (f.parent === id) f.parent = frame.parent;
  canvas.frames = canvas.frames.filter((f) => f.id !== id);
  renumberFrames(canvas);
}

function renumberFrames(canvas: Canvas): void {
  [...canvas.frames]
    .sort((a, b) => a.order - b.order)
    .forEach((f, i) => {
      f.order = i;
    });
}

function cloneCanvas(canvas: Canvas): Canvas {
  return structuredClone(canvas);
}

function finish(
  before: Canvas,
  after: Canvas,
  report: CanvasApplyReport,
  now: string,
): CanvasApplyResult {
  const changed = !same(
    { ...before, updatedAt: "", revision: 0 },
    { ...after, updatedAt: "", revision: 0 },
  );
  if (changed) {
    after.revision = before.revision + 1;
    after.updatedAt = now;
  }
  return { ok: true, canvas: changed ? after : before, report, changed };
}

/**
 * Apply a set-structure body. The listed structure becomes the canvas,
 * except that what she made, edited or pinned is kept (and reported as
 * skipped), pins are never touched, and cards showing the same blocks or
 * concept as an existing card are matched to it.
 */
export function applySetStructure(
  canvas: Canvas,
  input: unknown,
  ctx: CanvasApplyContext,
): CanvasApplyResult {
  const validation = validateSetStructure(input, {
    canvas,
    documentBlockIds: ctx.documentBlockIds,
  });
  if (!validation.ok) return validation;
  const value = validation.value;
  const conflict = conflictProblem(canvas, value.expectedRevision);
  if (conflict) return { ok: false, problems: [conflict] };

  const now = ctx.now ?? new Date().toISOString();
  const make = idFactory(ctx);
  const agent = isAgent(ctx.actor);
  const requestId = value.requestId ?? ctx.requestId;
  const origin: CanvasOrigin = agent ? "agent" : "user";
  const next = cloneCanvas(canvas);
  const report = emptyReport();
  const guarded = (reason: CanvasProtectionReason | null) => agent && !requestId && reason !== null;

  // Cards.
  const byId = new Map(next.cards.map((c) => [c.id, c]));
  const matched = new Set<string>();
  const refToId = new Map<string, string>();
  const keptCards: Card[] = [];
  for (const input of value.cards) {
    let existing = input.id ? byId.get(input.id) : undefined;
    if (!existing) {
      const key = contentKey(input.content);
      existing = next.cards.find((c) => !matched.has(c.id) && contentKey(c.content) === key);
    }
    if (existing) {
      matched.add(existing.id);
      if (input.ref) refToId.set(input.ref, existing.id);
      const reason = cardProtection(existing);
      const wanted = stripUndefined({
        ...existing,
        content: input.content,
        size: input.size ?? existing.size,
        color: input.color,
        title: input.title,
      });
      if (reason === "user_edited" && guarded(reason)) {
        if (!same(wanted, existing))
          report.skipped.push({
            id: existing.id,
            type: "card",
            reason,
            message: protectionMessage("card", reason),
          });
        keptCards.push(existing);
        continue;
      }
      // A pinned card may be re-described, but never resized by an agent.
      if (reason === "pinned" && guarded(reason)) wanted.size = existing.size;
      const changed = !same(wanted, existing);
      if (changed) {
        wanted.origin = agent ? (existing.origin === "user" ? "user" : "agent") : "user";
        report.updated.push(existing.id);
      }
      keptCards.push(changed ? wanted : existing);
    } else {
      const id = make("card");
      if (input.ref) refToId.set(input.ref, id);
      keptCards.push(
        stripUndefined({
          id,
          content: input.content,
          size: input.size ?? "auto",
          color: input.color,
          title: input.title,
          origin,
          position: null,
          dimensions: null,
        }),
      );
      report.added.push(id);
    }
  }
  const removedCards = new Set<string>();
  for (const card of next.cards) {
    if (matched.has(card.id)) continue;
    const reason = cardProtection(card);
    if (guarded(reason) && reason) {
      keptCards.push(card);
      report.skipped.push({
        id: card.id,
        type: "card",
        reason,
        message: protectionMessage("card", reason),
      });
    } else {
      removedCards.add(card.id);
      report.removed.push(card.id);
    }
  }
  next.cards = keptCards;
  const resolveCard = (ref: string) => refToId.get(ref) ?? ref;

  // Connectors.
  const edgeById = new Map(next.connectors.map((c) => [c.id, c]));
  const matchedEdges = new Set<string>();
  const connectors: Connector[] = [];
  for (const input of value.connectors) {
    const from = resolveCard(input.from);
    const to = resolveCard(input.to);
    const kind = input.kind ?? "related";
    let existing = input.id ? edgeById.get(input.id) : undefined;
    if (!existing)
      existing = next.connectors.find(
        (c) => !matchedEdges.has(c.id) && c.from === from && c.to === to && c.kind === kind,
      );
    const fields = stripUndefined({
      from,
      to,
      label: input.label,
      kind,
      line: input.line,
      direction: input.direction ?? "forward",
    });
    if (existing) {
      matchedEdges.add(existing.id);
      const reason = itemProtection(existing);
      const wanted = {
        ...stripUndefined({ ...existing, label: undefined, line: undefined }),
        ...fields,
      };
      if (guarded(reason) && reason) {
        if (!same(wanted, existing))
          report.skipped.push({
            id: existing.id,
            type: "connector",
            reason,
            message: protectionMessage("connector", reason),
          });
        connectors.push(existing);
        continue;
      }
      const changed = !same(wanted, existing);
      if (changed) {
        wanted.origin = agent ? "agent" : "user";
        report.updated.push(existing.id);
      }
      connectors.push(changed ? wanted : existing);
    } else {
      const id = make("edge");
      connectors.push({ id, ...fields, origin });
      report.added.push(id);
    }
  }
  for (const c of next.connectors) {
    if (matchedEdges.has(c.id)) continue;
    const reason = itemProtection(c);
    if (guarded(reason) && reason) {
      connectors.push(c);
      report.skipped.push({
        id: c.id,
        type: "connector",
        reason,
        message: protectionMessage("connector", reason),
      });
    } else report.removed.push(c.id);
  }
  next.connectors = connectors;

  // Frames.
  const frameById = new Map(next.frames.map((f) => [f.id, f]));
  const matchedFrames = new Set<string>();
  const frameRefToId = new Map<string, string>();
  const frames: Frame[] = [];
  const pendingParents: Array<{ frame: Frame; parent: string | undefined }> = [];
  value.frames.forEach((input, index) => {
    let existing = input.id ? frameById.get(input.id) : undefined;
    if (!existing)
      existing = next.frames.find(
        (f) => !matchedFrames.has(f.id) && f.title.toLowerCase() === input.title.toLowerCase(),
      );
    const members = input.members.map(resolveCard);
    if (existing) {
      matchedFrames.add(existing.id);
      if (input.ref) frameRefToId.set(input.ref, existing.id);
      const reason = itemProtection(existing);
      if (guarded(reason) && reason) {
        frames.push(existing);
        const wantedSame = existing.title === input.title && sameBlocks(existing.members, members);
        if (!wantedSame)
          report.skipped.push({
            id: existing.id,
            type: "frame",
            reason,
            message: protectionMessage("frame", reason),
          });
        return;
      }
      const wanted: Frame = stripUndefined({
        ...existing,
        title: input.title,
        members,
        color: input.color,
        order: input.order ?? index,
        parent: undefined,
      });
      pendingParents.push({ frame: wanted, parent: input.parent });
      frames.push(wanted);
    } else {
      const id = make("frame");
      if (input.ref) frameRefToId.set(input.ref, id);
      const frame: Frame = stripUndefined({
        id,
        title: input.title,
        members,
        color: input.color,
        order: input.order ?? index,
        origin,
      });
      pendingParents.push({ frame, parent: input.parent });
      frames.push(frame);
      report.added.push(id);
    }
  });
  for (const { frame, parent } of pendingParents) {
    if (parent !== undefined) frame.parent = frameRefToId.get(parent) ?? parent;
  }
  for (const f of next.frames) {
    if (matchedFrames.has(f.id)) continue;
    const reason = itemProtection(f);
    if (guarded(reason) && reason) {
      frames.push(f);
      report.skipped.push({
        id: f.id,
        type: "frame",
        reason,
        message: protectionMessage("frame", reason),
      });
    } else report.removed.push(f.id);
  }
  // A card stays in a protected frame rather than moving to a new one.
  const claimed = new Set<string>();
  const protectedFrames = frames.filter((f) => guarded(itemProtection(f)));
  for (const f of protectedFrames) for (const m of f.members) claimed.add(m);
  for (const f of frames) {
    if (protectedFrames.includes(f)) continue;
    f.members = f.members.filter((m) => {
      if (claimed.has(m)) return false;
      claimed.add(m);
      return true;
    });
  }
  const liveCards = new Set(next.cards.map((c) => c.id));
  const liveFrames = new Set(frames.map((f) => f.id));
  for (const f of frames) {
    f.members = f.members.filter((m) => liveCards.has(m));
    if (f.parent && !liveFrames.has(f.parent)) delete f.parent;
  }
  next.frames = frames;
  // Edit made in matched frames: mark origin and report.
  for (const f of next.frames) {
    const before = frameById.get(f.id);
    if (!before || report.added.includes(f.id)) continue;
    if (!same(before, f)) {
      if (!guarded(itemProtection(before))) {
        f.origin = agent ? (before.origin === "user" ? "user" : "agent") : "user";
        report.updated.push(f.id);
      }
    }
  }
  renumberFrames(next);
  dropCards(next, removedCards);
  next.connectors = next.connectors.filter((c) => liveCards.has(c.from) && liveCards.has(c.to));
  if (value.allowSelfLinks !== undefined) next.allowSelfLinks = value.allowSelfLinks;
  for (const [ref, id] of refToId) report.refs[ref] = id;
  for (const [ref, id] of frameRefToId) report.refs[ref] = id;
  return finish(canvas, next, report, now);
}

/**
 * Apply incremental ops in order, all or nothing. Agents may not place
 * cards or release pins; they may not change or remove what she made,
 * edited or pinned without a requestId. Her own edits mark items "user".
 */
export function applyCanvasChange(
  canvas: Canvas,
  input: unknown,
  ctx: CanvasApplyContext,
): CanvasApplyResult {
  const validation = validateCanvasChange(input);
  if (!validation.ok) return validation;
  const change = validation.value;
  const problems: Problem[] = [];
  if (change.documentId !== canvas.documentId) {
    problems.push({
      path: "$.documentId",
      message: `This canvas belongs to document "${canvas.documentId}", not "${change.documentId}".`,
      example: CANVAS_EXAMPLES.change,
    });
  }
  const conflict = conflictProblem(canvas, change.expectedRevision);
  if (conflict) problems.push(conflict);
  if (problems.length > 0) return { ok: false, problems };

  const now = ctx.now ?? new Date().toISOString();
  const make = idFactory(ctx);
  const agent = isAgent(ctx.actor);
  const requestId = change.requestId ?? ctx.requestId;
  const origin: CanvasOrigin = agent ? "agent" : "user";
  const editedOrigin = (before: CanvasOrigin): CanvasOrigin =>
    agent ? (before === "user" ? "user" : "agent") : "user";
  const next = cloneCanvas(canvas);
  const report = emptyReport();
  const refs = new Map<string, string>();

  change.ops.forEach((op, i) => {
    const at = `$.ops[${i}]`;
    const example = OP_EXAMPLES[op.op];
    const fail = (path: string, message: string) =>
      problems.push({ path: `${at}${path}`, message, example });
    const card = (ref: string, path: string) => {
      const id = refs.get(ref) ?? ref;
      const found = next.cards.find((c) => c.id === id);
      if (!found)
        fail(
          path,
          `No card "${ref}" on this canvas${refs.size ? ` (refs so far: ${[...refs.keys()].join(", ")})` : ""}. ${REF_HELP}`,
        );
      return found;
    };
    const frame = (ref: string, path: string) => {
      const id = refs.get(ref) ?? ref;
      const found = next.frames.find((f) => f.id === id);
      if (!found) fail(path, `No frame "${ref}" on this canvas. ${REF_HELP}`);
      return found;
    };
    const guard = (reason: CanvasProtectionReason | null, what: string): boolean => {
      if (agent && !requestId && reason) {
        fail("", protectionMessage(what, reason));
        return false;
      }
      return true;
    };
    const checkBlocks = (content: CardContent, path: string) => {
      for (const p of blockProblems(
        content,
        `${at}${path}`,
        { documentBlockIds: ctx.documentBlockIds },
        example,
      ))
        problems.push(p);
    };
    const register = (ref: string | undefined, id: string, path: string) => {
      if (!ref) return;
      if (refs.has(ref)) fail(path, `The ref "${ref}" is already used in this request.`);
      refs.set(ref, id);
      report.refs[ref] = id;
    };
    const frameDepthOk = (startParent: string | undefined, selfId: string, path: string) => {
      let depth = 1;
      let cur = startParent;
      while (cur) {
        if (cur === selfId) {
          fail(path, "Frames nest in a loop; a frame cannot sit inside itself.");
          return false;
        }
        depth += 1;
        cur = next.frames.find((f) => f.id === cur)?.parent;
      }
      if (depth > CANVAS_LIMITS.frameDepth) {
        fail(path, `Frames nest at most ${CANVAS_LIMITS.frameDepth} deep.`);
        return false;
      }
      return true;
    };
    const putInFrame = (target: Frame, ids: string[]) => {
      const set = new Set(ids);
      for (const f of next.frames) {
        if (f.id !== target.id) {
          const had = f.members.some((m) => set.has(m));
          if (had && agent && !requestId && itemProtection(f)) {
            fail(
              "",
              `A card here is in "${f.title}", a frame she arranged. ${protectionMessage("frame", "user_edited")}`,
            );
            return;
          }
          if (had) {
            f.members = f.members.filter((m) => !set.has(m));
            if (!agent) f.origin = "user";
          }
        }
      }
      target.members = [...target.members.filter((m) => !set.has(m)), ...ids];
      if (target.members.length > CANVAS_LIMITS.frameMembers)
        fail("", `A frame holds at most ${CANVAS_LIMITS.frameMembers} cards.`);
      target.origin = editedOrigin(target.origin);
    };

    if (agent && USER_ONLY_OPS.includes(op.op)) {
      fail(
        ".op",
        `"${op.op}" is hers alone. Agents describe structure (cards, connectors, frames) and the app lays the canvas out; cards she drags stay where she put them.`,
      );
      return;
    }

    switch (op.op) {
      case "add_card": {
        if (next.cards.length >= CANVAS_LIMITS.cards) {
          fail("", `A canvas holds at most ${CANVAS_LIMITS.cards} cards.`);
          return;
        }
        checkBlocks(op.card.content, ".card");
        const id = make("card");
        register(op.card.ref, id, ".card.ref");
        next.cards.push(
          stripUndefined({
            id,
            content: op.card.content,
            size: op.card.size ?? "auto",
            color: op.card.color,
            title: op.card.title,
            origin,
            position: null,
            dimensions: null,
          }),
        );
        report.added.push(id);
        return;
      }
      case "update_card": {
        const c = card(op.id, ".id");
        if (!c) return;
        const reason = cardProtection(c);
        if (reason === "user_edited" && !guard(reason, "card")) return;
        if (
          reason === "pinned" &&
          agent &&
          !requestId &&
          op.patch.size !== undefined &&
          op.patch.size !== c.size
        ) {
          fail(".patch.size", protectionMessage("card", "pinned"));
          return;
        }
        if (op.patch.content) {
          checkBlocks(op.patch.content, ".patch.content");
          c.content = op.patch.content;
        }
        if (op.patch.size) c.size = op.patch.size;
        if (op.patch.color === null) delete c.color;
        else if (op.patch.color) c.color = op.patch.color;
        if (op.patch.title === null) delete c.title;
        else if (op.patch.title) c.title = op.patch.title;
        c.origin = editedOrigin(c.origin);
        report.updated.push(c.id);
        return;
      }
      case "remove_card": {
        const c = card(op.id, ".id");
        if (!c || !guard(cardProtection(c), "card")) return;
        dropCards(next, new Set([c.id]));
        report.removed.push(c.id);
        return;
      }
      case "add_connector": {
        if (next.connectors.length >= CANVAS_LIMITS.connectors) {
          fail("", `A canvas holds at most ${CANVAS_LIMITS.connectors} connectors.`);
          return;
        }
        const from = card(op.connector.from, ".connector.from");
        const to = card(op.connector.to, ".connector.to");
        if (!from || !to) return;
        if (from.id === to.id && !next.allowSelfLinks) {
          fail(
            ".connector",
            "A connector joins two different cards; self-links are off for this canvas.",
          );
          return;
        }
        const id = make("edge");
        next.connectors.push(
          stripUndefined({
            id,
            from: from.id,
            to: to.id,
            label: op.connector.label,
            kind: op.connector.kind ?? "related",
            line: op.connector.line,
            direction: op.connector.direction ?? "forward",
            origin,
          }),
        );
        report.added.push(id);
        return;
      }
      case "update_connector": {
        const c = next.connectors.find((e) => e.id === op.id);
        if (!c) {
          fail(".id", `No connector "${op.id}" on this canvas.`);
          return;
        }
        if (!guard(itemProtection(c), "connector")) return;
        const p = op.patch;
        if (p.from) {
          const f = card(p.from, ".patch.from");
          if (!f) return;
          c.from = f.id;
        }
        if (p.to) {
          const t = card(p.to, ".patch.to");
          if (!t) return;
          c.to = t.id;
        }
        if (c.from === c.to && !next.allowSelfLinks) {
          fail(
            ".patch",
            "A connector joins two different cards; self-links are off for this canvas.",
          );
          return;
        }
        if (p.label === null) delete c.label;
        else if (p.label) c.label = p.label;
        if (p.kind) c.kind = p.kind;
        if (p.line === null) delete c.line;
        else if (p.line) c.line = p.line;
        if (p.direction) c.direction = p.direction;
        c.origin = editedOrigin(c.origin);
        report.updated.push(c.id);
        return;
      }
      case "remove_connector": {
        const c = next.connectors.find((e) => e.id === op.id);
        if (!c) {
          fail(".id", `No connector "${op.id}" on this canvas.`);
          return;
        }
        if (!guard(itemProtection(c), "connector")) return;
        next.connectors = next.connectors.filter((e) => e.id !== c.id);
        report.removed.push(c.id);
        return;
      }
      case "add_frame": {
        if (next.frames.length >= CANVAS_LIMITS.frames) {
          fail("", `A canvas holds at most ${CANVAS_LIMITS.frames} frames.`);
          return;
        }
        const id = make("frame");
        let parent: string | undefined;
        if (op.frame.parent !== undefined) {
          const p = frame(op.frame.parent, ".frame.parent");
          if (!p) return;
          parent = p.id;
          if (!frameDepthOk(parent, id, ".frame.parent")) return;
        }
        register(op.frame.ref, id, ".frame.ref");
        const created: Frame = stripUndefined({
          id,
          title: op.frame.title,
          members: [],
          parent,
          color: op.frame.color,
          order: op.frame.order ?? next.frames.length,
          origin,
        });
        next.frames.push(created);
        const ids: string[] = [];
        op.frame.members.forEach((m, j) => {
          const c = card(m, `.frame.members[${j}]`);
          if (c) ids.push(c.id);
        });
        if (ids.length) putInFrame(created, ids);
        created.origin = origin;
        if (op.frame.order !== undefined) {
          // Move it to the requested step, shifting the rest.
          const ordered = next.frames.filter((f) => f.id !== id).sort((a, b) => a.order - b.order);
          ordered.splice(Math.min(op.frame.order, ordered.length), 0, created);
          ordered.forEach((f, k) => {
            f.order = k;
          });
        }
        report.added.push(id);
        return;
      }
      case "update_frame": {
        const f = frame(op.id, ".id");
        if (!f || !guard(itemProtection(f), "frame")) return;
        const p = op.patch;
        if (p.title) f.title = p.title;
        if (p.color === null) delete f.color;
        else if (p.color) f.color = p.color;
        if (p.parent === null) delete f.parent;
        else if (p.parent !== undefined) {
          const parent = frame(p.parent, ".patch.parent");
          if (!parent) return;
          if (!frameDepthOk(parent.id, f.id, ".patch.parent")) return;
          f.parent = parent.id;
        }
        if (p.order !== undefined) {
          const ordered = next.frames
            .filter((x) => x.id !== f.id)
            .sort((a, b) => a.order - b.order);
          ordered.splice(Math.min(p.order, ordered.length), 0, f);
          ordered.forEach((x, k) => {
            x.order = k;
          });
        }
        f.origin = editedOrigin(f.origin);
        report.updated.push(f.id);
        return;
      }
      case "remove_frame": {
        const f = frame(op.id, ".id");
        if (!f || !guard(itemProtection(f), "frame")) return;
        dropFrame(next, f.id);
        report.removed.push(f.id);
        return;
      }
      case "add_to_frame": {
        const f = frame(op.frame, ".frame");
        if (!f || !guard(itemProtection(f), "frame")) return;
        const ids: string[] = [];
        op.cards.forEach((ref, j) => {
          const c = card(ref, `.cards[${j}]`);
          if (c) ids.push(c.id);
        });
        putInFrame(f, ids);
        report.updated.push(f.id);
        return;
      }
      case "remove_from_frame": {
        const ids = new Set<string>();
        op.cards.forEach((ref, j) => {
          const c = card(ref, `.cards[${j}]`);
          if (c) ids.add(c.id);
        });
        for (const f of next.frames) {
          if (!f.members.some((m) => ids.has(m))) continue;
          if (!guard(itemProtection(f), "frame")) return;
          f.members = f.members.filter((m) => !ids.has(m));
          f.origin = editedOrigin(f.origin);
          report.updated.push(f.id);
        }
        return;
      }
      case "place_cards": {
        op.placements.forEach((p, j) => {
          const c = card(p.id, `.placements[${j}].id`);
          if (!c) return;
          c.position = { x: p.x, y: p.y, placedBy: ctx.actor, placedAt: now };
          if (p.width !== undefined && p.height !== undefined)
            c.dimensions = { width: p.width, height: p.height, placedBy: ctx.actor, placedAt: now };
          report.updated.push(c.id);
        });
        return;
      }
      case "release_pins": {
        const ids = op.ids
          ? new Set(op.ids.map((ref, j) => card(ref, `.ids[${j}]`)?.id).filter(Boolean))
          : null;
        for (const c of next.cards) {
          if (ids && !ids.has(c.id)) continue;
          if (!c.position && !(op.sizes !== false && c.dimensions)) continue;
          c.position = null;
          if (op.sizes !== false) c.dimensions = null;
          report.updated.push(c.id);
        }
        return;
      }
    }
  });

  if (problems.length > 0) return { ok: false, problems };
  return finish(canvas, next, report, now);
}

// ---------------------------------------------------------------------------
// Derive from a document, and merge when its blocks change.
// ---------------------------------------------------------------------------

/** What the canvas needs to know about a block. */
export interface CanvasSourceBlock {
  id: string;
  type: string;
  content?: unknown;
}

function headingInfo(block: CanvasSourceBlock): { level: number; text: string } | null {
  if (block.type !== "heading") return null;
  const content = block.content as { level?: number; text?: string | RichText } | undefined;
  const text = content?.text === undefined ? "" : richTextToPlain(content.text);
  return {
    level: content?.level ?? 1,
    text: text.trim().slice(0, CANVAS_LIMITS.titleChars) || "Section",
  };
}

/** Block types that never become cards (they only structure the page). */
const NO_CARD_TYPES = new Set(["heading", "divider"]);

export interface DeriveOptions {
  now?: string | undefined;
  newId?: ((kind: "card" | "edge" | "frame") => string) | undefined;
}

/**
 * The canvas every document gets for free: headings become frames (nested
 * by level), every other block becomes one card in reading order, inside
 * the frame of the heading above it. Dividers are skipped. Nothing pinned.
 */
export function deriveCanvas(
  documentId: string,
  blocks: readonly CanvasSourceBlock[],
  options: DeriveOptions = {},
): Canvas {
  const now = options.now ?? new Date().toISOString();
  const empty: Canvas = {
    documentId,
    revision: 1,
    cards: [],
    connectors: [],
    frames: [],
    syncedBlockIds: [],
    allowSelfLinks: false,
    updatedAt: now,
  };
  return mergeDocumentBlocks(empty, blocks, { ...options, now, bumpRevision: false }).canvas;
}

export interface MergeResult {
  canvas: Canvas;
  changed: boolean;
  addedCards: string[];
  removedCards: string[];
  addedFrames: string[];
  removedFrames: string[];
}

/**
 * Bring a canvas up to date with its document's blocks. Blocks added since
 * the last merge appear as unpinned cards next to their neighbours in
 * reading order (new headings as frames); cards whose blocks were all
 * deleted disappear; everything else, pins included, is untouched.
 */
export function mergeDocumentBlocks(
  canvas: Canvas,
  blocks: readonly CanvasSourceBlock[],
  options: DeriveOptions & { bumpRevision?: boolean } = {},
): MergeResult {
  const now = options.now ?? new Date().toISOString();
  const make = options.newId ?? ((kind: "card" | "edge" | "frame") => newId(kind));
  const next = cloneCanvas(canvas);
  const current = new Set(blocks.map((b) => b.id));
  const synced = new Set(canvas.syncedBlockIds);
  const result: MergeResult = {
    canvas: next,
    changed: false,
    addedCards: [],
    removedCards: [],
    addedFrames: [],
    removedFrames: [],
  };

  // Deleted blocks.
  const gone = new Set([...synced].filter((id) => !current.has(id)));
  if (gone.size > 0) {
    const dead = new Set<string>();
    for (const card of next.cards) {
      if (card.content.kind !== "block") continue;
      const kept = card.content.blockIds.filter((id) => !gone.has(id));
      if (kept.length === 0) dead.add(card.id);
      else if (kept.length !== card.content.blockIds.length)
        card.content = { kind: "block", blockIds: kept };
    }
    dropCards(next, dead);
    result.removedCards.push(...dead);
    for (const frame of [...next.frames]) {
      if (frame.headingBlockId && gone.has(frame.headingBlockId)) {
        if (frame.origin === "document") {
          dropFrame(next, frame.id);
          result.removedFrames.push(frame.id);
        } else delete frame.headingBlockId;
      }
    }
  }

  // New blocks, in reading order.
  const cardOfBlock = new Map<string, Card>();
  for (const card of next.cards)
    if (card.content.kind === "block")
      for (const id of card.content.blockIds) cardOfBlock.set(id, card);
  const frameOfCard = (cardId: string) => next.frames.find((f) => f.members.includes(cardId));
  const frameOfHeading = new Map(
    next.frames.filter((f) => f.headingBlockId).map((f) => [f.headingBlockId as string, f]),
  );
  const stack: Array<{ level: number; frame: Frame }> = [];
  let currentFrame: Frame | undefined;
  let lastCard: string | undefined;

  for (const block of blocks) {
    const heading = headingInfo(block);
    const isNew = !synced.has(block.id);
    if (heading) {
      while (stack.length && (stack[stack.length - 1] as { level: number }).level >= heading.level)
        stack.pop();
      let frame = frameOfHeading.get(block.id);
      if (!frame && isNew) {
        const parent = stack[stack.length - 1]?.frame;
        let depth = 1;
        for (let p = parent; p; p = next.frames.find((f) => f.id === p?.parent)) depth += 1;
        frame = stripUndefined({
          id: make("frame"),
          title: heading.text,
          members: [],
          parent: depth <= CANVAS_LIMITS.frameDepth ? parent?.id : parent?.parent,
          order: next.frames.length,
          headingBlockId: block.id,
          origin: "document" as const,
        });
        if (next.frames.length < CANVAS_LIMITS.frames) {
          next.frames.push(frame);
          frameOfHeading.set(block.id, frame);
          result.addedFrames.push(frame.id);
        } else frame = undefined;
      }
      if (frame) {
        stack.push({ level: heading.level, frame });
        currentFrame = frame;
        lastCard = undefined;
      }
      continue;
    }
    const existing = cardOfBlock.get(block.id);
    if (existing) {
      currentFrame = frameOfCard(existing.id) ?? currentFrame;
      lastCard = existing.id;
      continue;
    }
    if (!isNew || NO_CARD_TYPES.has(block.type) || next.cards.length >= CANVAS_LIMITS.cards)
      continue;
    const card: Card = {
      id: make("card"),
      content: { kind: "block", blockIds: [block.id] },
      size: "auto",
      origin: "document",
      position: null,
      dimensions: null,
    };
    next.cards.push(card);
    cardOfBlock.set(block.id, card);
    result.addedCards.push(card.id);
    if (currentFrame && currentFrame.members.length < CANVAS_LIMITS.frameMembers) {
      const at = lastCard ? currentFrame.members.indexOf(lastCard) : -1;
      if (at >= 0) currentFrame.members.splice(at + 1, 0, card.id);
      else currentFrame.members.push(card.id);
    }
    lastCard = card.id;
  }

  // Frames with neither cards nor child frames carry nothing.
  for (const id of result.addedFrames) {
    const f = next.frames.find((x) => x.id === id);
    if (f && f.members.length === 0 && !next.frames.some((x) => x.parent === id)) {
      next.frames = next.frames.filter((x) => x.id !== id);
    }
  }
  result.addedFrames = result.addedFrames.filter((id) => next.frames.some((f) => f.id === id));
  renumberFramesByOrder(next);

  next.syncedBlockIds = blocks.map((b) => b.id);
  result.changed =
    result.addedCards.length +
      result.removedCards.length +
      result.addedFrames.length +
      result.removedFrames.length >
      0 || !sameBlocks(canvas.syncedBlockIds, next.syncedBlockIds);
  if (result.changed && options.bumpRevision !== false) {
    next.revision = canvas.revision + 1;
    next.updatedAt = now;
  }
  result.canvas = result.changed ? next : canvas;
  return result;
}

function renumberFramesByOrder(canvas: Canvas): void {
  renumberFrames(canvas);
}

// ---------------------------------------------------------------------------
// Read helpers.
// ---------------------------------------------------------------------------

/** Frames in step-through order. */
export function framesInOrder(canvas: Pick<Canvas, "frames">): Frame[] {
  return [...canvas.frames].sort((a, b) => a.order - b.order);
}

/** The frame holding a card, if any. */
export function frameOfCard(canvas: Pick<Canvas, "frames">, cardId: string): Frame | undefined {
  return canvas.frames.find((f) => f.members.includes(cardId));
}

/** Plain text of a note card, for previews and search. */
export function noteText(content: CardContent): string {
  return content.kind === "note" ? richTextToPlain(content.text) : "";
}

/** A note's text normalised, for building note content in the UI. */
export function noteContent(text: string): CardContent {
  return { kind: "note", text: normalizeRichText(text) };
}

/** Structural problems in a stored canvas (for tests and server integrity checks). */
export function canvasIntegrityProblems(canvas: Canvas): string[] {
  const out: string[] = [];
  const cards = new Set<string>();
  for (const c of canvas.cards) {
    if (cards.has(c.id)) out.push(`card ${c.id} appears twice`);
    cards.add(c.id);
  }
  for (const e of canvas.connectors) {
    if (!cards.has(e.from)) out.push(`connector ${e.id} starts at missing card ${e.from}`);
    if (!cards.has(e.to)) out.push(`connector ${e.id} ends at missing card ${e.to}`);
    if (e.from === e.to && !canvas.allowSelfLinks) out.push(`connector ${e.id} is a self-link`);
  }
  const frames = new Set(canvas.frames.map((f) => f.id));
  const seen = new Map<string, string>();
  for (const f of canvas.frames) {
    if (f.parent && !frames.has(f.parent)) out.push(`frame ${f.id} has missing parent ${f.parent}`);
    for (const m of f.members) {
      if (!cards.has(m)) out.push(`frame ${f.id} lists missing card ${m}`);
      const other = seen.get(m);
      if (other) out.push(`card ${m} is in frames ${other} and ${f.id}`);
      seen.set(m, f.id);
    }
  }
  const orders = canvas.frames.map((f) => f.order).sort((a, b) => a - b);
  if (orders.some((o, i) => o !== i)) out.push(`frame orders are not 0..n-1: ${orders.join(",")}`);
  return out;
}

/** Card sizes and the layout constraint pass (pure; the graph layout itself runs in the app). */
export * from "./canvas-layout.js";
