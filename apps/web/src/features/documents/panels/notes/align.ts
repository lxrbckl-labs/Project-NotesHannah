/**
 * Keeping side notes level with their blocks (P3), the way Google Docs keeps comments beside the
 * text: each card wants to sit at its block's top; when cards would overlap they stack, and the
 * card she is looking at sits exactly at its block while its neighbours move out of its way.
 */

export interface StackItem {
  id: string;
  /** Where the card wants its top: its block's top, in page coordinates. */
  anchor: number;
  height: number;
}

export const GAP = 8;

/** Each card's top. Items in page order (by anchor; ties keep their given order). */
export function stack(items: readonly StackItem[], focusedId: string | null): Map<string, number> {
  const sorted = items
    .map((item, order) => ({ ...item, order }))
    .sort((a, b) => a.anchor - b.anchor || a.order - b.order);
  const tops = new Array<number>(sorted.length);
  const f = focusedId ? sorted.findIndex((i) => i.id === focusedId) : -1;
  const start = Math.max(f, 0);
  if (sorted.length > 0) tops[start] = (sorted[start] as StackItem).anchor;
  // Below the fixed card: push down as far as needed.
  for (let i = start + 1; i < sorted.length; i++) {
    const prev = sorted[i - 1] as StackItem;
    tops[i] = Math.max(
      (sorted[i] as StackItem).anchor,
      (tops[i - 1] as number) + prev.height + GAP,
    );
  }
  // Above it: push up, so the focused card keeps its place.
  for (let i = start - 1; i >= 0; i--) {
    const item = sorted[i] as StackItem;
    tops[i] = Math.min(item.anchor, (tops[i + 1] as number) - item.height - GAP);
  }
  return new Map(sorted.map((item, i) => [item.id, tops[i] as number]));
}

interface Placed {
  id: string;
  el: HTMLElement;
  /** Laid-out top, in page coordinates. */
  top: number;
  /** The block's top, in page coordinates. */
  anchor: number;
  /** The block's bottom, in page coordinates. */
  until: number;
  height: number;
}

/**
 * Lays the cards of one Notes panel out against the document scroller. A change in the page's
 * height, a card's height or the notes measures and stacks the cards again (once per frame);
 * scrolling only moves them, from numbers already known. A card whose block is still on screen but
 * above the panel's top (scrolled up, or the panel sits under another one) waits at the top of the
 * panel until the block has gone, so a note never slips away while she can see its block. Nothing here goes through
 * React, so typing in the page does not re-render the panel.
 */
export class AlignedLayout {
  private frame = 0;
  private scrollFrame = 0;
  private observer: ResizeObserver | null = null;
  private cards = new Map<string, HTMLElement>();
  private placed: Placed[] = [];
  private cleanup: Array<() => void> = [];
  focusedId: string | null = null;

  constructor(
    private readonly scroller: HTMLElement,
    private readonly body: HTMLElement,
    private readonly blockIdOf: (noteId: string) => string | null,
  ) {
    const onScroll = () => {
      if (this.scrollFrame) return;
      this.scrollFrame = requestAnimationFrame(() => {
        this.scrollFrame = 0;
        this.sync(false);
      });
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    this.cleanup.push(() => scroller.removeEventListener("scroll", onScroll));
    if (typeof ResizeObserver !== "undefined") {
      this.observer = new ResizeObserver(() => this.schedule());
      this.observer.observe(body);
      this.observer.observe(scroller);
      const content = scroller.firstElementChild;
      if (content) this.observer.observe(content);
    }
  }

  /** A card mounted or unmounted (from a ref callback). */
  card(noteId: string, el: HTMLElement | null) {
    const old = this.cards.get(noteId);
    if (old === el) return;
    if (old) this.observer?.unobserve(old);
    if (el) {
      this.cards.set(noteId, el);
      this.observer?.observe(el);
    } else this.cards.delete(noteId);
    this.schedule();
  }

  schedule() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.layout();
    });
  }

  /** Measure and stack now (after a render that changed the cards). */
  layout() {
    // Page coordinates count from the top of the scroller's content (not its first child, whose
    // box can start lower when a margin collapses through it).
    const origin = this.scroller.getBoundingClientRect().top - this.scroller.scrollTop;
    const items: StackItem[] = [];
    const until = new Map<string, number>();
    for (const [noteId, el] of this.cards) {
      const blockId = this.blockIdOf(noteId);
      const block = blockId
        ? this.scroller.querySelector<HTMLElement>(`[data-block-id="${blockId}"]`)
        : null;
      if (!block) {
        el.style.visibility = "hidden";
        continue;
      }
      el.style.visibility = "";
      const rect = block.getBoundingClientRect();
      items.push({ id: noteId, anchor: rect.top - origin, height: el.offsetHeight });
      until.set(noteId, rect.bottom - origin);
    }
    const tops = stack(items, this.focusedId);
    const height = new Map(items.map((i) => [i.id, i.height]));
    const anchor = new Map(items.map((i) => [i.id, i.anchor]));
    this.placed = [...tops].map(([id, top]) => ({
      id,
      el: this.cards.get(id) as HTMLElement,
      top,
      anchor: anchor.get(id) ?? top,
      until: until.get(id) ?? top,
      height: height.get(id) ?? 0,
    }));
    this.sync(true);
  }

  /** Place the cards for the page's scroll position. */
  sync(animate: boolean) {
    // Page coordinates to the panel's: where the page's top is now, seen from the panel. The
    // panel may start lower than the page (under another panel in the same sidebar).
    const view = this.scroller.getBoundingClientRect().top - this.body.getBoundingClientRect().top;
    const offset = view - this.scroller.scrollTop;
    const bottom = this.body.clientHeight;
    const placed = this.placed;
    const ys = placed.map((p) => {
      const y = p.top + offset;
      // Its block starts above the panel's top but still shows: wait at the top of the panel, and
      // leave with the block's bottom edge. (A card merely pushed up by its neighbours does not.)
      return y < 0 && p.anchor + offset < 0 ? Math.min(0, p.until + offset - view - p.height) : y;
    });
    // The card she is looking at keeps its place; the others make room above and below it.
    const f = placed.findIndex((p) => p.id === this.focusedId);
    const fixed = Math.max(f, 0);
    for (let i = fixed + 1; i < placed.length; i++) {
      const prev = placed[i - 1] as Placed;
      ys[i] = Math.max(ys[i] as number, (ys[i - 1] as number) + prev.height + GAP);
    }
    for (let i = fixed - 1; i >= 0; i--) {
      ys[i] = Math.min(ys[i] as number, (ys[i + 1] as number) - (placed[i] as Placed).height - GAP);
    }
    // A card whose block is on screen but which would run off the panel's foot (the panel is
    // short, or shares the sidebar) waits at the foot, pushing the ones above it up too (never
    // past the card she is looking at).
    const screenBottom = view + this.scroller.clientHeight;
    // The highest each card may rise to: just under the card she is looking at.
    const lowest: number[] = placed.map(() => Number.NEGATIVE_INFINITY);
    for (let i = f + 1; f >= 0 && i < placed.length; i++) {
      const prev = placed[i - 1] as Placed;
      lowest[i] = (i === f + 1 ? (ys[f] as number) : (lowest[i - 1] as number)) + prev.height + GAP;
    }
    let ceiling = bottom;
    for (let i = placed.length - 1; i > (f >= 0 ? f : -1); i--) {
      const p = placed[i] as Placed;
      if (p.anchor + offset >= screenBottom - 24) continue;
      if ((ys[i] as number) + p.height > ceiling)
        ys[i] = Math.max(ceiling - p.height, lowest[i] as number);
      ceiling = Math.min(ceiling, ys[i] as number) - GAP;
    }
    for (const [i, p] of this.placed.entries()) {
      p.el.style.transition = animate ? "" : "none";
      p.el.style.transform = `translateY(${Math.round(ys[i] as number)}px)`;
    }
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    cancelAnimationFrame(this.scrollFrame);
    this.observer?.disconnect();
    for (const fn of this.cleanup) fn();
    this.cards.clear();
    this.placed = [];
  }
}
