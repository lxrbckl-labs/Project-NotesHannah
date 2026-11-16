import {
  CANVAS_EXAMPLES,
  CANVAS_LIMITS,
  CANVAS_OP_EXAMPLES,
  CANVAS_OP_NAMES,
  CARD_KINDS,
  CARD_SIZES,
  CONNECTOR_DIRECTIONS,
  CONNECTOR_KINDS,
  DocumentId,
  LINE_STYLES,
  RequestId,
  STICKERS,
  USER_ONLY_OPS,
} from "@notes/schema";
import { z } from "zod";
import type { AgentCanvasView, AgentCard, CanvasPortResult } from "../../domains/canvas/index.js";
import { AppError } from "../../http/errors.js";
import { exampleId } from "../errors.js";
import { json } from "../format.js";
import type { CanvasToolPort } from "../ports.js";
import { describe, flattenActions, jsonOf } from "../schema.js";
import { defineTool, parseAction, type ToolContext } from "../tool.js";

const DOC = exampleId("document");

function port(ctx: ToolContext): CanvasToolPort {
  const p = ctx.backend.canvas;
  if (!p) throw new AppError("internal", "The study map is not available.");
  return p;
}

const Common = {
  requestId: RequestId.optional(),
  expectedRevision: z.number().int().min(1).optional(),
};

/**
 * What the tool itself checks: the action, the document and the top-level fields. Cards, connectors,
 * frames and ops go to the canvas validators, whose errors name the path and show a valid example.
 */
const BRANCHES = {
  get: z.strictObject({
    documentId: DocumentId,
    include: z.enum(["structure", "full"]).optional(),
  }),
  set_structure: z.strictObject({
    documentId: DocumentId,
    cards: z.array(z.unknown()).max(CANVAS_LIMITS.cards),
    connectors: z.array(z.unknown()).max(CANVAS_LIMITS.connectors).optional(),
    frames: z.array(z.unknown()).max(CANVAS_LIMITS.frames).optional(),
    allowSelfLinks: z.boolean().optional(),
    ...Common,
  }),
  change: z.strictObject({
    documentId: DocumentId,
    ops: z.array(z.unknown()).min(1).max(CANVAS_LIMITS.opsPerCall),
    ...Common,
  }),
};
type Action = keyof typeof BRANCHES;

/** As published: the fields of each item, so an agent sees the shape; the canvas validators decide. */
const CONTENT = z.looseObject({
  kind: z.enum(CARD_KINDS),
  blockIds: z.array(z.string()).optional(),
  conceptId: z.string().optional(),
  label: z.string().optional(),
  text: z.string().optional(),
  sticker: z.enum(STICKERS).optional(),
});
const PUBLISHED = {
  get: BRANCHES.get,
  set_structure: z.strictObject({
    documentId: DocumentId,
    cards: z.array(
      z.looseObject({
        ref: z.string().optional(),
        id: z.string().optional(),
        content: CONTENT,
        size: z.enum(CARD_SIZES).optional(),
        color: z.string().optional(),
        title: z.string().optional(),
      }),
    ),
    connectors: z
      .array(
        z.looseObject({
          id: z.string().optional(),
          from: z.string(),
          to: z.string(),
          label: z.string().optional(),
          kind: z.enum(CONNECTOR_KINDS).optional(),
          line: z.enum(LINE_STYLES).optional(),
          direction: z.enum(CONNECTOR_DIRECTIONS).optional(),
        }),
      )
      .optional(),
    frames: z
      .array(
        z.looseObject({
          ref: z.string().optional(),
          id: z.string().optional(),
          title: z.string(),
          members: z.array(z.string()).optional(),
          parent: z.string().optional(),
          color: z.string().optional(),
          order: z.number().int().optional(),
        }),
      )
      .optional(),
    allowSelfLinks: z.boolean().optional(),
    ...Common,
  }),
  change: z.strictObject({
    documentId: DocumentId,
    ops: z.array(z.looseObject({ op: z.enum(CANVAS_OP_NAMES) })).min(1),
    ...Common,
  }),
};

const EXAMPLES: Record<Action, Record<string, unknown>> = {
  get: { action: "get", documentId: DOC },
  set_structure: { action: "set_structure", ...CANVAS_EXAMPLES.setStructure },
  change: { action: "change", ...CANVAS_EXAMPLES.change },
};

const REQUEST_RULE =
  "She made, edited or pinned some of this map, so you leave it alone. Only a request of hers about the WHOLE document, claimed by your key (requests claim), lifts that: pass its ID as requestId. Otherwise add your own cards, connectors and frames next to hers.";

const count = (ids: string[], prefix: string) => ids.filter((id) => id.startsWith(prefix)).length;
function tally(ids: string[]): string {
  const parts = [
    ["card", "crd_"],
    ["connector", "edg_"],
    ["frame", "frm_"],
  ]
    .map(([name, prefix]) => {
      const n = count(ids, prefix as string);
      return n > 0 ? `${n} ${name}${n === 1 ? "" : "s"}` : "";
    })
    .filter(Boolean);
  return parts.join(", ");
}

function cardLine(c: AgentCard): string {
  const flags = [c.pinned ? "pinned by her" : "", c.byHer ? "hers" : ""].filter(Boolean);
  const what =
    c.kind === "block"
      ? `block ${(c.blockIds ?? []).join("+")}`
      : c.kind === "sticker"
        ? "sticker"
        : c.kind;
  return `- ${c.id} ${what}${c.title ? ` "${c.title}"` : ""} "${c.text}"${c.size !== "auto" ? ` [${c.size}]` : ""}${flags.length ? ` (${flags.join(", ")})` : ""}`;
}

/** The map as an agent reads it: frames with their cards, then loose cards, then connectors. */
export function renderMap(view: AgentCanvasView): string {
  const lines = [
    `Study map of "${view.title}" (${view.documentId}), revision ${view.revision}: ${view.frames.length} frame(s), ${
      view.frames.reduce((n, f) => n + f.cards.length, 0) + view.ungrouped.length
    } card(s), ${view.connectors.length} connector(s).`,
  ];
  for (const f of view.frames) {
    lines.push(
      `Frame "${f.title}" (${f.id})${f.parent ? ` inside ${f.parent}` : ""}${f.byHer ? " (hers)" : ""}:`,
      ...f.cards.map((c) => `  ${cardLine(c)}`),
    );
    if (f.cards.length === 0) lines.push("  (empty)");
  }
  if (view.ungrouped.length) {
    lines.push("Cards in no frame:", ...view.ungrouped.map((c) => `  ${cardLine(c)}`));
  }
  if (view.connectors.length) {
    lines.push(
      "Connectors:",
      ...view.connectors.map((e) => `- ${e.id} ${e.text}${e.byHer ? " (hers)" : ""}`),
    );
  }
  lines.push(view.rule);
  return lines.join("\n");
}

/** A refused write as the tool error: every problem with its path, and a valid example. */
function refusal(result: Extract<CanvasPortResult, { ok: false }>, action: Action): AppError {
  const shown = result.problems.slice(0, 6);
  const text = shown.map((p) => `${p.path}: ${p.message}`).join(" | ");
  const more =
    result.problems.length > shown.length
      ? ` (and ${result.problems.length - shown.length} more)`
      : "";
  const example = shown.find((p) => p.example !== undefined)?.example ?? EXAMPLES[action];
  switch (result.kind) {
    case "protected":
      return new AppError(
        "forbidden",
        `The study map keeps what she made or pinned: ${text}${more}`,
        {
          hint: REQUEST_RULE,
          example,
        },
      );
    case "forbidden":
      return new AppError("forbidden", `${text}${more}`, {
        hint: `Placing, releasing and inserting are hers alone (${USER_ONLY_OPS.join(", ")}). You describe the structure; the app lays it out and her drags stay put. Never send coordinates.`,
        example,
      });
    case "conflict":
      return new AppError("conflict", `${text}${more}`, {
        hint: 'The map moved on since you read it. Read it again with study_map {"action":"get"}, check your change still makes sense, and resend with the new revision.',
      });
    default:
      return new AppError("invalid_input", `Invalid study map input: ${text}${more}`, {
        hint: 'Fix each path named and send again; the example is a valid value for the first one. Shapes of every op and card: start_here {"topic":"study_map"}.',
        example,
      });
  }
}

function success(
  verb: string,
  result: Extract<CanvasPortResult, { ok: true }>,
): { text: string; structured: Record<string, unknown> } {
  const r = result.report;
  const bits = [
    r.added.length ? `added ${tally(r.added)}` : "",
    r.updated.length ? `changed ${tally(r.updated)}` : "",
    r.removed.length ? `removed ${tally(r.removed)}` : "",
  ].filter(Boolean);
  const lines = [
    result.changed
      ? `${verb} the study map (revision ${result.revision}): ${bits.join("; ") || "no visible change"}.`
      : `The study map already looked like this (revision ${result.revision}); nothing changed.`,
  ];
  const refs = Object.entries(r.refs);
  if (refs.length)
    lines.push(`Your refs became: ${refs.map(([k, v]) => `${k} = ${v}`).join(", ")}.`);
  if (r.skipped.length) {
    lines.push(
      `Left ${r.skipped.length} item(s) alone because she made, edited or pinned them: ${r.skipped
        .slice(0, 8)
        .map(
          (s) => `${s.id} (${s.reason === "pinned" ? "pinned by her" : "made or edited by her"})`,
        )
        .join(", ")}. ${REQUEST_RULE}`,
    );
  }
  lines.push(
    'See it with study_map {"action":"get"}. The app lays the cards out; you set no positions.',
  );
  return { text: lines.join("\n"), structured: { ...result } };
}

export const studyMap = defineTool({
  name: "study_map",
  title: "A document's study map: read it, arrange it",
  description: `Every document has a study map, a second view she can open: its blocks as cards on a canvas, grouped in frames, joined by labelled connectors. You describe the STRUCTURE and the app lays it out; she can drag cards and what she places stays where she put it. Actions: "get" the map (frames with their cards as short previews, connectors as "A -[label]-> B", which items are hers or pinned); "set_structure" the whole intended map in one call (cards that show blocks by blockIds, concepts, notes or stickers; connectors between cards with a label and kind; frames with ordered members; cards get a short "ref" that connectors and frames use; sending the same body twice changes nothing); "change" it with incremental ops (add_card, add_connector, add_frame, add_to_frame, update_* and remove_*; all or nothing). Never send coordinates. Cards, connectors and frames she made, edited or pinned are left alone (reported as skipped; an op on them is refused) unless you pass the requestId of her request about the whole document, claimed by you. Shapes and examples: start_here {"topic":"study_map"}.`,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  inputSchema: describe(
    flattenActions(
      "action",
      Object.fromEntries(Object.entries(PUBLISHED).map(([k, v]) => [k, jsonOf(v)])),
      '"get" the map; "set_structure" the whole map; "change" it with ops.',
    ),
    {
      documentId: `The document (doc_…), e.g. "${DOC}"; get_item on a lecture shows its document ID.`,
      include: 'get: "full" also returns the whole structure as JSON (no coordinates).',
      cards:
        "set_structure: every card the map should have. A card showing the same blocks (or concept, or note text) as an existing one IS that card. What you leave out is removed, except what she made or pinned.",
      "cards[].ref":
        "A short local name (lowercase, digits, - or _) that connectors and frames use.",
      "cards[].id": "An existing card (crd_…) to keep or update; leave out for a new one.",
      "cards[].content":
        'What it shows: {"kind":"block","blockIds":["blk_…"]} (1 to 12 blocks of this document), {"kind":"concept","conceptId":"con_…","label"?}, {"kind":"note","text"} or {"kind":"sticker","sticker"}.',
      "cards[].content.kind": 'One of "block", "concept", "note", "sticker".',
      "cards[].content.blockIds": 'kind "block": the blocks of this document, e.g. ["blk_…"].',
      "cards[].content.conceptId": 'kind "concept": the concept, con_….',
      "cards[].content.label": 'kind "concept": how the card names it (optional).',
      "cards[].content.text": 'kind "note": your note, plain text up to 2000 characters.',
      "cards[].content.sticker": `kind "sticker": one of ${STICKERS.join(", ")}.`,
      "cards[].size": "A width class: auto (default), small, medium, large, wide. Not pixels.",
      "cards[].color":
        "A colour token: gray, red, orange, yellow, green, teal, blue, purple or pink.",
      "cards[].title": "An optional heading shown on the card, up to 120 characters.",
      connectors:
        "set_structure: the labelled lines between cards, e.g. [{from, to, label, kind}]. Both ends are cards of this request (by ref) or existing cards (crd_…).",
      "connectors[].id": "An existing connector (edg_…) to keep or update.",
      "connectors[].from": "The card it starts at: a ref or crd_… ID.",
      "connectors[].to": "The card it points to: a ref or crd_… ID.",
      "connectors[].label": 'What the line says, e.g. "lowers heart rate" (up to 80 characters).',
      "connectors[].kind": `${CONNECTOR_KINDS.join(", ")} (default related); sets the colour and line style.`,
      "connectors[].line": "solid, dashed or dotted (default follows kind).",
      "connectors[].direction": "forward (default), backward, both or none.",
      frames:
        "set_structure: groups of cards, in step-through order, e.g. [{title, members: [refs]}]. A card is in at most one frame.",
      "frames[].ref": "A short local name other frames can use as parent.",
      "frames[].id": "An existing frame (frm_…) to keep or update.",
      "frames[].title": 'The frame\'s title, e.g. "Mechanism" (up to 120 characters).',
      "frames[].members": "Its cards in reading order, by ref or crd_… ID.",
      "frames[].parent": "A frame (ref or frm_…) this one sits inside; at most three levels.",
      "frames[].color": "A colour token.",
      "frames[].order": "Step-through position (default: the order listed).",
      allowSelfLinks: "set_structure: allow a connector from a card to itself (default false).",
      ops: `change: operations applied in order, all or nothing; later ops can use refs from earlier ones. Each is {"op": one of ${CANVAS_OP_NAMES.filter((o) => !USER_ONLY_OPS.includes(o)).join(", ")}, ...its fields}; start_here {"topic":"study_map"} shows each. place_cards, release_pins and insert_items are hers alone.`,
      "ops[].op": "The operation name.",
      requestId:
        "set_structure, change: the ID of her request about this whole document, claimed by you; needed only to change what she made, edited or pinned.",
      expectedRevision:
        "set_structure, change: refuse with a conflict if the map has moved past this revision (from get).",
    },
  ),
  parse: (raw) => parseAction("study_map", "action", BRANCHES, EXAMPLES, raw),
  writes: (input) => (input as { action: string }).action !== "get",
  action: (input) => (input as { action: string }).action,
  run(ctx, input) {
    const p = port(ctx);
    const { action, value } = input as unknown as {
      action: Action;
      value: { documentId: string; include?: "structure" | "full"; [k: string]: unknown };
    };
    const { documentId } = value;
    if (action === "get") {
      const view = p.get(ctx.auth, documentId, { include: value.include });
      const text = renderMap(view);
      return {
        text:
          value.include === "full"
            ? `${text}\nFull structure (no coordinates):\n${json((view as { structure?: unknown }).structure)}`
            : text,
        structured: { ...view },
      };
    }
    // A writing claim another agent holds on the document's node covers its map too.
    const doc = ctx.backend.documents?.getDocument(ctx.auth, documentId, { offset: 0, limit: 1 });
    if (doc) ctx.claims.assertFree(ctx.userId, [doc.document.nodeId], ctx.keyId);
    const result =
      action === "set_structure" ? p.setStructure(ctx.auth, value) : p.change(ctx.auth, value);
    if (!result.ok) throw refusal(result, action);
    return success(action === "set_structure" ? "Set" : "Changed", result);
  },
});

/** The shape examples for start_here's study_map topic. */
export function studyMapGuide(): string {
  const ops = CANVAS_OP_NAMES.filter((o) => !USER_ONLY_OPS.includes(o))
    .map((o) => `- ${json(CANVAS_OP_EXAMPLES[o])}`)
    .join("\n");
  return [
    "The study map is a second view of a document: its blocks as cards on a canvas, grouped in frames, joined by labelled connectors. She opens it next to the page view. Every document has one: headings became frames and every other block a card.",
    "You describe STRUCTURE and never positions: the app lays the cards out (and re-lays them as the document changes), and anything she drags is pinned where she put it. Cards point at blocks (never copies), so the page stays the one source of truth.",
    'study_map {"action":"get","documentId":"doc_…"} reads it: frames with their cards as short previews (and the block IDs), connectors as "A -[label]-> B", and which items are hers or pinned.',
    `Set the whole map (what you leave out is removed, except what she made or pinned; the same body twice changes nothing):\nstudy_map ${json(EXAMPLES.set_structure)}`,
    `Or change it step by step (all or nothing; later ops can use refs from earlier ones):\nstudy_map ${json(EXAMPLES.change)}`,
    `Cards: block (1 to 12 blockIds of this document), concept (conceptId, label), note (text) or sticker (${STICKERS.join(", ")}); optional size (${CARD_SIZES.join(", ")}), color, title. Connector kinds: ${CONNECTOR_KINDS.join(", ")}; give every connector a label that says the relation in a few words. Frames hold cards in reading order and can nest three deep. Limits: ${CANVAS_LIMITS.cards} cards, ${CANVAS_LIMITS.connectors} connectors, ${CANVAS_LIMITS.frames} frames, ${CANVAS_LIMITS.opsPerCall} ops a call.`,
    `Ops (${CANVAS_OP_NAMES.filter((o) => !USER_ONLY_OPS.includes(o)).join(", ")}), each with a minimal example:\n${ops}`,
    `The pin rule: cards she pinned or edited, and connectors and frames she made or edited, are never moved, changed or removed by you. set_structure keeps them and lists them as skipped; an op on one is refused as forbidden. Only a request of hers about the whole document, claimed by your key, lifts this: pass its requestId. ${USER_ONLY_OPS.join(", ")} are hers alone. A refused field names its path with a valid example: fix it and send again.`,
  ].join("\n\n");
}
