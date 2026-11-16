import {
  type Block,
  blockPlainText,
  type Canvas,
  type Card,
  type Connector,
  framesInOrder,
  noteText,
} from "@notes/schema";

const PREVIEW = 100;
const NAME = 40;

/** A card as an agent reads it: a short text preview, never coordinates. */
export interface AgentCard {
  id: string;
  kind: Card["content"]["kind"];
  /** The first words of what the card shows. */
  text: string;
  blockIds?: string[];
  size: Card["size"];
  color?: string;
  title?: string;
  /** She placed this card by hand: change it only on a request from her. */
  pinned: boolean;
  /** She made or edited this card: change it only on a request from her. */
  byHer: boolean;
}

export interface AgentFrame {
  id: string;
  title: string;
  order: number;
  parent?: string;
  color?: string;
  byHer: boolean;
  cards: AgentCard[];
}

export interface AgentConnector {
  id: string;
  /** "Mechanism -[lowers heart rate]-> Effects" */
  text: string;
  from: string;
  to: string;
  kind: Connector["kind"];
  byHer: boolean;
}

/** The canvas as an agent reads it (docs/canvas.md, `canvas_get`). */
export interface AgentCanvasView {
  documentId: string;
  title: string;
  revision: number;
  frames: AgentFrame[];
  /** Cards in no frame. */
  ungrouped: AgentCard[];
  connectors: AgentConnector[];
  rule: string;
}

export const AGENT_RULE =
  "Describe structure, never positions: she arranges the map. Cards, connectors and frames she made, edited or pinned (byHer or pinned) change only when you pass the requestId of a request of hers about this document.";

function shorten(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function cardText(card: Card, blocks: ReadonlyMap<string, Block>): string {
  const c = card.content;
  if (c.kind === "block") {
    return shorten(
      c.blockIds
        .map((id) => {
          const block = blocks.get(id);
          return block ? blockPlainText(block) : "";
        })
        .filter(Boolean)
        .join(" / "),
      PREVIEW,
    );
  }
  if (c.kind === "concept") return shorten(c.label ?? c.conceptId, PREVIEW);
  if (c.kind === "note") return shorten(noteText(c), PREVIEW);
  return c.sticker;
}

function agentCard(card: Card, blocks: ReadonlyMap<string, Block>): AgentCard {
  return {
    id: card.id,
    kind: card.content.kind,
    text: cardText(card, blocks),
    ...(card.content.kind === "block" ? { blockIds: card.content.blockIds } : {}),
    size: card.size,
    ...(card.color ? { color: card.color } : {}),
    ...(card.title ? { title: card.title } : {}),
    pinned: card.position !== null || card.dimensions !== null,
    byHer: card.origin === "user",
  };
}

const ARROWS = {
  forward: ["-[", "]->"],
  backward: ["<-[", "]-"],
  both: ["<-[", "]->"],
  none: ["-[", "]-"],
};

/** Render a canvas for an agent: frames with their cards as previews, connectors as "A -[label]-> B". */
export function renderForAgent(
  canvas: Canvas,
  title: string,
  blocks: readonly Block[],
): AgentCanvasView {
  const byBlock = new Map(blocks.map((b) => [b.id, b]));
  const cards = new Map(canvas.cards.map((c) => [c.id, c]));
  const name = (id: string): string => {
    const card = cards.get(id);
    return card ? shorten(card.title ?? cardText(card, byBlock), NAME) || id : id;
  };
  const inFrame = new Set(canvas.frames.flatMap((f) => f.members));
  return {
    documentId: canvas.documentId,
    title,
    revision: canvas.revision,
    frames: framesInOrder(canvas).map((f) => ({
      id: f.id,
      title: f.title,
      order: f.order,
      ...(f.parent ? { parent: f.parent } : {}),
      ...(f.color ? { color: f.color } : {}),
      byHer: f.origin === "user",
      cards: f.members.flatMap((id) => {
        const card = cards.get(id);
        return card ? [agentCard(card, byBlock)] : [];
      }),
    })),
    ungrouped: canvas.cards.filter((c) => !inFrame.has(c.id)).map((c) => agentCard(c, byBlock)),
    connectors: canvas.connectors.map((e) => {
      const [open, close] = ARROWS[e.direction];
      return {
        id: e.id,
        text: `${name(e.from)} ${open}${e.label ?? e.kind}${close} ${name(e.to)}`,
        from: e.from,
        to: e.to,
        kind: e.kind,
        byHer: e.origin === "user",
      };
    }),
    rule: AGENT_RULE,
  };
}

/** The whole structure with the coordinates replaced by `pinned: true | false`. */
export function withoutCoordinates(canvas: Canvas): unknown {
  return {
    ...canvas,
    cards: canvas.cards.map(({ position, dimensions, ...card }) => ({
      ...card,
      pinned: position !== null || dimensions !== null,
    })),
  };
}
