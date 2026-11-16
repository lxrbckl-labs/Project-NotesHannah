import {
  type Block,
  CARD_MAX_HEIGHT,
  CARD_WIDTHS,
  type Canvas,
  type Card,
  type CardSize,
  type Connector,
  cardSizeClass,
  type Frame,
  type LayoutResult,
  STICKER_SIZE,
} from "@notes/schema";
import type { Edge, Node } from "@xyflow/react";

/** Turns the canvas and its layout into React Flow nodes and edges. */

export interface CardNodeData extends Record<string, unknown> {
  card: Card;
  blocks: Block[];
  sizeClass: Exclude<CardSize, "auto">;
  maxHeight: number;
  pinned: boolean;
  reading: boolean;
  editing: boolean;
  connectSource: boolean;
  dim: boolean;
}

export interface FrameNodeData extends Record<string, unknown> {
  frame: Frame;
  step: number;
  depth: number;
  active: boolean;
  dim: boolean;
  dropTarget: boolean;
  count: number;
}

export interface ConnectorEdgeData extends Record<string, unknown> {
  connector: Connector;
  dim: boolean;
}

export type CardNode = Node<CardNodeData, "card">;
export type FrameNode = Node<FrameNodeData, "frame">;
export type CanvasNode = CardNode | FrameNode;
export type ConnectorEdge = Edge<ConnectorEdgeData, "connector">;

export interface ViewState {
  readingId: string | null;
  editingId: string | null;
  connectSourceId: string | null;
  /** Frames (and their descendants) in focus; everything else is dimmed. Null: no focus. */
  focus: Set<string> | null;
  dropFrameId: string | null;
  selected: ReadonlySet<string>;
}

function frameDepths(canvas: Canvas): Map<string, number> {
  const byId = new Map(canvas.frames.map((f) => [f.id, f]));
  const depth = new Map<string, number>();
  for (const f of canvas.frames) {
    let d = 0;
    let cur = f.parent ? byId.get(f.parent) : undefined;
    while (cur && d < 10) {
      d += 1;
      cur = cur.parent ? byId.get(cur.parent) : undefined;
    }
    depth.set(f.id, d);
  }
  return depth;
}

/** A frame and every frame inside it. */
export function frameFamily(canvas: Canvas, frameId: string): Set<string> {
  const out = new Set([frameId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of canvas.frames)
      if (f.parent && out.has(f.parent) && !out.has(f.id)) {
        out.add(f.id);
        grew = true;
      }
  }
  return out;
}

function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every(
    (k) =>
      a[k] === b[k] ||
      (Array.isArray(a[k]) &&
        Array.isArray(b[k]) &&
        sameArray(a[k] as unknown[], b[k] as unknown[])),
  );
}

function sameArray(a: unknown[], b: unknown[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Card identity that survives canvas clones: same JSON, same object. */
const cardCache = new Map<string, { json: string; card: Card }>();
function stableCard(card: Card): Card {
  const json = JSON.stringify(card);
  const hit = cardCache.get(card.id);
  if (hit && hit.json === json) return hit.card;
  cardCache.set(card.id, { json, card });
  return card;
}
const frameCache = new Map<string, { json: string; frame: Frame }>();
function stableFrame(frame: Frame): Frame {
  const json = JSON.stringify(frame);
  const hit = frameCache.get(frame.id);
  if (hit && hit.json === json) return hit.frame;
  frameCache.set(frame.id, { json, frame });
  return frame;
}
const edgeCache = new Map<string, { json: string; connector: Connector }>();
function stableConnector(c: Connector): Connector {
  const json = JSON.stringify(c);
  const hit = edgeCache.get(c.id);
  if (hit && hit.json === json) return hit.connector;
  edgeCache.set(c.id, { json, connector: c });
  return c;
}

export function cardWidth(card: Card, blocks: ReadonlyMap<string, Block>): number {
  if (card.dimensions) return card.dimensions.width;
  if (card.content.kind === "sticker") return STICKER_SIZE.width;
  return CARD_WIDTHS[cardSizeClass(card, blocks)];
}

export function buildNodes(
  canvas: Canvas,
  layout: LayoutResult,
  blocks: ReadonlyMap<string, Block>,
  view: ViewState,
  previous: ReadonlyMap<string, CanvasNode>,
): CanvasNode[] {
  const depths = frameDepths(canvas);
  const ordered = [...canvas.frames].sort((a, b) => a.order - b.order);
  const step = new Map(ordered.map((f, i) => [f.id, i + 1]));
  const frameOfCard = new Map<string, string>();
  for (const f of canvas.frames) for (const m of f.members) frameOfCard.set(m, f.id);
  const nodes: CanvasNode[] = [];
  const reuse = <T extends CanvasNode>(next: T): T => {
    const prev = previous.get(next.id) as T | undefined;
    if (
      prev &&
      prev.position.x === next.position.x &&
      prev.position.y === next.position.y &&
      prev.selected === next.selected &&
      prev.zIndex === next.zIndex &&
      shallowEqual(
        (prev.style ?? {}) as Record<string, unknown>,
        (next.style ?? {}) as Record<string, unknown>,
      ) &&
      shallowEqual(prev.data, next.data)
    ) {
      // Keep measurement info React Flow attached.
      return prev;
    }
    return prev?.measured ? ({ ...next, measured: prev.measured } as T) : next;
  };

  const sortedFrames = [...canvas.frames].sort(
    (a, b) => (depths.get(a.id) ?? 0) - (depths.get(b.id) ?? 0),
  );
  for (const frame of sortedFrames) {
    const r = layout.frames[frame.id];
    if (!r) continue;
    const depth = depths.get(frame.id) ?? 0;
    nodes.push(
      reuse<FrameNode>({
        id: frame.id,
        type: "frame",
        position: { x: r.x, y: r.y },
        style: { width: r.width, height: r.height },
        zIndex: -100 + depth,
        dragHandle: ".nc-frame-head",
        selected: view.selected.has(frame.id),
        ariaLabel: `Frame ${frame.title}`,
        data: {
          frame: stableFrame(frame),
          step: step.get(frame.id) ?? 0,
          depth,
          active: !!view.focus?.has(frame.id),
          dim: !!view.focus && !view.focus.has(frame.id),
          dropTarget: view.dropFrameId === frame.id,
          count: frame.members.length,
        },
      }),
    );
  }

  for (const card of canvas.cards) {
    const r = layout.cards[card.id];
    const at = card.position ?? r;
    if (!at) continue;
    const sizeClass = cardSizeClass(card, blocks);
    const width = cardWidth(card, blocks);
    const style: Record<string, number> = { width };
    const open = view.readingId === card.id || view.editingId === card.id;
    if (card.dimensions) style.height = card.dimensions.height;
    else if (card.content.kind === "sticker") style.height = STICKER_SIZE.height;
    // Every other card is drawn in the box the layout made for it, however tall its content
    // turns out to be: the layout keeps boxes apart, so a card drawn in its box can never cover
    // another. Content that needs more room is clipped until the card reports it and the layout
    // makes the room. A card open to read or edit grows over its neighbours instead, on top.
    else if (r && !open) style.height = r.height;
    const shown =
      card.content.kind === "block"
        ? card.content.blockIds.map((id) => blocks.get(id)).filter((b): b is Block => !!b)
        : [];
    const frame = frameOfCard.get(card.id);
    nodes.push(
      reuse<CardNode>({
        id: card.id,
        type: "card",
        position: { x: at.x, y: at.y },
        style,
        zIndex: open ? 10 : 0,
        selected: view.selected.has(card.id),
        dragHandle:
          view.readingId === card.id || view.editingId === card.id ? ".nc-card-grip" : undefined,
        ariaLabel: cardLabel(card, shown),
        data: {
          card: stableCard(card),
          blocks: shown,
          sizeClass,
          maxHeight: card.dimensions ? card.dimensions.height : CARD_MAX_HEIGHT[sizeClass],
          pinned: !!card.position,
          reading: view.readingId === card.id,
          editing: view.editingId === card.id,
          connectSource: view.connectSourceId === card.id,
          dim: !!view.focus && !(frame && view.focus.has(frame)),
        },
      }),
    );
  }
  return nodes;
}

export function buildEdges(
  canvas: Canvas,
  view: ViewState,
  previous: ReadonlyMap<string, ConnectorEdge>,
): ConnectorEdge[] {
  const frameOfCard = new Map<string, string>();
  for (const f of canvas.frames) for (const m of f.members) frameOfCard.set(m, f.id);
  const inFocus = (cardId: string) => {
    const f = frameOfCard.get(cardId);
    return !!f && !!view.focus?.has(f);
  };
  return canvas.connectors.map((connector) => {
    const dim = !!view.focus && !(inFocus(connector.from) || inFocus(connector.to));
    const selected = view.selected.has(connector.id);
    const prev = previous.get(connector.id);
    const stable = stableConnector(connector);
    if (
      prev &&
      prev.data?.connector === stable &&
      prev.data.dim === dim &&
      prev.selected === selected
    )
      return prev;
    return {
      id: connector.id,
      type: "connector",
      source: connector.from,
      target: connector.to,
      selected,
      ariaLabel: `Connector${connector.label ? ` "${connector.label}"` : ""}, ${connector.kind.replace("_", " ")}`,
      data: { connector: stable, dim },
    } satisfies ConnectorEdge;
  });
}

export function cardLabel(card: Card, blocks: Block[]): string {
  const c = card.content;
  if (card.title) return card.title;
  if (c.kind === "sticker") return `${c.sticker} sticker`;
  if (c.kind === "concept") return `Concept ${c.label ?? ""}`.trim();
  if (c.kind === "note") return "Note";
  const first = blocks[0];
  if (!first) return "Card";
  return `${first.type.replace("_", " ")} card`;
}
