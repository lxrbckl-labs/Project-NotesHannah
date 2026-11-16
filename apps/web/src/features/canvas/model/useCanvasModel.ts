import {
  applyCanvasChange,
  type Block,
  buildLayoutInput,
  type Canvas,
  type CanvasOp,
  type Card,
  estimateCardSize,
  isFreeCard,
  type LayoutResult,
  type Point,
  resolveLayout,
  type Size,
} from "@notes/schema";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_SHAPE, type LayoutShape } from "../layout/elk-layout";
import { createLayoutRunner, type LayoutRunner } from "../layout/layout-client";
import type { CanvasStore, LoadedCanvas, Placement } from "../store/types";
import { diffOps } from "./diff";

/**
 * The canvas's state machine: load, apply her changes optimistically
 * through the same rules as the server, undo and redo, and keep the layout
 * up to date. Layout policy:
 * - first open: anchored on the saved layout cache, or a full ELK layout;
 * - first measurement: re-layout with measured sizes (full when nothing was
 *   cached, anchored otherwise);
 * - later structure or size changes: anchored (existing cards stay put,
 *   new ones are placed by ELK);
 * - "auto-arrange": full layout of the unpinned cards; pins never move.
 */

export type LayoutMode = "full" | "anchored";

export interface CanvasModel {
  status: "loading" | "ready" | "error";
  error: string | null;
  canvas: Canvas | null;
  blocks: Map<string, Block>;
  documentTitle: string;
  layout: LayoutResult | null;
  arranging: boolean;
  layoutMs: number | null;
  canUndo: boolean;
  canRedo: boolean;
  message: { text: string; undo?: boolean } | null;
  dismissMessage(): void;
  /** Apply structure ops; returns false when refused. */
  commit(ops: CanvasOp[], options?: { message?: string; undoable?: boolean }): Promise<boolean>;
  /** Pin cards where she dropped them. */
  place(placements: Placement[]): void;
  /** Measured card sizes from the browser. */
  measured(sizes: Map<string, Size>): void;
  autoArrange(): Promise<void>;
  undo(): Promise<void>;
  redo(): Promise<void>;
}

const UNDO_LIMIT = 60;

/** A canvas to return to, with where its unpinned cards were drawn. */
interface HistoryEntry {
  canvas: Canvas;
  positions: Record<string, Point>;
}
/** Above this many cards the "arranging" state is shown while ELK runs. */
const ARRANGE_NOTICE_CARDS = 40;

export function useCanvasModel(
  store: CanvasStore,
  documentId: string,
  options: { runner?: LayoutRunner; shape?: LayoutShape } = {},
): CanvasModel {
  const runnerOverride = options.runner;
  const shape = options.shape ?? DEFAULT_SHAPE;
  const variant = shape.direction === "DOWN" ? "tall" : "wide";
  const [status, setStatus] = useState<CanvasModel["status"]>("loading");
  const [error, setError] = useState<string | null>(null);
  const [canvas, setCanvasState] = useState<Canvas | null>(null);
  const [blockList, setBlockList] = useState<Block[]>([]);
  const [documentTitle, setTitle] = useState("");
  const [layout, setLayout] = useState<LayoutResult | null>(null);
  const [arranging, setArranging] = useState(false);
  const [layoutMs, setLayoutMs] = useState<number | null>(null);
  const [message, setMessage] = useState<CanvasModel["message"]>(null);
  const [history, setHistory] = useState({ undo: 0, redo: 0 });

  const canvasRef = useRef<Canvas | null>(null);
  const blocksRef = useRef<Map<string, Block>>(new Map());
  const layoutRef = useRef<LayoutResult | null>(null);
  const measuredRef = useRef(new Map<string, Size>());
  const usedSizes = useRef(new Map<string, Size>());
  const measuredOnce = useRef(false);
  const cachedStart = useRef(false);
  const undoStack = useRef<HistoryEntry[]>([]);
  const redoStack = useRef<HistoryEntry[]>([]);
  const inflight = useRef(0);
  const layoutSeq = useRef(0);
  const runner = useMemo(() => runnerOverride ?? createLayoutRunner(), [runnerOverride]);
  useEffect(() => () => runner.dispose(), [runner]);

  const blocks = useMemo(() => new Map(blockList.map((b) => [b.id, b])), [blockList]);
  blocksRef.current = blocks;

  const setCanvas = useCallback((next: Canvas) => {
    canvasRef.current = next;
    setCanvasState(next);
  }, []);

  const syncHistory = useCallback(
    () => setHistory({ undo: undoStack.current.length, redo: redoStack.current.length }),
    [],
  );

  const sizeOf = useCallback((card: Card): Size => {
    if (card.dimensions) return { width: card.dimensions.width, height: card.dimensions.height };
    return measuredRef.current.get(card.id) ?? estimateCardSize(card, blocksRef.current);
  }, []);

  const relayout = useCallback(
    async (mode: LayoutMode, start?: Record<string, Point> | null) => {
      const current = canvasRef.current;
      if (!current) return;
      const seq = ++layoutSeq.current;
      let previous: Record<string, Point> | undefined;
      if (mode === "anchored") {
        previous = {};
        const source = start ?? layoutRef.current?.cards ?? {};
        for (const card of current.cards) {
          const at = source[card.id];
          if (!card.position && at) previous[card.id] = { x: at.x, y: at.y };
        }
      }
      const input = buildLayoutInput(current, { sizeOf, previous });
      usedSizes.current = new Map(
        input.cards.map((c) => [c.id, { width: c.width, height: c.height }]),
      );
      const t0 = performance.now();
      let result: LayoutResult;
      if (!input.cards.some(isFreeCard)) {
        result = resolveLayout(input, { graph: {} });
      } else {
        const big = input.cards.filter(isFreeCard).length >= ARRANGE_NOTICE_CARDS;
        if (big) setArranging(true);
        try {
          result = await runner.run(input, shape);
        } finally {
          if (big && seq === layoutSeq.current) setArranging(false);
        }
      }
      if (seq !== layoutSeq.current) return; // a newer layout is on its way
      setLayoutMs(performance.now() - t0);
      layoutRef.current = result;
      setLayout(result);
      const positions: Record<string, Point> = {};
      for (const card of current.cards)
        if (!card.position) {
          const r = result.cards[card.id];
          if (r) positions[card.id] = { x: r.x, y: r.y };
        }
      store.saveLayoutCache(documentId, variant, positions);
    },
    [documentId, runner, shape, sizeOf, store, variant],
  );

  const adopt = useCallback(
    (loaded: LoadedCanvas) => {
      setBlockList(loaded.blocks);
      blocksRef.current = new Map(loaded.blocks.map((b) => [b.id, b]));
      setTitle(loaded.documentTitle);
      setCanvas(loaded.canvas);
    },
    [setCanvas],
  );

  // Load, then subscribe to changes made elsewhere.
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    measuredOnce.current = false;
    (async () => {
      try {
        const [loaded, cache] = await Promise.all([
          store.load(documentId),
          store.loadLayoutCache(documentId, variant),
        ]);
        if (cancelled) return;
        adopt(loaded);
        cachedStart.current = !!cache && Object.keys(cache).length > 0;
        await relayout(cachedStart.current ? "anchored" : "full", cache);
        if (!cancelled) setStatus("ready");
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setStatus("error");
        }
      }
    })();
    const unsubscribe = store.subscribe(documentId, (next) => {
      if (inflight.current > 0) return; // our own change; its result arrives through commit
      adopt(next);
      void relayout("anchored");
    });
    return () => {
      cancelled = true;
      unsubscribe();
      void store.flush();
    };
  }, [adopt, documentId, relayout, store, variant]);

  const snapshot = useCallback((canvas: Canvas): HistoryEntry => {
    const positions: Record<string, Point> = {};
    for (const [id, r] of Object.entries(layoutRef.current?.cards ?? {}))
      positions[id] = { x: r.x, y: r.y };
    return { canvas, positions };
  }, []);

  const pushUndo = useCallback(
    (before: Canvas) => {
      undoStack.current.push(snapshot(before));
      if (undoStack.current.length > UNDO_LIMIT) undoStack.current.shift();
      redoStack.current = [];
      syncHistory();
    },
    [snapshot, syncHistory],
  );

  const applyLocal = useCallback(
    (ops: CanvasOp[]) => {
      const before = canvasRef.current;
      if (!before) return null;
      const result = applyCanvasChange(
        before,
        { documentId, ops },
        { actor: store.actor, documentBlockIds: [...blocksRef.current.keys()] },
      );
      return { before, result };
    },
    [documentId, store.actor],
  );

  const commit = useCallback<CanvasModel["commit"]>(
    async (ops, options = {}) => {
      const local = applyLocal(ops);
      if (!local) return false;
      const { before, result } = local;
      if (!result.ok) {
        setMessage({ text: result.problems[0]?.message ?? "That change is not possible." });
        return false;
      }
      if (!result.changed) return true;
      if (options.undoable !== false) pushUndo(before);
      setCanvas(result.canvas);
      if (options.message) setMessage({ text: options.message, undo: options.undoable !== false });
      void relayout("anchored");
      inflight.current += 1;
      try {
        const saved = await store.apply(documentId, ops);
        if (!saved.ok) {
          setMessage({
            text: `Not saved: ${saved.problems[0]?.message ?? "the server refused the change"}`,
          });
          if (canvasRef.current === result.canvas) {
            setCanvas(before);
            void relayout("anchored");
          }
          return false;
        }
        // The server is the source of truth once nothing else is in flight.
        if (inflight.current === 1 && saved.canvas.revision !== canvasRef.current?.revision) {
          setCanvas(saved.canvas);
          void relayout("anchored");
        }
        return true;
      } finally {
        inflight.current -= 1;
      }
    },
    [applyLocal, documentId, pushUndo, relayout, setCanvas, store],
  );

  const place = useCallback<CanvasModel["place"]>(
    (placements) => {
      if (placements.length === 0) return;
      const local = applyLocal([{ op: "place_cards", placements }]);
      if (!local?.result.ok) return;
      pushUndo(local.before);
      setCanvas(local.result.canvas);
      store.savePlacements(documentId, placements);
      void relayout("anchored");
    },
    [applyLocal, documentId, pushUndo, relayout, setCanvas, store],
  );

  const measuredTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const measured = useCallback<CanvasModel["measured"]>(
    (sizes) => {
      let changed = false;
      for (const [id, size] of sizes) {
        const used = usedSizes.current.get(id);
        const card = canvasRef.current?.cards.find((c) => c.id === id);
        if (!card || card.dimensions) continue;
        measuredRef.current.set(id, size);
        if (
          !used ||
          Math.abs(used.height - size.height) > 4 ||
          Math.abs(used.width - size.width) > 4
        )
          changed = true;
      }
      if (!changed) return;
      if (measuredTimer.current) clearTimeout(measuredTimer.current);
      measuredTimer.current = setTimeout(() => {
        const first = !measuredOnce.current;
        measuredOnce.current = true;
        void relayout(first && !cachedStart.current ? "full" : "anchored");
      }, 120);
    },
    [relayout],
  );

  const autoArrange = useCallback(async () => {
    await relayout("full");
    setMessage({ text: "Arranged. Cards you placed stayed where they are." });
  }, [relayout]);

  const travel = useCallback(
    async (from: "undo" | "redo") => {
      const stack = from === "undo" ? undoStack.current : redoStack.current;
      const other = from === "undo" ? redoStack.current : undoStack.current;
      const entry = stack.pop();
      const current = canvasRef.current;
      if (!entry || !current) return;
      other.push(snapshot(current));
      syncHistory();
      const ops = diffOps(current, entry.canvas);
      if (ops.length === 0) return;
      const local = applyLocal(ops);
      if (!local?.result.ok) {
        setMessage({ text: "Could not undo that: the canvas changed since." });
        return;
      }
      setCanvas(local.result.canvas);
      void relayout("anchored", entry.positions);
      inflight.current += 1;
      try {
        await store.flush();
        await store.apply(documentId, ops);
      } finally {
        inflight.current -= 1;
      }
    },
    [applyLocal, documentId, relayout, setCanvas, snapshot, store, syncHistory],
  );

  const undo = useCallback(() => travel("undo"), [travel]);
  const redo = useCallback(() => travel("redo"), [travel]);
  const dismissMessage = useCallback(() => setMessage(null), []);

  return {
    status,
    error,
    canvas,
    blocks,
    documentTitle,
    layout,
    arranging,
    layoutMs,
    canUndo: history.undo > 0,
    canRedo: history.redo > 0,
    message,
    dismissMessage,
    commit,
    place,
    measured,
    autoArrange,
    undo,
    redo,
  };
}
