import { Signal } from "../../context";

/**
 * Where she is in the document (P6): the block at the reading line, about a third of the way
 * down the page, and the blocks in view. One tracker per document drives the outline's current
 * heading, the Resources panel's current section and the Notes panel's "+".
 */
export interface ReadingState {
  /** The block at the reading line. */
  blockId: string | null;
  /** The heading of the section that block is in. */
  headingId: string | null;
  /** Blocks at least partly in view, in order. */
  inView: readonly string[];
}

export const NOWHERE: ReadingState = { blockId: null, headingId: null, inView: [] };

/** Where the reading line sits in the scroller: a third of the way down, never under the bars. */
export const READING_LINE = 1 / 3;
const MIN_LINE = 98;

const BLOCKS = '[data-testid="blocks"] > [data-block-id]';

/** The top-level block elements of a scroller, in document order. */
export function blockElements(scroller: HTMLElement): HTMLElement[] {
  return [...scroller.querySelectorAll<HTMLElement>(BLOCKS)];
}

/** The first index whose element's bottom is below `y` (binary search: blocks are in order). */
function firstBelow(els: readonly HTMLElement[], y: number): number {
  let lo = 0;
  let hi = els.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((els[mid] as HTMLElement).getBoundingClientRect().bottom <= y) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Follows a document scroller. Scroll events are folded into one measurement per frame, and a
 * measurement reads a handful of rectangles (a binary search over the blocks), so it costs little
 * even in a long document; nothing re-renders unless the answer changed.
 */
export class ReadingTracker {
  readonly state = new Signal<ReadingState>(NOWHERE);
  private scroller: HTMLElement | null = null;
  private els: HTMLElement[] = [];
  private headingOf = new Map<string, string | null>();
  private frame = 0;
  private stale = true;
  private resize: ResizeObserver | null = null;

  /** The section heading of each block, from the document's order. */
  setHeadings(headingOf: Map<string, string | null>) {
    this.headingOf = headingOf;
    this.stale = true;
    this.schedule();
  }

  attach(scroller: HTMLElement): () => void {
    this.scroller = scroller;
    this.stale = true;
    const onScroll = () => this.schedule();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    this.resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(onScroll);
    this.resize?.observe(scroller);
    this.schedule();
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      this.resize?.disconnect();
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.scroller = null;
    };
  }

  /** The blocks changed (added, removed, moved): find their elements again on the next frame. */
  invalidate() {
    this.stale = true;
    this.schedule();
  }

  schedule() {
    if (this.frame || typeof requestAnimationFrame === "undefined") return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.measure();
    });
  }

  /** The reading line, in viewport coordinates. */
  line(): number {
    const box = this.scroller?.getBoundingClientRect();
    if (!box || !this.scroller) return 0;
    const atEnd =
      this.scroller.scrollTop + this.scroller.clientHeight >= this.scroller.scrollHeight - 2;
    // At the very end the last blocks can never reach the line, so it drops to the bottom.
    return box.top + (atEnd ? box.height - 8 : Math.max(MIN_LINE, box.height * READING_LINE));
  }

  measure() {
    const scroller = this.scroller;
    if (!scroller) return;
    if (this.stale || this.els.some((el) => !el.isConnected)) {
      this.els = blockElements(scroller);
      this.stale = false;
    }
    const els = this.els;
    if (els.length === 0) {
      if (this.state.get() !== NOWHERE) this.state.set(NOWHERE);
      return;
    }
    const box = scroller.getBoundingClientRect();
    const line = this.line();
    const at = Math.min(firstBelow(els, line), els.length - 1);
    const first = firstBelow(els, box.top);
    const inView: string[] = [];
    for (let i = first; i < els.length; i++) {
      const el = els[i] as HTMLElement;
      if (el.getBoundingClientRect().top >= box.bottom) break;
      inView.push(el.dataset.blockId ?? "");
    }
    const blockId = (els[at] as HTMLElement).dataset.blockId ?? null;
    const headingId = blockId ? (this.headingOf.get(blockId) ?? null) : null;
    const prev = this.state.get();
    if (
      prev.blockId === blockId &&
      prev.headingId === headingId &&
      prev.inView.length === inView.length &&
      prev.inView.every((id, i) => id === inView[i])
    )
      return;
    this.state.set({ blockId, headingId, inView });
  }
}

/** Each block's section heading (the heading itself for a heading), in one pass over the order. */
export function headingsOf(
  blocks: ReadonlyArray<{ id: string; type: string }>,
): Map<string, string | null> {
  const map = new Map<string, string | null>();
  let current: string | null = null;
  for (const block of blocks) {
    if (block.type === "heading") current = block.id;
    map.set(block.id, current);
  }
  return map;
}
