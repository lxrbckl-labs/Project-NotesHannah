import { blockParts, isBlockType } from "./blocks/registry.js";
import { richTextToPlain } from "./blocks/rich-text.js";
import type { Canvas, Card, CardSize } from "./canvas.js";

/**
 * The pure half of canvas layout: card size estimation and the constraint
 * pass that runs after the graph layout (ELK, in the web app). No DOM, no
 * ELK: usable in Node, in the browser and in a worker.
 *
 * Pipeline (see docs/canvas.md):
 * 1. Sizes: a width per size class, a height estimated from the content
 *    (replaced by measured sizes once the browser has rendered the cards).
 * 2. Graph layout of the FREE cards (not pinned, not anchored), with frames
 *    as compound nodes. Done by the caller; it hands over absolute rects.
 * 3. `resolveLayout`: pinned cards stay exactly where she put them; inside a
 *    frame that has pinned (or anchored) members the free members are placed
 *    below them; top-level groups that collide are pushed down; frames are
 *    sized to their members.
 */

export interface Point {
  x: number;
  y: number;
}
export interface Size {
  width: number;
  height: number;
}
export interface Rect extends Point, Size {}

// ---------------------------------------------------------------------------
// Sizes.
// ---------------------------------------------------------------------------

export const CARD_WIDTHS: Record<Exclude<CardSize, "auto">, number> = {
  small: 220,
  medium: 280,
  large: 360,
  wide: 520,
};

/** Cards taller than this clip their content with a fade; open the card to read it all. */
export const CARD_MAX_HEIGHT: Record<Exclude<CardSize, "auto">, number> = {
  small: 260,
  medium: 340,
  large: 420,
  wide: 420,
};

export const STICKER_SIZE: Size = { width: 88, height: 88 };
/** A concept card with a one-line label; each further line of the label adds `CONCEPT_LINE`. */
export const CONCEPT_CARD_HEIGHT = 54;
const CONCEPT_LINE = 14;
export const CARD_MIN_HEIGHT = 56;

/** Space around and between things, in canvas units. */
export const LAYOUT_SPACING = {
  /** Between cards in a frame. */
  card: 32,
  /** Between layers of connected cards. */
  layer: 72,
  /** Between frames and top-level cards. */
  group: 72,
} as const;

/** Inner padding of a frame; the top holds its title. */
export const FRAME_PADDING = { top: 56, side: 24, bottom: 24 } as const;
export const EMPTY_FRAME_SIZE: Size = { width: 260, height: 140 };

/**
 * Typography of the cards as the app draws them, so estimates match what is drawn. Measured in the
 * app (Chromium, 1280x800) on the pharmacy demo canvases: cards draw their blocks with the documents'
 * own renderers, whose study-guide text is 17 px with 1.7 line height (`--text-reading`), and notes
 * with the 16 px body text. Estimates err on the tall side: a card drawn shorter than its box leaves
 * a gap, one drawn taller covers its neighbour until the browser has measured it.
 */
export const CARD_TEXT = {
  /** Side padding of the card body, each side. */
  padding: 14,
  /** The card's border, each side. */
  border: 1,
  /** Top plus bottom padding of the card body. */
  paddingY: 24,
  /** Interface text (lists, tables, labels): 14 px on 20 px lines. */
  lineHeight: 20,
  charWidth: 7.1,
  /** Study-guide text (paragraphs, quotes, callouts): 17 px on 29 px lines. */
  readingLineHeight: 29,
  readingCharWidth: 9,
  /** Note text: 16 px on 24 px lines. */
  noteLineHeight: 24,
  noteCharWidth: 8.6,
  /** The title band above the body of a card with a title. */
  titleHeight: 30,
  blockGap: 10,
} as const;

type AnyBlock = { type: string; content?: unknown };

function linesFor(text: string, width: number, charWidth: number = CARD_TEXT.charWidth): number {
  if (!text) return 0;
  const perLine = Math.max(8, Math.floor(width / charWidth));
  return text
    .split("\n")
    .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / perLine)), 0);
}

/** Lines of study-guide text at `width`. */
function readingLines(text: string, width: number): number {
  return linesFor(text, width, CARD_TEXT.readingCharWidth);
}

function plain(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return richTextToPlain(value as never);
  if (value && typeof value === "object" && "text" in value)
    return plain((value as { text: unknown }).text);
  return "";
}

/** Estimated height of one block rendered at `width` (content box, no card padding). */
export function estimateBlockHeight(block: AnyBlock, width: number): number {
  const L = CARD_TEXT.lineHeight;
  const R = CARD_TEXT.readingLineHeight;
  const c = (block.content ?? {}) as Record<string, unknown>;
  switch (block.type) {
    case "heading":
      return Math.max(1, readingLines(plain(c.text), width * 0.8)) * 32;
    case "paragraph":
      return readingLines(plain(c.text), width) * R;
    case "bulleted_list":
    case "numbered_list":
    case "checklist": {
      const items = (c.items as unknown[] | undefined) ?? [];
      return items.reduce<number>(
        (sum, item) => sum + linesFor(plain(item), width - 20) * L + 2,
        0,
      );
    }
    case "quote":
      return readingLines(plain(c.text), width - 16) * R + (c.attribution ? 22 : 0);
    case "callout":
      // A tinted panel: border and padding around an icon column and the text.
      return (c.title ? 28 : 0) + readingLines(plain(c.text), width - 70) * R + 28;
    case "table": {
      const rows = (c.rows as unknown[][] | undefined) ?? [];
      const cols = Math.max(1, rows[0]?.length ?? 1);
      return rows.reduce<number>((sum, row) => {
        const tallest = Math.max(1, ...row.map((cell) => linesFor(plain(cell), width / cols - 12)));
        return sum + tallest * L + 16;
      }, 0);
    }
    case "comparison_table": {
      const rows = (c.rows as unknown[] | undefined) ?? [];
      return (c.title ? 28 : 0) + (rows.length + 1) * 36;
    }
    case "drug_card": {
      // Every section the renderer shows: a labelled heading, then one line per item. Drawn, the
      // demo's carvedilol card is 913 px tall and metoprolol's 1065 (both clip at the maximum).
      const list = (key: string) => ((c[key] as unknown[] | undefined) ?? []).length;
      let h = 48; // name and brand names
      if (c.drugClass) h += 24 + linesFor(plain(c.drugClass), width) * L;
      if (c.mechanism) h += 24 + linesFor(plain(c.mechanism), width) * L;
      for (const key of [
        "indications",
        "adverseEffects",
        "contraindications",
        "interactions",
        "monitoring",
        "counselling",
        "dosingNotes",
      ]) {
        if (list(key) > 0) h += 40 + list(key) * 48;
      }
      return h;
    }
    case "mnemonic": {
      // A raised panel: the device and topic, then each part's key over its meaning.
      const parts = (c.parts as Array<{ meaning?: unknown }> | undefined) ?? [];
      const W = CARD_TEXT.noteLineHeight;
      const at = (text: unknown) => linesFor(plain(text), width - 32, CARD_TEXT.noteCharWidth) * W;
      return (
        64 +
        parts.reduce<number>((sum, part) => sum + 26 + at(part.meaning), 0) +
        (c.note ? 12 + at(c.note) : 0)
      );
    }
    case "image":
    case "labelled_image":
      return Math.round(width * 0.62) + 20;
    case "mind_map":
      return 180;
    case "divider":
      return 12;
    case "question":
      return 44;
    default: {
      if (!isBlockType(block.type)) return 2 * L;
      try {
        const parts = blockParts(block as never);
        return parts.reduce((sum, p) => sum + linesFor(richTextToPlain(p.text), width) * L, 0) || L;
      } catch {
        return 2 * L;
      }
    }
  }
}

/** The width class "auto" turns into for this content. */
export function autoSizeClass(
  card: Pick<Card, "content">,
  blocks: ReadonlyMap<string, AnyBlock>,
): Exclude<CardSize, "auto"> {
  const content = card.content;
  if (content.kind === "sticker" || content.kind === "concept") return "small";
  if (content.kind === "note") {
    const n = richTextToPlain(content.text).length;
    return n > 220 ? "medium" : "small";
  }
  if (content.blockIds.length > 1) return "large";
  const block = blocks.get(content.blockIds[0] as string);
  if (!block) return "medium";
  const c = (block.content ?? {}) as Record<string, unknown>;
  switch (block.type) {
    case "comparison_table":
      return "wide";
    case "table": {
      const cols = ((c.rows as unknown[][] | undefined)?.[0] ?? []).length;
      return cols >= 4 ? "wide" : "large";
    }
    case "drug_card":
    case "image":
    case "labelled_image":
    case "mind_map":
      return "large";
    case "paragraph": {
      const n = plain(c.text).length;
      return n > 420 ? "large" : n > 140 ? "medium" : "small";
    }
    case "heading":
    case "question":
      return "small";
    default:
      return "medium";
  }
}

/** Width class a card renders at. */
export function cardSizeClass(
  card: Pick<Card, "content" | "size">,
  blocks: ReadonlyMap<string, AnyBlock>,
): Exclude<CardSize, "auto"> {
  return card.size === "auto" ? autoSizeClass(card, blocks) : card.size;
}

/**
 * First-placement size of a card, before the browser has measured it.
 * A size she pinned wins.
 */
export function estimateCardSize(card: Card, blocks: ReadonlyMap<string, AnyBlock>): Size {
  if (card.dimensions) return { width: card.dimensions.width, height: card.dimensions.height };
  const content = card.content;
  if (content.kind === "sticker") return { ...STICKER_SIZE };
  const cls = cardSizeClass(card, blocks);
  const width = CARD_WIDTHS[cls];
  const border = 2 * CARD_TEXT.border;
  const inner = width - 2 * CARD_TEXT.padding - border;
  const title = card.title ? CARD_TEXT.titleHeight : 0;
  if (content.kind === "concept") {
    const label = content.label ?? "Concept";
    // The label sits beside a 30 px icon column.
    const lines = Math.max(1, linesFor(label, inner - 30, CARD_TEXT.readingCharWidth));
    return { width, height: CONCEPT_CARD_HEIGHT + (lines - 1) * CONCEPT_LINE + title };
  }
  let height = border + CARD_TEXT.paddingY + title;
  if (content.kind === "note") {
    height +=
      Math.max(1, linesFor(richTextToPlain(content.text), inner, CARD_TEXT.noteCharWidth)) *
      CARD_TEXT.noteLineHeight;
  } else {
    content.blockIds.forEach((id, i) => {
      const block = blocks.get(id);
      height += (i > 0 ? CARD_TEXT.blockGap : 0) + (block ? estimateBlockHeight(block, inner) : 40);
    });
  }
  return {
    width,
    height: Math.round(Math.min(cardMaxHeight(cls), Math.max(CARD_MIN_HEIGHT, height))),
  };
}

/**
 * The tallest a card of this class is drawn: its clipped body plus the border. A title takes its
 * band from the body, so a card with a title is no taller (the view subtracts `titleHeight`).
 */
export function cardMaxHeight(cls: Exclude<CardSize, "auto">): number {
  return CARD_MAX_HEIGHT[cls] + 2 * CARD_TEXT.border;
}

// ---------------------------------------------------------------------------
// Layout input.
// ---------------------------------------------------------------------------

export interface LayoutCardInput {
  id: string;
  width: number;
  height: number;
  /** The frame holding it, if any. */
  frame: string | null;
  /** Where she pinned it: never moved. */
  pinned: Point | null;
  /** Where it was last time (unpinned): kept when re-laying out incrementally. */
  anchor: Point | null;
}

export interface LayoutFrameInput {
  id: string;
  parent: string | null;
  order: number;
}

export interface LayoutInput {
  /** In reading order: frame by frame, then cards outside frames. */
  cards: LayoutCardInput[];
  /** In step-through order, parents before children. */
  frames: LayoutFrameInput[];
  connectors: Array<{ id: string; from: string; to: string }>;
}

export interface LayoutResult {
  cards: Record<string, Rect>;
  frames: Record<string, Rect>;
  bounds: Rect;
}

export interface BuildLayoutOptions {
  /** Size of each card: measured in the browser, or estimated. */
  sizeOf: (card: Card) => Size;
  /** Previous positions of unpinned cards to keep (incremental layout). */
  previous?: ReadonlyMap<string, Point> | Record<string, Point> | undefined;
}

/** Turn a canvas into layout input: reading order, sizes, pins and anchors. */
export function buildLayoutInput(
  canvas: Pick<Canvas, "cards" | "frames" | "connectors">,
  options: BuildLayoutOptions,
): LayoutInput {
  const previous =
    options.previous instanceof Map
      ? options.previous
      : new Map(Object.entries((options.previous ?? {}) as Record<string, Point>));
  const frameOf = new Map<string, string>();
  for (const f of canvas.frames) for (const m of f.members) frameOf.set(m, f.id);
  const frameIds = new Set(canvas.frames.map((f) => f.id));
  const ordered = [...canvas.frames].sort((a, b) => a.order - b.order);
  // Parents before children, keeping step order otherwise.
  const depth = (id: string | undefined): number => {
    let d = 0;
    let cur = id ? canvas.frames.find((f) => f.id === id) : undefined;
    while (cur?.parent && frameIds.has(cur.parent) && d < 10) {
      d += 1;
      cur = canvas.frames.find((f) => f.id === cur?.parent);
    }
    return d;
  };
  const frames = ordered
    .map((f) => ({
      id: f.id,
      parent: f.parent && frameIds.has(f.parent) ? f.parent : null,
      order: f.order,
    }))
    .sort((a, b) => depth(a.id) - depth(b.id) || a.order - b.order);
  const byId = new Map(canvas.cards.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const cards: LayoutCardInput[] = [];
  const push = (card: Card) => {
    if (seen.has(card.id)) return;
    seen.add(card.id);
    const size = options.sizeOf(card);
    cards.push({
      id: card.id,
      width: size.width,
      height: size.height,
      frame: frameOf.get(card.id) ?? null,
      pinned: card.position ? { x: card.position.x, y: card.position.y } : null,
      anchor: card.position ? null : (previous.get(card.id) ?? null),
    });
  };
  for (const f of ordered)
    for (const m of f.members) {
      const card = byId.get(m);
      if (card) push(card);
    }
  for (const card of canvas.cards) push(card);
  const cardIds = new Set(cards.map((c) => c.id));
  return {
    cards,
    frames,
    connectors: canvas.connectors
      .filter((e) => cardIds.has(e.from) && cardIds.has(e.to))
      .map((e) => ({ id: e.id, from: e.from, to: e.to })),
  };
}

/** Cards the graph layout must place: neither pinned nor anchored. */
export function isFreeCard(card: LayoutCardInput): boolean {
  return !card.pinned && !card.anchor;
}

// ---------------------------------------------------------------------------
// Geometry.
// ---------------------------------------------------------------------------

export function overlaps(a: Rect, b: Rect, gap = 0): boolean {
  return (
    a.x < b.x + b.width + gap &&
    b.x < a.x + a.width + gap &&
    a.y < b.y + b.height + gap &&
    b.y < a.y + a.height + gap
  );
}

export function contains(outer: Rect, inner: Rect, tolerance = 0.5): boolean {
  return (
    inner.x >= outer.x - tolerance &&
    inner.y >= outer.y - tolerance &&
    inner.x + inner.width <= outer.x + outer.width + tolerance &&
    inner.y + inner.height <= outer.y + outer.height + tolerance
  );
}

export function boundingBox(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let x1 = Number.POSITIVE_INFINITY;
  let y1 = Number.POSITIVE_INFINITY;
  let x2 = Number.NEGATIVE_INFINITY;
  let y2 = Number.NEGATIVE_INFINITY;
  for (const r of rects) {
    x1 = Math.min(x1, r.x);
    y1 = Math.min(y1, r.y);
    x2 = Math.max(x2, r.x + r.width);
    y2 = Math.max(y2, r.y + r.height);
  }
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/** A frame's rect around its content box. */
export function padFrame(content: Rect): Rect {
  return {
    x: content.x - FRAME_PADDING.side,
    y: content.y - FRAME_PADDING.top,
    width: content.width + 2 * FRAME_PADDING.side,
    height: content.height + FRAME_PADDING.top + FRAME_PADDING.bottom,
  };
}

// ---------------------------------------------------------------------------
// Fallback placement (no graph layout available).
// ---------------------------------------------------------------------------

/**
 * A simple, deterministic placement of the free cards: rows inside each
 * frame, frames in rows. Used when the graph layout fails or is not
 * loaded, so a canvas always opens.
 */
export function fallbackPositions(input: LayoutInput): Record<string, Rect> {
  const out: Record<string, Rect> = {};
  const children = new Map<string | null, string[]>();
  for (const f of input.frames) {
    const list = children.get(f.parent) ?? [];
    list.push(f.id);
    children.set(f.parent, list);
  }
  const cardsIn = new Map<string | null, LayoutCardInput[]>();
  for (const c of input.cards) {
    if (!isFreeCard(c)) continue;
    const list = cardsIn.get(c.frame) ?? [];
    list.push(c);
    cardsIn.set(c.frame, list);
  }
  // Returns the size of the laid-out content, with items placed from (0,0).
  const place = (frame: string | null, ox: number, oy: number, maxWidth: number): Size => {
    let x = 0;
    let y = 0;
    let rowH = 0;
    let width = 0;
    const put = (w: number, h: number, setAt: (x: number, y: number) => void) => {
      if (x > 0 && x + w > maxWidth) {
        x = 0;
        y += rowH + LAYOUT_SPACING.card;
        rowH = 0;
      }
      setAt(ox + x, oy + y);
      x += w + LAYOUT_SPACING.card;
      rowH = Math.max(rowH, h);
      width = Math.max(width, x - LAYOUT_SPACING.card);
    };
    for (const id of children.get(frame) ?? []) {
      // Measure first by placing at origin, then shift.
      const inner = place(id, 0, 0, maxWidth * 0.8);
      const size = padFrame({
        x: 0,
        y: 0,
        width: Math.max(inner.width, EMPTY_FRAME_SIZE.width - 48),
        height: Math.max(inner.height, 40),
      });
      put(size.width, size.height, (px, py) => {
        place(id, px + FRAME_PADDING.side, py + FRAME_PADDING.top, maxWidth * 0.8);
        out[id] = { x: px, y: py, width: size.width, height: size.height };
      });
    }
    for (const c of cardsIn.get(frame) ?? []) {
      put(c.width, c.height, (px, py) => {
        out[c.id] = { x: px, y: py, width: c.width, height: c.height };
      });
    }
    return { width, height: y + rowH };
  };
  place(null, 0, 0, 2400);
  return out;
}

// ---------------------------------------------------------------------------
// Constraint pass.
// ---------------------------------------------------------------------------

export interface ResolveOptions {
  /**
   * Absolute rects from the graph layout for free cards and for frames
   * (frames: used only for empty frames). Missing free cards fall back to
   * `fallbackPositions`.
   */
  graph: Record<string, Rect>;
}

interface Item {
  kind: "card" | "frame";
  id: string;
}

/**
 * Combine the graph layout of free cards with pinned and anchored cards.
 * Deterministic: the same input always gives the same result.
 */
export function resolveLayout(input: LayoutInput, options: ResolveOptions): LayoutResult {
  const graph = { ...options.graph };
  const missing = input.cards.some((c) => isFreeCard(c) && !graph[c.id]);
  if (missing) {
    const fb = fallbackPositions(input);
    for (const c of input.cards) if (isFreeCard(c) && !graph[c.id]) graph[c.id] = fb[c.id] as Rect;
  }
  const anchoredMode = input.cards.some((c) => c.anchor !== null);
  const card = new Map(input.cards.map((c) => [c.id, c]));
  const cardRect = new Map<string, Rect>();
  for (const c of input.cards) {
    const at = c.pinned ?? c.anchor;
    const g = graph[c.id];
    cardRect.set(
      c.id,
      at
        ? { x: at.x, y: at.y, width: c.width, height: c.height }
        : { x: g?.x ?? 0, y: g?.y ?? 0, width: c.width, height: c.height },
    );
  }
  const frameRect = new Map<string, Rect>();
  const childFrames = new Map<string | null, string[]>();
  const knownFrames = new Set(input.frames.map((f) => f.id));
  for (const f of input.frames) {
    const parent = f.parent && knownFrames.has(f.parent) ? f.parent : null;
    const list = childFrames.get(parent) ?? [];
    list.push(f.id);
    childFrames.set(parent, list);
  }
  const cardsIn = new Map<string | null, string[]>();
  for (const c of input.cards) {
    const frame = c.frame && knownFrames.has(c.frame) ? c.frame : null;
    const list = cardsIn.get(frame) ?? [];
    list.push(c.id);
    cardsIn.set(frame, list);
  }
  const rectOf = (item: Item) =>
    (item.kind === "card" ? cardRect.get(item.id) : frameRect.get(item.id)) as Rect;
  const translate = (item: Item, dx: number, dy: number) => {
    if (dx === 0 && dy === 0) return;
    if (item.kind === "card") {
      const r = cardRect.get(item.id) as Rect;
      cardRect.set(item.id, { ...r, x: r.x + dx, y: r.y + dy });
      return;
    }
    const r = frameRect.get(item.id);
    if (r) frameRect.set(item.id, { ...r, x: r.x + dx, y: r.y + dy });
    for (const c of cardsIn.get(item.id) ?? []) translate({ kind: "card", id: c }, dx, dy);
    for (const f of childFrames.get(item.id) ?? []) translate({ kind: "frame", id: f }, dx, dy);
  };
  const hasPinned = (item: Item): boolean =>
    item.kind === "card"
      ? card.get(item.id)?.pinned != null
      : (cardsIn.get(item.id) ?? []).some((c) => card.get(c)?.pinned != null) ||
        (childFrames.get(item.id) ?? []).some((f) => hasPinned({ kind: "frame", id: f }));
  const itemsOf = (frame: string | null): Item[] => [
    ...(childFrames.get(frame) ?? []).map((id) => ({ kind: "frame" as const, id })),
    ...(cardsIn.get(frame) ?? []).map((id) => ({ kind: "card" as const, id })),
  ];
  const sizeFrame = (frame: string) => {
    const box = boundingBox(itemsOf(frame).map(rectOf));
    if (box) frameRect.set(frame, padFrame(box));
    else {
      const g = graph[frame];
      frameRect.set(
        frame,
        g
          ? { ...g, width: EMPTY_FRAME_SIZE.width, height: EMPTY_FRAME_SIZE.height }
          : { x: 0, y: 0, ...EMPTY_FRAME_SIZE },
      );
    }
  };

  // Returns whether the container is fixed (holds pinned or anchored cards).
  const place = (frame: string | null): boolean => {
    const fixed: Item[] = [];
    const free: Item[] = [];
    for (const item of itemsOf(frame)) {
      if (item.kind === "frame") (place(item.id) ? fixed : free).push(item);
      else (isFreeCard(card.get(item.id) as LayoutCardInput) ? free : fixed).push(item);
    }
    if (fixed.length > 0 && free.length > 0) {
      const fb = boundingBox(fixed.map(rectOf)) as Rect;
      const ff = boundingBox(free.map(rectOf)) as Rect;
      let dx = 0;
      let dy = 0;
      if (frame !== null) {
        // Inside a frame: new or free cards go below what she placed.
        dx = fb.x - ff.x;
        dy = fb.y + fb.height + LAYOUT_SPACING.card - ff.y;
      } else if (anchoredMode) {
        // Top level, incremental: new groups go to the right of the existing map.
        dx = fb.x + fb.width + LAYOUT_SPACING.group - ff.x;
        dy = fb.y - ff.y;
      }
      for (const item of free) translate(item, dx, dy);
    }
    if (frame !== null) sizeFrame(frame);
    return fixed.length > 0;
  };
  place(null);

  // Top-level groups that collide are pushed down; groups holding pinned cards
  // never move. Then a safety net: no unpinned card may overlap another card.
  // A card pushed by the safety net can grow its frame, so repeat until calm.
  const top = itemsOf(null);
  const resizeAll = () => {
    const resize = (frame: string) => {
      for (const f of childFrames.get(frame) ?? []) resize(f);
      sizeFrame(frame);
    };
    for (const f of childFrames.get(null) ?? []) resize(f);
  };
  for (let round = 0; round < 6; round++) {
    const placed: Rect[] = [];
    const movable: Item[] = [];
    for (const item of top) hasPinned(item) ? placed.push(rectOf(item)) : movable.push(item);
    movable.sort(
      (a, b) => rectOf(a).y - rectOf(b).y || rectOf(a).x - rectOf(b).x || (a.id < b.id ? -1 : 1),
    );
    for (const item of movable) {
      pushDown(item, placed, rectOf, translate, LAYOUT_SPACING.group);
      placed.push(rectOf(item));
    }

    const order = input.cards
      .filter((c) => !c.pinned)
      .map((c) => c.id)
      .sort((a, b) => {
        const ra = cardRect.get(a) as Rect;
        const rb = cardRect.get(b) as Rect;
        return ra.y - rb.y || ra.x - rb.x || (a < b ? -1 : 1);
      });
    const settled: Rect[] = input.cards
      .filter((c) => c.pinned)
      .map((c) => cardRect.get(c.id) as Rect);
    let moved = false;
    for (const id of order) {
      const before = cardRect.get(id) as Rect;
      pushDown({ kind: "card", id }, settled, rectOf, translate, 8);
      const after = cardRect.get(id) as Rect;
      if (after.y !== before.y) moved = true;
      settled.push(after);
    }
    if (!moved) break;
    resizeAll();
  }

  const cards: Record<string, Rect> = {};
  for (const c of input.cards) cards[c.id] = round(cardRect.get(c.id) as Rect);
  const frames: Record<string, Rect> = {};
  for (const f of input.frames) {
    const r = frameRect.get(f.id);
    if (r) frames[f.id] = round(r);
  }
  const bounds = boundingBox([...Object.values(cards), ...Object.values(frames)]) ?? {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  };
  return { cards, frames, bounds };
}

function round(r: Rect): Rect {
  return {
    x: Math.round(r.x),
    y: Math.round(r.y),
    width: Math.round(r.width),
    height: Math.round(r.height),
  };
}

function pushDown(
  item: Item,
  obstacles: readonly Rect[],
  rectOf: (item: Item) => Rect,
  translate: (item: Item, dx: number, dy: number) => void,
  gap: number,
): void {
  for (let guard = 0; guard < 1000; guard++) {
    const r = rectOf(item);
    let dy = 0;
    for (const o of obstacles) {
      if (overlaps(r, o, gap - 0.01)) dy = Math.max(dy, o.y + o.height + gap - r.y);
    }
    if (dy <= 0) return;
    translate(item, 0, dy);
  }
}

// ---------------------------------------------------------------------------
// Invariants (used by tests and as a runtime self-check).
// ---------------------------------------------------------------------------

/** Every way a layout breaks its promises; empty when it keeps them all. */
export function layoutProblems(input: LayoutInput, result: LayoutResult): string[] {
  const out: string[] = [];
  for (const c of input.cards) {
    const r = result.cards[c.id];
    if (!r) {
      out.push(`card ${c.id} has no position`);
      continue;
    }
    if (
      c.pinned &&
      (Math.abs(r.x - Math.round(c.pinned.x)) > 0.5 || Math.abs(r.y - Math.round(c.pinned.y)) > 0.5)
    )
      out.push(`pinned card ${c.id} moved from ${c.pinned.x},${c.pinned.y} to ${r.x},${r.y}`);
  }
  const unpinned = input.cards
    .filter((c) => !c.pinned)
    .map((c) => ({ id: c.id, r: result.cards[c.id] as Rect }));
  const all = input.cards.map((c) => ({
    id: c.id,
    r: result.cards[c.id] as Rect,
    pinned: !!c.pinned,
  }));
  for (const a of unpinned) {
    for (const b of all) {
      if (a.id === b.id || !a.r || !b.r) continue;
      if (!b.pinned && a.id > b.id) continue;
      if (overlaps(a.r, b.r, -0.5)) out.push(`cards ${a.id} and ${b.id} overlap`);
    }
  }
  const frameIds = new Set(input.frames.map((f) => f.id));
  for (const f of input.frames) {
    const r = result.frames[f.id];
    if (!r) {
      out.push(`frame ${f.id} has no rect`);
      continue;
    }
    for (const c of input.cards) {
      if (c.frame !== f.id) continue;
      const cr = result.cards[c.id];
      if (cr && !contains(r, cr)) out.push(`frame ${f.id} does not contain its card ${c.id}`);
    }
    if (f.parent && frameIds.has(f.parent)) {
      const pr = result.frames[f.parent];
      if (pr && !contains(pr, r)) out.push(`frame ${f.parent} does not contain its frame ${f.id}`);
    }
  }
  return out;
}
