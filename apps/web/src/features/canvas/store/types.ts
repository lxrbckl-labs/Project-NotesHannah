import type {
  Actor,
  Block,
  Canvas,
  CanvasApplyReport,
  CanvasOp,
  Point,
  Problem,
} from "@notes/schema";

export type LayoutVariant = "wide" | "tall";

/** A canvas with what it shows. */
export interface LoadedCanvas {
  canvas: Canvas;
  /** The document's blocks in reading order (the canvas shows a subset). */
  blocks: Block[];
  documentTitle: string;
}

export type ApplyOutcome =
  | { ok: true; canvas: Canvas; report: CanvasApplyReport }
  | { ok: false; problems: Problem[]; conflict?: boolean };

/** A card she dropped or resized: becomes a pin. */
export interface Placement {
  id: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
}

/**
 * Where the canvas comes from and goes to. The view only talks to this, so
 * the same view runs on the in-memory demo store and on the server.
 */
export interface CanvasStore {
  /** Who is editing: her, signed in. Pins record this. */
  readonly actor: Actor;
  /** The canvas for a document (derived for free on first open) with the document's blocks. */
  load(documentId: string): Promise<LoadedCanvas>;
  /** Apply her structure ops (validated, all or nothing). */
  apply(
    documentId: string,
    ops: CanvasOp[],
    options?: { expectedRevision?: number },
  ): Promise<ApplyOutcome>;
  /** Save pins from drags and resizes. Debounced and coalesced per card by the store. */
  savePlacements(documentId: string, placements: Placement[]): void;
  /** Send anything still waiting (call before leaving the view). */
  flush(): Promise<void>;
  /**
   * Called when the canvas changes elsewhere: the document's blocks changed
   * (the canvas is merged: new blocks appear, deleted ones go) or an agent
   * changed the structure. Returns an unsubscribe function.
   */
  subscribe(documentId: string, listener: (next: LoadedCanvas) => void): () => void;
  /**
   * Last automatic positions of unpinned cards, so a reopened canvas looks
   * the same. Kept per layout variant: "wide" (tablet, computer) or "tall"
   * (phone), since each lays the map out in its own shape.
   */
  loadLayoutCache(
    documentId: string,
    variant: LayoutVariant,
  ): Promise<Record<string, Point> | null>;
  saveLayoutCache(
    documentId: string,
    variant: LayoutVariant,
    positions: Record<string, Point>,
  ): void;
}
