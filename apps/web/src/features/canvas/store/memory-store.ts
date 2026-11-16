import {
  type Actor,
  applyCanvasChange,
  type Block,
  type Canvas,
  type CanvasOp,
  deriveCanvas,
  mergeDocumentBlocks,
  type Point,
} from "@notes/schema";
import type { ApplyOutcome, CanvasStore, LayoutVariant, LoadedCanvas, Placement } from "./types";

export interface MemoryDocument {
  id: string;
  title: string;
  blocks: Block[];
  /** A prepared canvas; derived from the blocks when absent. */
  canvas?: Canvas;
}

export interface MemoryStoreOptions {
  actor: Actor;
  documents: MemoryDocument[];
  /** localStorage key prefix; when set, canvases survive a reload. */
  persistKey?: string;
  /** Delay before placements are saved, in ms. */
  debounceMs?: number;
  /** Artificial latency for each call, to exercise loading states. */
  latencyMs?: number;
}

/**
 * The in-memory store behind the demo and the component tests. Same rules
 * as the server: changes go through `applyCanvasChange`, block changes
 * through `mergeDocumentBlocks`.
 */
export class MemoryCanvasStore implements CanvasStore {
  readonly actor: Actor;
  private docs = new Map<string, { title: string; blocks: Block[]; canvas: Canvas }>();
  private listeners = new Map<string, Set<(next: LoadedCanvas) => void>>();
  private pending = new Map<string, Map<string, Placement>>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly options: MemoryStoreOptions;
  /** Every op batch applied, for tests. */
  readonly log: Array<{ documentId: string; ops: CanvasOp[] }> = [];

  constructor(options: MemoryStoreOptions) {
    this.options = options;
    this.actor = options.actor;
    for (const doc of options.documents) {
      const saved = this.read<Canvas>(`canvas:${doc.id}`);
      const base = saved ?? doc.canvas ?? deriveCanvas(doc.id, doc.blocks);
      const merged = mergeDocumentBlocks(base, doc.blocks).canvas;
      this.docs.set(doc.id, { title: doc.title, blocks: doc.blocks, canvas: merged });
    }
  }

  private read<T>(key: string): T | null {
    if (!this.options.persistKey) return null;
    try {
      const raw = localStorage.getItem(`${this.options.persistKey}:${key}`);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  private write(key: string, value: unknown): void {
    if (!this.options.persistKey) return;
    try {
      localStorage.setItem(`${this.options.persistKey}:${key}`, JSON.stringify(value));
    } catch {
      // Storage full or blocked: the canvas still works for this session.
    }
  }

  private async delay(): Promise<void> {
    const ms = this.options.latencyMs ?? 0;
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
  }

  private doc(documentId: string) {
    const doc = this.docs.get(documentId);
    if (!doc) throw new Error(`No document ${documentId}`);
    return doc;
  }

  private snapshot(documentId: string): LoadedCanvas {
    const doc = this.doc(documentId);
    return { canvas: doc.canvas, blocks: doc.blocks, documentTitle: doc.title };
  }

  async load(documentId: string): Promise<LoadedCanvas> {
    await this.delay();
    return this.snapshot(documentId);
  }

  async apply(
    documentId: string,
    ops: CanvasOp[],
    options: { expectedRevision?: number } = {},
  ): Promise<ApplyOutcome> {
    await this.delay();
    const doc = this.doc(documentId);
    const result = applyCanvasChange(
      doc.canvas,
      { documentId, ops, expectedRevision: options.expectedRevision },
      { actor: this.actor, documentBlockIds: doc.blocks.map((b) => b.id) },
    );
    if (!result.ok) return { ok: false, problems: result.problems };
    this.log.push({ documentId, ops });
    doc.canvas = result.canvas;
    this.write(`canvas:${documentId}`, doc.canvas);
    return { ok: true, canvas: result.canvas, report: result.report };
  }

  savePlacements(documentId: string, placements: Placement[]): void {
    const queue = this.pending.get(documentId) ?? new Map<string, Placement>();
    for (const p of placements) queue.set(p.id, p);
    this.pending.set(documentId, queue);
    const existing = this.timers.get(documentId);
    if (existing) clearTimeout(existing);
    this.timers.set(
      documentId,
      setTimeout(() => void this.flushDocument(documentId), this.options.debounceMs ?? 400),
    );
  }

  private async flushDocument(documentId: string): Promise<void> {
    const queue = this.pending.get(documentId);
    this.pending.delete(documentId);
    const timer = this.timers.get(documentId);
    if (timer) clearTimeout(timer);
    this.timers.delete(documentId);
    if (!queue || queue.size === 0) return;
    const doc = this.doc(documentId);
    const live = new Set(doc.canvas.cards.map((c) => c.id));
    const placements = [...queue.values()].filter((p) => live.has(p.id));
    if (placements.length === 0) return;
    await this.apply(documentId, [{ op: "place_cards", placements }]);
  }

  async flush(): Promise<void> {
    await Promise.all([...this.pending.keys()].map((id) => this.flushDocument(id)));
  }

  subscribe(documentId: string, listener: (next: LoadedCanvas) => void): () => void {
    const set = this.listeners.get(documentId) ?? new Set();
    set.add(listener);
    this.listeners.set(documentId, set);
    return () => set.delete(listener);
  }

  async loadLayoutCache(
    documentId: string,
    variant: LayoutVariant,
  ): Promise<Record<string, Point> | null> {
    return this.read<Record<string, Point>>(`layout:${variant}:${documentId}`);
  }

  saveLayoutCache(
    documentId: string,
    variant: LayoutVariant,
    positions: Record<string, Point>,
  ): void {
    this.write(`layout:${variant}:${documentId}`, positions);
  }

  // --- Simulating the rest of the app -----------------------------------

  /** The document's blocks changed (her page edits, or an agent's): merge and notify. */
  setBlocks(documentId: string, blocks: Block[]): void {
    const doc = this.doc(documentId);
    doc.blocks = blocks;
    const merged = mergeDocumentBlocks(doc.canvas, blocks);
    doc.canvas = merged.canvas;
    this.write(`canvas:${documentId}`, doc.canvas);
    this.emit(documentId);
  }

  /** Replace the canvas as if an agent changed it on the server. */
  setCanvas(documentId: string, canvas: Canvas): void {
    this.doc(documentId).canvas = canvas;
    this.write(`canvas:${documentId}`, canvas);
    this.emit(documentId);
  }

  current(documentId: string): LoadedCanvas {
    return this.snapshot(documentId);
  }

  private emit(documentId: string): void {
    const snapshot = this.snapshot(documentId);
    for (const listener of this.listeners.get(documentId) ?? []) listener(snapshot);
  }
}
