import {
  type Block,
  type Card,
  type ConnectorKind,
  framesInOrder,
  newId,
  noteContent,
  type Sticker,
} from "@notes/schema";
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  ConnectionMode,
  type EdgeChange,
  type EdgeTypes,
  MiniMap,
  type NodeChange,
  NodeToolbar,
  type NodeTypes,
  type OnConnectEnd,
  Position,
  ReactFlow,
  type ReactFlowInstance,
  ReactFlowProvider,
  SelectionMode,
} from "@xyflow/react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "../../components/ui/button";
import { ConfirmDialog } from "../../components/ui/dialog";
import { Spinner } from "../../components/ui/states";
import { hueVar } from "../../lib/hues";
import "./canvas.css";
import { ConnectorEdge } from "./edges/ConnectorEdge";
import { shapeFor } from "./layout/elk-layout";
import type { LayoutRunner } from "./layout/layout-client";
import { type CanvasActions, CanvasActionsContext } from "./model/actions";
import { useDevice } from "./model/device";
import {
  buildEdges,
  buildNodes,
  type CanvasNode,
  type ConnectorEdge as ConnectorEdgeType,
  frameFamily,
  type ViewState,
} from "./model/flow";
import {
  type Alignment,
  alignPlacements,
  connectOps,
  deepestFrameAt,
  deleteOps,
  dropOps,
  frameDragPlacements,
  frameFromSelectionOps,
  freeSpot,
  newCardOps,
} from "./model/gestures";
import { useCanvasModel } from "./model/useCanvasModel";
import { CardNode } from "./nodes/CardNode";
import { FrameNode } from "./nodes/FrameNode";
import { FallbackBlock } from "./render/FallbackBlock";
import type { CanvasStore } from "./store/types";
import { useMomentum, useTouchGuards } from "./touch/touch";
import {
  ColorPicker,
  ConnectorEditor,
  FramePanel,
  StepBar,
  StickerPicker,
  ZoomLabel,
} from "./ui/chrome";
import { Icon } from "./ui/icons";
import { ToolButton as IconButton, PortalContext } from "./ui/primitives";

/** Node and edge types live outside components so React Flow never remounts them. */
const NODE_TYPES: NodeTypes = { card: CardNode, frame: FrameNode } as unknown as NodeTypes;
const EDGE_TYPES: EdgeTypes = { connector: ConnectorEdge } as unknown as EdgeTypes;
const DOUBLE_TAP_MS = 350;
const px = (n: number) => `${n}px` as const;
const now = () => new Date().toISOString();

export interface CanvasViewProps {
  store: CanvasStore;
  documentId: string;
  /** Renders a document block inside a card; the canvas has a fallback renderer. */
  renderBlock?: (block: Block) => ReactNode;
  /** Opening a block card (double-click or double-tap). */
  onOpenBlock?: (blockId: string) => void;
  /** Opening a concept card. */
  onOpenConcept?: (conceptId: string) => void;
  /** Switch this document to the page view. */
  onSwitchToPage?: () => void;
  /** Extra controls for the top bar (e.g. the shell's theme switch). */
  topBarExtras?: ReactNode;
  /** Leave the document title out of the top bar (the screen around the canvas already shows it). */
  hideTitle?: boolean;
  /** Measure: render only what is on screen (React Flow's culling). */
  onlyRenderVisible?: boolean;
  /** For tests: a layout runner that does not use a worker. */
  layoutRunner?: LayoutRunner;
}

/** The canvas view of a document (E1–E6). Mount it full-bleed inside the shell. */
/** Below this zoom the text of a card is too small to read comfortably. */
const READABLE_ZOOM = 0.7;

export function CanvasView(props: CanvasViewProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

interface Confirm {
  title: string;
  body: string;
  confirm: string;
  run: () => void;
}

function CanvasInner({
  store,
  documentId,
  renderBlock,
  onOpenBlock,
  onOpenConcept,
  onSwitchToPage,
  topBarExtras,
  hideTitle = false,
  onlyRenderVisible = false,
  layoutRunner,
}: CanvasViewProps) {
  // The map's shape is chosen once per mount, so rotating a tablet does not reshuffle it.
  const [shape] = useState(() =>
    typeof window === "undefined" ? undefined : shapeFor(window.innerWidth, window.innerHeight),
  );
  const model = useCanvasModel(store, documentId, { runner: layoutRunner, shape });
  const device = useDevice();
  const phone = device.device === "phone";
  const coarse = device.coarse;
  const duration = device.reducedMotion ? 0 : 320;

  const rootRef = useRef<HTMLDivElement>(null);
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  const flowRef = useRef<ReactFlowInstance | null>(null);
  useTouchGuards(rootRef);
  const momentum = useMomentum(flowRef as never, device.reducedMotion);

  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const nodesRef = useRef<CanvasNode[]>([]);
  nodesRef.current = nodes;
  const [selectedEdges, setSelectedEdges] = useState<Set<string>>(new Set());
  const [tool, setTool] = useState<"select" | "hand">("select");
  const [connectMode, setConnectMode] = useState(false);
  const [connectSource, setConnectSource] = useState<string | null>(null);
  const [readingId, setReadingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [touchMulti, setTouchMulti] = useState(false);
  const [panel, setPanel] = useState(false);
  const [step, setStep] = useState<number | null>(null);
  const [phoneMap, setPhoneMap] = useState(false);
  const [edgeEditor, setEdgeEditor] = useState<{ id: string; fresh: boolean } | null>(null);
  const [dropFrameId, setDropFrameId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const dragging = useRef(false);
  const lastTap = useRef<{ id: string; t: number } | null>(null);
  const frameDrag = useRef<{
    start: { x: number; y: number };
    members: Map<string, { x: number; y: number }>;
  } | null>(null);

  const canvas = model.canvas;
  const layout = model.layout;
  const frames = useMemo(() => (canvas ? framesInOrder(canvas) : []), [canvas]);
  // Phone: focused view by default (one frame at a time).
  const [phoneIndex, setPhoneIndex] = useState(0);
  const activeIndex = step ?? (phone && !phoneMap ? phoneIndex : null);
  const activeFrame =
    activeIndex !== null ? frames[Math.min(activeIndex, frames.length - 1)] : undefined;
  const activeFocus = useMemo(
    () => (canvas && activeFrame ? frameFamily(canvas, activeFrame.id) : null),
    [canvas, activeFrame],
  );

  const selectedIds = useMemo(
    () => new Set(nodes.filter((n) => n.selected).map((n) => n.id)),
    [nodes],
  );
  const selectedCards = useMemo(
    () => (canvas ? canvas.cards.filter((c) => selectedIds.has(c.id)) : []),
    [canvas, selectedIds],
  );
  const selectedFrames = useMemo(
    () => (canvas ? canvas.frames.filter((f) => selectedIds.has(f.id)) : []),
    [canvas, selectedIds],
  );

  // ---- Build nodes and edges from the model ----------------------------
  const viewState: ViewState = useMemo(
    () => ({
      readingId,
      editingId,
      connectSourceId: connectSource,
      focus: activeFocus,
      dropFrameId,
      selected: new Set([...selectedIds, ...selectedEdges]),
    }),
    [readingId, editingId, connectSource, activeFocus, dropFrameId, selectedIds, selectedEdges],
  );
  const viewRef = useRef(viewState);
  viewRef.current = viewState;

  // Selection lives in the node state, so it is read through refs: depending on it here would loop.
  // A layout effect, so new positions reach React Flow in the same commit as the layout: a card
  // that grew and the cards it pushed down are drawn moved together, never one frame apart.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the view fields listed are what rebuilds nodes
  useLayoutEffect(() => {
    if (!canvas || !layout || dragging.current) return;
    const prev = new Map(nodesRef.current.map((n) => [n.id, n]));
    setNodes(
      buildNodes(
        canvas,
        layout,
        model.blocks,
        {
          ...viewRef.current,
          selected: new Set([...nodesRef.current.filter((n) => n.selected).map((n) => n.id)]),
        },
        prev,
      ),
    );
  }, [canvas, layout, model.blocks, readingId, editingId, connectSource, activeFocus, dropFrameId]);

  const edgesRef = useRef<ConnectorEdgeType[]>([]);
  const edges = useMemo(() => {
    if (!canvas) return [];
    const prev = new Map(edgesRef.current.map((e) => [e.id, e]));
    const next = buildEdges(canvas, { ...viewState, selected: selectedEdges }, prev);
    edgesRef.current = next;
    return next;
  }, [canvas, viewState, selectedEdges]);

  // ---- Model shortcuts -------------------------------------------------
  const commit = model.commit;
  const actor = store.actor;

  const viewportCenter = useCallback(() => {
    const el = rootRef.current;
    const flow = flowRef.current;
    if (!el || !flow) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return flow.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  }, []);

  const placeNew = useCallback(
    async (
      card: Omit<Card, "position" | "dimensions" | "origin">,
      size: { width: number; height: number },
      message: string,
    ) => {
      if (!canvas || !layout) return null;
      const c = viewportCenter();
      const spot = freeSpot(
        Object.values(layout.cards),
        { x: c.x - size.width / 2, y: c.y - size.height / 2 },
        size,
      );
      const { ops, card: full } = newCardOps(
        canvas,
        layout.frames,
        card,
        { ...spot, ...size },
        actor,
        now(),
      );
      await commit(ops, { message });
      setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === full.id })));
      return full.id;
    },
    [actor, canvas, commit, layout, viewportCenter],
  );

  const addNote = useCallback(async () => {
    const id = await placeNew(
      { id: newId("card"), content: noteContent("New note"), size: "small", color: "yellow" },
      { width: 220, height: 70 },
      "Note added",
    );
    if (id) setEditingId(id);
  }, [placeNew]);

  const addSticker = useCallback(
    (sticker: Sticker) => {
      void placeNew(
        { id: newId("card"), content: { kind: "sticker", sticker }, size: "auto" },
        { width: 88, height: 88 },
        "Sticker added",
      );
    },
    [placeNew],
  );

  const connect = useCallback(
    async (from: string, to: string, kind: ConnectorKind = "related") => {
      const id = newId("edge");
      const ops = connectOps(from, to, id, kind);
      if (ops.length === 0) return;
      if (await commit(ops)) {
        setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));
        setSelectedEdges(new Set([id]));
        setEdgeEditor({ id, fresh: true });
      }
    },
    [commit],
  );

  const deleteSelection = useCallback(async () => {
    if (!canvas) return;
    const { ops, summary } = deleteOps(canvas, new Set([...selectedIds, ...selectedEdges]));
    if (ops.length === 0) return;
    setEdgeEditor(null);
    setSelectedEdges(new Set());
    await commit(ops, { message: summary });
  }, [canvas, commit, selectedEdges, selectedIds]);

  const makeFrame = useCallback(async () => {
    if (!canvas) return;
    const ops = frameFromSelectionOps(
      canvas,
      selectedCards.map((c) => c.id),
      newId("frame"),
    );
    await commit(ops, { message: "Frame added. Double-click its title to rename." });
  }, [canvas, commit, selectedCards]);

  const releasePins = useCallback(
    (ids: string[] | null) => {
      const count = ids
        ? ids.length
        : (canvas?.cards.filter((c) => c.position || c.dimensions).length ?? 0);
      if (count === 0) return;
      setConfirm({
        title: ids ? `Release ${count} card${count > 1 ? "s" : ""}?` : "Release every placed card?",
        body: `${count} card${count > 1 ? "s" : ""} you placed by hand will go back to automatic layout and may move.`,
        confirm: "Release",
        run: async () => {
          const ok = await commit([ids ? { op: "release_pins", ids } : { op: "release_pins" }], {
            message: "Released. Undo puts them back.",
          });
          if (ok) await model.autoArrange();
        },
      });
    },
    [canvas, commit, model],
  );

  const align = useCallback(
    (how: Alignment) => {
      const sel = nodesRef.current.filter((n) => n.selected && n.type === "card");
      const placements = alignPlacements(
        sel.map((n) => ({
          id: n.id,
          x: n.position.x,
          y: n.position.y,
          width: n.measured?.width ?? 0,
          height: n.measured?.height ?? 0,
        })),
        how,
      );
      if (placements.length) model.place(placements);
    },
    [model],
  );

  // ---- Viewport helpers --------------------------------------------------
  // Keep fitted content clear of the top bar and the bottom toolbar.
  const padding = useMemo(
    () => ({ top: px(phone ? 72 : 84), bottom: px(phone ? 84 : 92), x: px(phone ? 12 : 40) }),
    [phone],
  );
  const fitAll = useCallback(() => {
    void flowRef.current?.fitView({ padding, duration });
  }, [duration, padding]);

  const fitFrame = useCallback(
    (frameId: string) => {
      void flowRef.current?.fitView({ nodes: [{ id: frameId }], padding, duration, maxZoom: 1.4 });
    },
    [duration, padding],
  );

  const zoomToSelection = useCallback(() => {
    const ids = nodesRef.current.filter((n) => n.selected).map((n) => ({ id: n.id }));
    if (ids.length) void flowRef.current?.fitView({ nodes: ids, padding, duration, maxZoom: 1.5 });
  }, [duration, padding]);

  // Step-through and the phone's focused view follow the active frame.
  const lastFit = useRef<string | null>(null);
  useEffect(() => {
    if (!activeFrame || !model.layout) {
      lastFit.current = null;
      return;
    }
    const r = model.layout.frames[activeFrame.id];
    const key = r ? `${activeFrame.id}:${r.x}:${r.y}:${r.width}:${r.height}` : activeFrame.id;
    if (lastFit.current === key) return;
    lastFit.current = key;
    fitFrame(activeFrame.id);
  }, [activeFrame, fitFrame, model.layout]);

  const goStep = useCallback(
    (delta: number) => {
      if (step !== null) setStep((s) => Math.max(0, Math.min(frames.length - 1, (s ?? 0) + delta)));
      else setPhoneIndex((s) => Math.max(0, Math.min(frames.length - 1, s + delta)));
    },
    [frames.length, step],
  );

  const startStep = useCallback(() => {
    if (frames.length === 0) return;
    setPanel(false);
    setPhoneMap(false);
    setStep(0);
  }, [frames.length]);

  const exitStep = useCallback(() => {
    setStep(null);
    if (phone) setPhoneMap(true);
    lastFit.current = null;
    setTimeout(fitAll, 0);
  }, [fitAll, phone]);

  // ---- Actions for nodes and edges (stable) ------------------------------
  const live = useRef({ canvas, commit, renderBlock, coarse, measured: model.measured });
  live.current = { canvas, commit, renderBlock, coarse, measured: model.measured };
  const actions = useMemo<CanvasActions>(
    () => ({
      renderBlock: (block) =>
        live.current.renderBlock ? (
          live.current.renderBlock(block)
        ) : (
          <FallbackBlock block={block} />
        ),
      saveNote: (cardId, text) => {
        void live.current.commit([
          { op: "update_card", id: cardId, patch: { content: noteContent(text) } },
        ]);
      },
      stopEditing: () => setEditingId(null),
      stopReading: () => setReadingId(null),
      longPress: (cardId) => {
        setTouchMulti(true);
        setNodes((ns) => ns.map((n) => (n.id === cardId ? { ...n, selected: true } : n)));
      },
      editConnector: (edgeId) => {
        setSelectedEdges(new Set([edgeId]));
        setEdgeEditor({ id: edgeId, fresh: false });
      },
      renameFrame: (frameId, title) => {
        void live.current.commit([{ op: "update_frame", id: frameId, patch: { title } }]);
      },
      isCoarse: () => live.current.coarse,
      measureCard: (cardId, size) => live.current.measured(new Map([[cardId, size]])),
    }),
    [],
  );

  // ---- React Flow handlers ----------------------------------------------
  // Card sizes do not come from React Flow's measuring: a card is drawn in the box the layout gave
  // it (see CardNode), so React Flow measures the box. The card reports what its content needs.
  const onNodesChange = useCallback((changes: NodeChange<CanvasNode>[]) => {
    const kept = changes.filter((ch) => ch.type !== "remove"); // deletes go through the model (with undo)
    if (kept.length === 0) return;
    // Kept current at once: a layout that lands before React renders this change builds its nodes
    // from the ref and must not drop React Flow's measurements (a node without them is hidden).
    nodesRef.current = applyNodeChanges(kept, nodesRef.current);
    setNodes((ns) => applyNodeChanges(kept, ns));
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange<ConnectorEdgeType>[]) => {
    setSelectedEdges((prev) => {
      let next = prev;
      for (const ch of changes) {
        if (ch.type !== "select") continue;
        if (next === prev) next = new Set(prev);
        if (ch.selected) next.add(ch.id);
        else next.delete(ch.id);
      }
      return next;
    });
  }, []);

  const descendantsOfFrame = useCallback(
    (frameId: string) => {
      if (!canvas) return { cards: [] as string[], frames: [] as string[] };
      const family = frameFamily(canvas, frameId);
      const cards = canvas.frames.filter((f) => family.has(f.id)).flatMap((f) => f.members);
      return { cards, frames: [...family].filter((id) => id !== frameId) };
    },
    [canvas],
  );

  const onNodeDragStart = useCallback(
    (_e: unknown, node: CanvasNode) => {
      dragging.current = true;
      setReadingId(null);
      if (node.type === "frame") {
        const { cards, frames: inner } = descendantsOfFrame(node.id);
        const members = new Map<string, { x: number; y: number }>();
        for (const n of nodesRef.current)
          if (cards.includes(n.id) || inner.includes(n.id)) members.set(n.id, { ...n.position });
        frameDrag.current = { start: { ...node.position }, members };
      }
    },
    [descendantsOfFrame],
  );

  const onNodeDrag = useCallback(
    (_e: unknown, node: CanvasNode, dragged: CanvasNode[]) => {
      if (node.type === "frame" && frameDrag.current) {
        const { start, members } = frameDrag.current;
        const dx = node.position.x - start.x;
        const dy = node.position.y - start.y;
        setNodes((ns) =>
          ns.map((n) => {
            const at = members.get(n.id);
            return at ? { ...n, position: { x: at.x + dx, y: at.y + dy } } : n;
          }),
        );
        return;
      }
      if (!canvas || !layout || dragged.length !== 1 || node.type !== "card") return;
      const w = node.measured?.width ?? 0;
      const h = node.measured?.height ?? 0;
      const target = deepestFrameAt(
        canvas,
        layout.frames,
        node.position.x + w / 2,
        node.position.y + h / 2,
      );
      const current = canvas.frames.find((f) => f.members.includes(node.id));
      const next = target && target.id !== current?.id ? target.id : null;
      setDropFrameId((prev) => (prev === next ? prev : next));
    },
    [canvas, layout],
  );

  const onNodeDragStop = useCallback(
    (_e: unknown, node: CanvasNode, dragged: CanvasNode[]) => {
      dragging.current = false;
      setDropFrameId(null);
      if (!canvas || !layout) return;
      if (node.type === "frame") {
        frameDrag.current = null;
        const positions = new Map(nodesRef.current.map((n) => [n.id, n.position]));
        model.place(frameDragPlacements(canvas, node.id, positions));
        return;
      }
      const cards = dragged.filter((n) => n.type === "card");
      const { ops, into, leftFrame } = dropOps(
        canvas,
        layout.frames,
        cards.map((n) => ({
          id: n.id,
          x: n.position.x,
          y: n.position.y,
          width: n.measured?.width ?? 0,
          height: n.measured?.height ?? 0,
        })),
      );
      if (into || leftFrame)
        void commit(ops, {
          message: into ? `Moved into “${into.title}”` : "Taken out of its frame",
        });
      else {
        const place = ops[0];
        if (place?.op === "place_cards") model.place(place.placements);
      }
    },
    [canvas, commit, layout, model],
  );

  const onNodeClick = useCallback(
    (_e: React.MouseEvent, node: CanvasNode) => {
      if (!canvas) return;
      if (node.type === "card" && connectMode) {
        if (!connectSource) setConnectSource(node.id);
        else if (connectSource !== node.id) {
          void connect(connectSource, node.id);
          setConnectSource(null);
          setConnectMode(false);
        }
        return;
      }
      if (touchMulti) {
        setNodes((ns) => ns.map((n) => (n.id === node.id ? { ...n, selected: !n.selected } : n)));
        return;
      }
      const t = performance.now();
      const prev = lastTap.current;
      lastTap.current = { id: node.id, t };
      if (!prev || prev.id !== node.id || t - prev.t > DOUBLE_TAP_MS || node.type !== "card")
        return;
      lastTap.current = null;
      const card = canvas.cards.find((c) => c.id === node.id);
      if (!card) return;
      if (card.content.kind === "block") onOpenBlock?.(card.content.blockIds[0] as string);
      else if (card.content.kind === "note") setEditingId(card.id);
      else if (card.content.kind === "concept") onOpenConcept?.(card.content.conceptId);
    },
    [canvas, connect, connectMode, connectSource, onOpenBlock, onOpenConcept, touchMulti],
  );

  const onPaneClick = useCallback(() => {
    setReadingId(null);
    setEditingId(null);
    setEdgeEditor(null);
    if (connectMode) setConnectSource(null);
  }, [connectMode]);

  const onConnectEnd = useCallback<OnConnectEnd>(
    (event, state) => {
      if (state.isValid || !state.fromNode) {
        if (state.isValid && state.fromNode && state.toNode)
          void connect(state.fromNode.id, state.toNode.id);
        return;
      }
      const point = "changedTouches" in event ? event.changedTouches[0] : (event as MouseEvent);
      if (!point) return;
      const el = document
        .elementFromPoint(point.clientX, point.clientY)
        ?.closest(".react-flow__node-card");
      const id = el?.getAttribute("data-id");
      if (id && id !== state.fromNode.id) void connect(state.fromNode.id, id);
    },
    [connect],
  );

  // ---- Keyboard shortcuts (computer) ---------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === "z") {
        e.preventDefault();
        void (e.shiftKey ? model.redo() : model.undo());
      } else if (mod && k === "y") {
        e.preventDefault();
        void model.redo();
      } else if (mod) {
        return;
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        void deleteSelection();
      } else if (e.key === "Escape") {
        setConnectMode(false);
        setConnectSource(null);
        setReadingId(null);
        setEditingId(null);
        setEdgeEditor(null);
        setTouchMulti(false);
        if (step !== null) exitStep();
        else setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));
      } else if (
        step !== null &&
        (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === " ")
      ) {
        e.preventDefault();
        goStep(1);
      } else if (step !== null && (e.key === "ArrowLeft" || e.key === "ArrowUp")) {
        e.preventDefault();
        goStep(-1);
      } else if (e.shiftKey && e.code === "Digit1") fitAll();
      else if (e.shiftKey && e.code === "Digit2") zoomToSelection();
      else if (k === "v") setTool("select");
      else if (k === "h") setTool("hand");
      else if (k === "n") void addNote();
      else if (k === "c") setConnectMode((m) => !m);
      else if (k === "f") void makeFrame();
      else if (k === "=" || k === "+") flowRef.current?.zoomIn({ duration });
      else if (k === "-") flowRef.current?.zoomOut({ duration });
      else if (k === "enter" && selectedCards.length === 1) {
        const card = selectedCards[0] as Card;
        if (card.content.kind === "block") setReadingId(card.id);
        if (card.content.kind === "note") setEditingId(card.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    addNote,
    deleteSelection,
    duration,
    exitStep,
    fitAll,
    goStep,
    makeFrame,
    model,
    selectedCards,
    step,
    zoomToSelection,
  ]);

  // Fit once the first measured layout lands (unless a frame is focused): fitting the estimated one
  // would frame a map that is about to change shape.
  const fitted = useRef(false);
  // The map is shown once it is laid out with measured sizes and framed.
  const [framed, setFramed] = useState(false);
  useEffect(() => {
    if (fitted.current || !layout || !model.settled || nodes.length === 0) return;
    if (activeFrame) {
      // A focused frame (phone, step-through) frames itself; the whole map is fitted when she
      // first leaves it, as before.
      setFramed(true);
      return;
    }
    fitted.current = true;
    // Framing never keeps the map hidden for long, even if a fit never reports back.
    setTimeout(() => setFramed(true), 500);
    requestAnimationFrame(() => {
      const flow = flowRef.current;
      if (!flow) {
        setFramed(true);
        return;
      }
      // A whole map that would be drawn too small to read (a portrait tablet) opens on its first
      // frame instead, or as large as is readable; "Whole map" shows all of it.
      void flow
        .fitView({ padding })
        .then(async () => {
          if (phone || flow.getZoom() >= READABLE_ZOOM) return;
          const first = frames[0];
          if (first) await flow.fitView({ nodes: [{ id: first.id }], padding, maxZoom: 1.2 });
          else await flow.fitView({ padding, minZoom: READABLE_ZOOM });
        })
        .finally(() => setFramed(true));
    });
  }, [activeFrame, frames, layout, model.settled, nodes.length, padding, phone]);
  // A document with nothing in it has no cards to measure or frame: show the empty map at once
  // instead of waiting for a layout that will never come.
  const nothingToLayOut = model.status === "ready" && nodes.length === 0;
  const shown = nothingToLayOut || (model.settled && framed);

  // ---- Render ------------------------------------------------------------------
  if (model.status === "error")
    return (
      <div className="nc-canvas nc-loading" role="alert">
        Could not open the canvas: {model.error}
      </div>
    );

  const editedEdge = edgeEditor && canvas?.connectors.find((e) => e.id === edgeEditor.id);
  const singleCard = selectedCards.length === 1 ? selectedCards[0] : undefined;
  const singleFrame =
    selectedFrames.length === 1 && selectedCards.length === 0 ? selectedFrames[0] : undefined;
  const pinnedSelected = selectedCards.filter((c) => c.position || c.dimensions).map((c) => c.id);
  const showMinimap = !phone && !!layout && step === null;
  const panOnDrag = coarse || tool === "hand" ? true : [1, 2];
  const rootClass = [
    "nc-canvas",
    coarse ? "nc-coarse" : "nc-fine",
    connectMode ? "nc-connecting" : "",
    shown ? "" : "nc-unsettled",
  ].join(" ");

  const stepBar = activeFrame ? (
    <StepBar
      inline={phone}
      index={Math.min(activeIndex ?? 0, frames.length - 1)}
      total={frames.length}
      title={activeFrame.title}
      onPrev={() => goStep(-1)}
      onNext={() => goStep(1)}
      onExit={
        step !== null
          ? exitStep
          : () => {
              setPhoneMap(true);
              lastFit.current = null;
              setTimeout(fitAll, 0);
            }
      }
      exitLabel={step !== null ? "Exit step-through" : "Whole map"}
      exitIcon={step !== null ? "close" : "map"}
    />
  ) : null;

  return (
    <div
      ref={(el) => {
        rootRef.current = el;
        setPortal((p) => p ?? el);
      }}
      className={rootClass}
      data-testid="canvas-view"
      data-device={device.device}
      data-ready={model.status === "ready" && layout && shown ? "true" : "false"}
      data-layout-ms={model.layoutMs !== null ? Math.round(model.layoutMs) : undefined}
    >
      <PortalContext.Provider value={portal}>
        <CanvasActionsContext.Provider value={actions}>
          {!shown && <div className="nc-loading">Opening the canvas…</div>}
          <ReactFlow<CanvasNode, ConnectorEdgeType>
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            onInit={(instance) => {
              flowRef.current = instance as unknown as ReactFlowInstance;
            }}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeDragStart={onNodeDragStart}
            onNodeDrag={onNodeDrag}
            onNodeDragStop={onNodeDragStop}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            onConnect={() => {}}
            onConnectEnd={onConnectEnd}
            onMoveStart={momentum.onMoveStart}
            onMove={momentum.onMove}
            onMoveEnd={momentum.onMoveEnd}
            connectionMode={ConnectionMode.Loose}
            connectOnClick={false}
            nodesConnectable={!coarse}
            deleteKeyCode={null}
            selectionKeyCode={coarse ? null : "Shift"}
            multiSelectionKeyCode={coarse ? null : ["Meta", "Control", "Shift"]}
            selectionOnDrag={!coarse && tool === "select"}
            selectionMode={SelectionMode.Partial}
            panOnDrag={panOnDrag}
            panOnScroll={!coarse}
            zoomOnScroll={false}
            zoomOnPinch
            zoomOnDoubleClick
            nodeDragThreshold={coarse ? 6 : 3}
            minZoom={0.08}
            maxZoom={2.5}
            onlyRenderVisibleElements={onlyRenderVisible}
            elevateNodesOnSelect={false}
            elevateEdgesOnSelect={false}
            attributionPosition="bottom-left"
            aria-label="Canvas"
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={24}
              size={1.6}
              color="var(--color-dot)"
            />
            {showMinimap && (
              <MiniMap<CanvasNode>
                pannable
                zoomable
                bgColor="var(--color-chrome)"
                maskColor="color-mix(in srgb, var(--color-overlay) 30%, transparent)"
                maskStrokeColor="var(--color-selection)"
                maskStrokeWidth={2}
                position="bottom-right"
                ariaLabel="Mini map"
                nodeBorderRadius={6}
                nodeColor={(n) =>
                  n.type === "frame"
                    ? "transparent"
                    : n.data.card.color
                      ? hueVar(n.data.card.color, "border")
                      : "var(--color-border-strong)"
                }
                nodeStrokeColor={(n) =>
                  n.type !== "frame"
                    ? "transparent"
                    : n.data.frame.color
                      ? hueVar(n.data.frame.color, "border")
                      : "var(--color-border-strong)"
                }
                nodeStrokeWidth={6}
                style={{ width: 180, height: 120 }}
              />
            )}
            {!touchMulti &&
              !connectMode &&
              !edgeEditor &&
              (singleCard || selectedCards.length > 1) && (
                <NodeToolbar
                  nodeId={selectedCards.map((c) => c.id)}
                  isVisible={!dragging.current}
                  position={Position.Top}
                  offset={12}
                >
                  <div className="nc-seltools nc-chrome" data-testid="selection-toolbar">
                    {singleCard ? (
                      <>
                        {singleCard.content.kind === "block" && (
                          <>
                            <IconButton
                              icon="read"
                              label={readingId === singleCard.id ? "Stop reading" : "Read here"}
                              pressed={readingId === singleCard.id}
                              onClick={() =>
                                setReadingId((r) => (r === singleCard.id ? null : singleCard.id))
                              }
                            />
                            <IconButton
                              icon="open"
                              label="Open in page"
                              onClick={() =>
                                singleCard.content.kind === "block" &&
                                onOpenBlock?.(singleCard.content.blockIds[0] as string)
                              }
                            />
                          </>
                        )}
                        {singleCard.content.kind === "note" && (
                          <IconButton
                            icon="edit"
                            label="Edit note"
                            onClick={() => setEditingId(singleCard.id)}
                          />
                        )}
                        <IconButton
                          icon="connect"
                          label="Connect from here"
                          onClick={() => {
                            setConnectMode(true);
                            setConnectSource(singleCard.id);
                          }}
                        />
                        {singleCard.content.kind !== "sticker" && (
                          <ColorPicker
                            value={singleCard.color}
                            onPick={(color) =>
                              void commit([
                                { op: "update_card", id: singleCard.id, patch: { color } },
                              ])
                            }
                            label="Card color"
                            trigger={<IconButton icon="palette" label="Color" />}
                          />
                        )}
                        {canvas?.frames.some((f) => f.members.includes(singleCard.id)) && (
                          <IconButton
                            icon="ungroup"
                            label="Take out of frame"
                            onClick={() =>
                              void commit([{ op: "remove_from_frame", cards: [singleCard.id] }], {
                                message: "Taken out of its frame",
                              })
                            }
                          />
                        )}
                      </>
                    ) : (
                      <>
                        <IconButton
                          icon="alignLeft"
                          label="Align left edges"
                          onClick={() => align("left")}
                        />
                        <IconButton
                          icon="alignTop"
                          label="Align top edges"
                          onClick={() => align("top")}
                        />
                        <IconButton
                          icon="alignCenter"
                          label="Center in a column"
                          onClick={() => align("center")}
                        />
                        <IconButton
                          icon="distribute"
                          label="Space evenly"
                          onClick={() => align("distribute")}
                        />
                        <IconButton
                          icon="frame"
                          label="Frame these cards"
                          onClick={() => void makeFrame()}
                        />
                        <IconButton
                          icon="focus"
                          label="Zoom to selection"
                          onClick={zoomToSelection}
                        />
                      </>
                    )}
                    {pinnedSelected.length > 0 && (
                      <IconButton
                        icon="unpin"
                        label="Release to automatic layout"
                        onClick={() => releasePins(pinnedSelected)}
                      />
                    )}
                    <IconButton
                      icon="trash"
                      label="Delete"
                      danger
                      onClick={() => void deleteSelection()}
                    />
                  </div>
                </NodeToolbar>
              )}
            {singleFrame && !touchMulti && (
              <NodeToolbar nodeId={singleFrame.id} position={Position.Top} offset={8} align="start">
                <div className="nc-seltools nc-chrome" data-testid="frame-toolbar">
                  <ColorPicker
                    value={singleFrame.color}
                    onPick={(color) =>
                      void commit([{ op: "update_frame", id: singleFrame.id, patch: { color } }])
                    }
                    label="Frame color"
                    trigger={<IconButton icon="palette" label="Frame color" />}
                  />
                  <IconButton
                    icon="focus"
                    label="Zoom to frame"
                    onClick={() => fitFrame(singleFrame.id)}
                  />
                  <IconButton
                    icon="trash"
                    label="Delete frame (cards stay)"
                    danger
                    onClick={() =>
                      void commit([{ op: "remove_frame", id: singleFrame.id }], {
                        message: "Frame deleted; its cards stay",
                      })
                    }
                  />
                </div>
              </NodeToolbar>
            )}
          </ReactFlow>

          {/* Top bar */}
          <header className="nc-topbar">
            {phone && activeFrame ? (
              stepBar
            ) : hideTitle && !onSwitchToPage ? null : (
              <div className="nc-title-pill nc-chrome">
                {!hideTitle && (
                  <span className="nc-title-text" title={model.documentTitle}>
                    {model.documentTitle || "Canvas"}
                  </span>
                )}
                {onSwitchToPage && (
                  <IconButton
                    icon="page"
                    label="Page view"
                    showLabel={!phone}
                    onClick={onSwitchToPage}
                  />
                )}
              </div>
            )}
            {!(phone && activeFrame) && <div style={{ flex: 1 }} />}
            <div className="nc-title-pill nc-tools-pill nc-chrome">
              {!phone && (
                <>
                  <IconButton
                    icon="undo"
                    label="Undo"
                    disabled={!model.canUndo}
                    onClick={() => void model.undo()}
                  />
                  <IconButton
                    icon="redo"
                    label="Redo"
                    disabled={!model.canRedo}
                    onClick={() => void model.redo()}
                  />
                </>
              )}
              <IconButton
                icon="list"
                label="Frames"
                pressed={panel}
                onClick={() => setPanel((p) => !p)}
              />
              {topBarExtras}
            </div>
          </header>

          {/* Step-through (E5); on a phone it sits in the top bar instead. */}
          {activeFrame && !phone && stepBar}

          {panel && canvas && (
            <FramePanel
              frames={canvas.frames}
              phone={phone}
              onClose={() => setPanel(false)}
              onStep={startStep}
              onJump={(id) => {
                if (phone) {
                  setPhoneMap(false);
                  setPhoneIndex(
                    Math.max(
                      0,
                      frames.findIndex((f) => f.id === id),
                    ),
                  );
                  setPanel(false);
                } else fitFrame(id);
              }}
              onRename={(id, title) => void commit([{ op: "update_frame", id, patch: { title } }])}
              onDelete={(id) =>
                void commit([{ op: "remove_frame", id }], {
                  message: "Frame deleted; its cards stay",
                })
              }
              onMove={(id, order) => void commit([{ op: "update_frame", id, patch: { order } }])}
            />
          )}

          {editedEdge && (
            <ConnectorEditor
              key={editedEdge.id}
              connector={editedEdge}
              autoFocus={edgeEditor?.fresh && !coarse}
              onClose={() => setEdgeEditor(null)}
              onDelete={() => {
                setEdgeEditor(null);
                void commit([{ op: "remove_connector", id: editedEdge.id }], {
                  message: "Connector deleted",
                });
              }}
              onChange={(patch) =>
                void commit([{ op: "update_connector", id: editedEdge.id, patch }])
              }
            />
          )}

          {(connectMode || touchMulti) && (
            <div className="nc-hint nc-chrome" role="status" data-testid="mode-hint">
              <span>
                {connectMode
                  ? connectSource
                    ? "Now tap the card to connect to"
                    : "Tap the card to start from"
                  : `${selectedIds.size} selected · tap cards to add or remove`}
              </span>
              {touchMulti && selectedCards.length > 0 && (
                <IconButton
                  icon="trash"
                  label="Delete selected"
                  danger
                  onClick={() => void deleteSelection()}
                />
              )}
              {touchMulti && selectedCards.length > 1 && (
                <IconButton icon="frame" label="Frame selected" onClick={() => void makeFrame()} />
              )}
              <Button
                variant="ghost"
                className="nc-tool"
                onClick={() => {
                  setConnectMode(false);
                  setConnectSource(null);
                  setTouchMulti(false);
                }}
              >
                Done
              </Button>
            </div>
          )}

          {model.arranging && (
            <div className="nc-arranging nc-chrome" data-testid="arranging">
              <Spinner inline label="Arranging…" />
            </div>
          )}

          {model.message && (
            <Toast
              message={model.message}
              onUndo={() => void model.undo()}
              onClose={model.dismissMessage}
            />
          )}

          {/* Bottom toolbar */}
          <nav
            className="nc-toolbar nc-chrome"
            aria-label="Canvas tools"
            data-testid="canvas-toolbar"
          >
            {phone ? (
              <>
                <IconButton icon="note" label="Add note" onClick={() => void addNote()} />
                <StickerPicker
                  onPick={addSticker}
                  trigger={<IconButton icon="sticker" label="Add sticker" />}
                />
                <IconButton
                  icon="connect"
                  label="Connect cards"
                  pressed={connectMode}
                  onClick={() => {
                    setConnectMode((m) => !m);
                    setConnectSource(null);
                  }}
                />
                <span className="nc-sep" />
                <IconButton
                  icon="undo"
                  label="Undo"
                  disabled={!model.canUndo}
                  onClick={() => void model.undo()}
                />
                <IconButton
                  icon={phoneMap ? "focus" : "map"}
                  label={phoneMap ? "One frame at a time" : "Whole map"}
                  onClick={() => {
                    lastFit.current = null;
                    if (phoneMap) setPhoneMap(false);
                    else {
                      setPhoneMap(true);
                      setStep(null);
                      setTimeout(fitAll, 0);
                    }
                  }}
                />
                <IconButton
                  icon="arrange"
                  label="Auto-arrange"
                  onClick={() => void model.autoArrange()}
                />
              </>
            ) : (
              <>
                {!coarse && (
                  <>
                    <IconButton
                      icon="select"
                      label="Select (V)"
                      pressed={tool === "select"}
                      onClick={() => setTool("select")}
                    />
                    <IconButton
                      icon="hand"
                      label="Hand (H)"
                      pressed={tool === "hand"}
                      onClick={() => setTool("hand")}
                    />
                    <span className="nc-sep" />
                  </>
                )}
                <IconButton icon="note" label="Add note (N)" onClick={() => void addNote()} />
                <StickerPicker
                  onPick={addSticker}
                  trigger={<IconButton icon="sticker" label="Add sticker" />}
                />
                <IconButton
                  icon="connect"
                  label="Connect cards (C)"
                  pressed={connectMode}
                  onClick={() => {
                    setConnectMode((m) => !m);
                    setConnectSource(null);
                  }}
                />
                <IconButton icon="frame" label="Frame (F)" onClick={() => void makeFrame()} />
                <span className="nc-sep" />
                <IconButton
                  icon="arrange"
                  label="Auto-arrange"
                  onClick={() => void model.autoArrange()}
                />
                <IconButton
                  icon="unpin"
                  label="Release all placed cards"
                  onClick={() => releasePins(null)}
                />
                <IconButton
                  icon="play"
                  label="Step through frames"
                  pressed={step !== null}
                  onClick={() => (step !== null ? exitStep() : startStep())}
                />
                <span className="nc-sep" />
                <IconButton
                  icon="zoomOut"
                  label="Zoom out"
                  onClick={() => flowRef.current?.zoomOut({ duration })}
                />
                <ZoomLabel />
                <IconButton
                  icon="zoomIn"
                  label="Zoom in"
                  onClick={() => flowRef.current?.zoomIn({ duration })}
                />
                <IconButton icon="fit" label="Whole map (Shift+1)" onClick={fitAll} />
                <IconButton
                  icon="focus"
                  label="Zoom to selection (Shift+2)"
                  disabled={selectedIds.size === 0}
                  onClick={zoomToSelection}
                />
              </>
            )}
          </nav>

          <ConfirmDialog
            open={!!confirm}
            onOpenChange={(open) => {
              if (!open) setConfirm(null);
            }}
            container={portal}
            title={confirm?.title ?? ""}
            description={confirm?.body ?? ""}
            confirmLabel={confirm?.confirm ?? "OK"}
            onConfirm={() => {
              const run = confirm?.run;
              setConfirm(null);
              run?.();
            }}
          />
          <span className="sr-only" aria-live="polite">
            {model.layoutMs !== null ? `Laid out ${canvas?.cards.length ?? 0} cards` : ""}
          </span>
        </CanvasActionsContext.Provider>
      </PortalContext.Provider>
    </div>
  );
}

function Toast({
  message,
  onUndo,
  onClose,
}: {
  message: { text: string; undo?: boolean };
  onUndo: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onClose, message.undo ? 6000 : 3500);
    return () => clearTimeout(t);
  }, [message, onClose]);
  return (
    <div className="nc-toast nc-chrome" role="status" data-testid="toast">
      <span>{message.text}</span>
      {message.undo && (
        <Button
          variant="ghost"
          className="nc-tool font-semibold"
          onClick={() => {
            onUndo();
            onClose();
          }}
        >
          <Icon name="undo" size={18} /> Undo
        </Button>
      )}
      <IconButton icon="close" label="Dismiss" onClick={onClose} />
    </div>
  );
}
