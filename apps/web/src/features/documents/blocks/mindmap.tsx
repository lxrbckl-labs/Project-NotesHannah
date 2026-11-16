import {
  BLOCK_LIMITS,
  type BlockOf,
  type ColorToken,
  type MindMapNode,
  walkMindMap,
} from "@notes/schema";
import { Maximize2, Minus, Plus } from "lucide-react";
import {
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { IconButton } from "../../../components/ui/button";
import { hueVar, seriesHue } from "../../../lib/hues";
import { AddButton, PlainInput, RemoveButton, useBlockEdit } from "./common";

const NODE_H = 34;
const GAP_Y = 10;
const GAP_X = 52;
const PAD = 16;

function nodeWidth(label: string, root: boolean): number {
  return Math.min(
    root ? 220 : 200,
    Math.max(root ? 96 : 64, label.length * (root ? 8.6 : 7.3) + 28),
  );
}

function shown(label: string, width: number, root: boolean): string {
  const max = Math.floor((width - 24) / (root ? 8.6 : 7.3));
  return label.length > max ? `${label.slice(0, Math.max(1, max - 1))}…` : label;
}

export interface LaidNode {
  key: string;
  node: MindMapNode;
  depth: number;
  x: number;
  y: number;
  w: number;
  tone: ColorToken | null;
  parent: LaidNode | null;
  hidden: number;
}

/** Lay a mind map out left to right; collapsed branches take one row. */
export function layoutMindMap(root: MindMapNode, collapsed: ReadonlySet<string>) {
  const nodes: LaidNode[] = [];
  let maxX = 0;
  const count = (n: MindMapNode): number =>
    (n.children ?? []).reduce((s, c) => s + 1 + count(c), 0);
  const height = (n: MindMapNode, key: string): number => {
    const kids = n.children ?? [];
    if (kids.length === 0 || collapsed.has(key)) return NODE_H;
    const sum = kids.reduce((s, c, i) => s + height(c, `${key}.${i}`), 0);
    return Math.max(NODE_H, sum + GAP_Y * (kids.length - 1));
  };
  const place = (
    n: MindMapNode,
    key: string,
    depth: number,
    x: number,
    top: number,
    tone: ColorToken | null,
    parent: LaidNode | null,
  ) => {
    const h = height(n, key);
    const w = nodeWidth(n.label, depth === 0);
    const isCollapsed = collapsed.has(key);
    const laid: LaidNode = {
      key,
      node: n,
      depth,
      x,
      y: top + h / 2,
      w,
      tone: n.color ?? tone,
      parent,
      hidden: isCollapsed ? count(n) : 0,
    };
    nodes.push(laid);
    maxX = Math.max(maxX, x + w);
    if (isCollapsed) return;
    let y = top;
    (n.children ?? []).forEach((child, i) => {
      const childTone = depth === 0 ? (child.color ?? seriesHue(i)) : (child.color ?? laid.tone);
      const ch = height(child, `${key}.${i}`);
      place(child, `${key}.${i}`, depth + 1, x + w + GAP_X, y, childTone, laid);
      y += ch + GAP_Y;
    });
  };
  const total = height(root, "r");
  place(root, "r", 0, PAD, PAD, null, null);
  return { nodes, width: maxX + PAD + 30, height: total + PAD * 2 };
}

/** Mind map (D8): a tidy tree she can pan, zoom and fold, drawn with the colour tokens. */
export function MindMapBlock({ block }: { block: BlockOf<"mind_map"> }) {
  const { editing, active, patch, layout: screen } = useBlockEdit(block);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const laid = useMemo(
    () => layoutMindMap(block.content.root, collapsed),
    [block.content.root, collapsed],
  );
  const frame = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const start = useRef<{ view: typeof view; x: number; y: number; dist: number } | null>(null);
  const frameHeight = Math.min(screen === "phone" ? 340 : 440, Math.max(200, laid.height));

  const fit = useCallback(() => {
    const el = frame.current;
    if (!el) return;
    if (el.clientWidth === 0 || el.clientHeight === 0) return;
    // Leave room at the bottom for the zoom controls.
    const room = el.clientHeight - 44;
    const scale = Math.max(0.45, Math.min(1, el.clientWidth / laid.width, room / laid.height));
    setView({
      scale,
      x: Math.max(0, (el.clientWidth - laid.width * scale) / 2),
      y: Math.max(0, (room - laid.height * scale) / 2),
    });
  }, [laid.width, laid.height]);

  // Refit when the frame gets its size (it may start skipped by content-visibility) or
  // changes size, until she pans or zooms herself.
  const touched = useRef(false);
  useEffect(() => {
    const el = frame.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (!touched.current) fit();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [fit]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refit when the tree's size changes
  useEffect(() => {
    fit();
  }, [laid.width, laid.height]);

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAt(Math.exp(-event.deltaY * 0.01), event.clientX - rect.left, event.clientY - rect.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  const zoomAt = (factor: number, px?: number, py?: number) => {
    setView((v) => {
      const el = frame.current;
      const cx = px ?? (el ? el.clientWidth / 2 : 0);
      const cy = py ?? (el ? el.clientHeight / 2 : 0);
      const scale = Math.min(2.5, Math.max(0.35, v.scale * factor));
      const r = scale / v.scale;
      return { scale, x: cx - (cx - v.x) * r, y: cy - (cy - v.y) * r };
    });
  };

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest("[data-node-toggle], button")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    touched.current = true;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    const dist =
      pts.length === 2
        ? Math.hypot((pts[0]?.x ?? 0) - (pts[1]?.x ?? 0), (pts[0]?.y ?? 0) - (pts[1]?.y ?? 0))
        : 0;
    start.current = { view, x: e.clientX, y: e.clientY, dist };
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId) || !start.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const s = start.current;
    const pts = [...pointers.current.values()];
    if (pts.length === 2 && s.dist > 0) {
      const d = Math.hypot(
        (pts[0]?.x ?? 0) - (pts[1]?.x ?? 0),
        (pts[0]?.y ?? 0) - (pts[1]?.y ?? 0),
      );
      const scale = Math.min(2.5, Math.max(0.35, (s.view.scale * d) / s.dist));
      setView({ ...s.view, scale });
    } else if (pts.length === 1) {
      setView({ ...s.view, x: s.view.x + e.clientX - s.x, y: s.view.y + e.clientY - s.y });
    }
  };
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) start.current = null;
  };

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const total = walkMindMap(block.content.root).length;

  return (
    <figure className="m-0" aria-label={`Mind map: ${block.content.root.label}`}>
      <div
        ref={frame}
        data-testid="mind-map"
        className="relative cursor-grab overflow-hidden rounded-panel border border-border bg-surface active:cursor-grabbing"
        style={{
          height: frameHeight,
          touchAction: "pan-y",
          backgroundImage: "radial-gradient(var(--color-dot) 1.1px, transparent 1px)",
          backgroundSize: "18px 18px",
        }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <svg
          width="100%"
          height="100%"
          role="img"
          aria-label={`Mind map with ${total} ideas, starting from ${block.content.root.label}`}
          className="block select-none"
        >
          <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
            {laid.nodes.map((n) =>
              n.parent ? (
                <path
                  key={`e-${n.key}`}
                  d={`M ${n.parent.x + n.parent.w} ${n.parent.y} C ${n.parent.x + n.parent.w + GAP_X / 2} ${n.parent.y}, ${n.x - GAP_X / 2} ${n.y}, ${n.x} ${n.y}`}
                  fill="none"
                  stroke={hueVar(n.tone ?? "gray", "solid")}
                  strokeOpacity={0.55}
                  strokeWidth={n.depth === 1 ? 2.5 : 1.75}
                />
              ) : null,
            )}
            {laid.nodes.map((n) => {
              const root = n.depth === 0;
              const kids = n.node.children?.length ?? 0;
              const tone = n.tone ?? "gray";
              return (
                <g key={n.key} data-testid="mind-node" data-label={n.node.label}>
                  <title>{n.node.label}</title>
                  <rect
                    x={n.x}
                    y={n.y - NODE_H / 2}
                    width={n.w}
                    height={NODE_H}
                    rx={root ? 12 : 10}
                    fill={root ? "var(--color-accent)" : hueVar(tone, "soft")}
                    stroke={root ? "var(--color-accent)" : hueVar(tone, "border")}
                    strokeWidth={1.5}
                  />
                  <text
                    x={n.x + n.w / 2}
                    y={n.y + 0.5}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={root ? 14.5 : 13}
                    fontWeight={root ? 700 : n.depth === 1 ? 600 : 500}
                    fill={root ? "var(--color-accent-contrast)" : hueVar(tone, "text")}
                  >
                    {shown(n.node.label, n.w, root)}
                  </text>
                  {kids > 0 && !root && (
                    // biome-ignore lint/a11y/useSemanticElements: an SVG control
                    <g
                      data-node-toggle
                      role="button"
                      tabIndex={0}
                      aria-label={`${n.hidden ? "Expand" : "Collapse"} ${n.node.label}`}
                      aria-expanded={!n.hidden}
                      className="cursor-pointer"
                      onClick={() => toggle(n.key)}
                      onKeyDown={(e: KeyboardEvent) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggle(n.key);
                        }
                      }}
                    >
                      <circle cx={n.x + n.w} cy={n.y} r={20} fill="transparent" />
                      <circle
                        cx={n.x + n.w}
                        cy={n.y}
                        r={n.hidden ? 10 : 8}
                        fill="var(--color-surface)"
                        stroke={hueVar(tone, "solid")}
                        strokeWidth={1.5}
                      />
                      <text
                        x={n.x + n.w}
                        y={n.y + 0.5}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fontSize={n.hidden ? 10 : 12}
                        fontWeight={700}
                        fill={hueVar(tone, "text")}
                      >
                        {n.hidden ? `+${n.hidden}` : "−"}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
        <div className="absolute right-2 bottom-2 flex gap-0.5 rounded-card border border-border bg-(--color-chrome) p-0.5 shadow-card backdrop-blur">
          <IconButton label="Zoom out" size="sm" onClick={() => zoomAt(1 / 1.25)}>
            <Minus className="size-4" />
          </IconButton>
          <IconButton label="Fit the map" size="sm" onClick={fit}>
            <Maximize2 className="size-3.5" />
          </IconButton>
          <IconButton label="Zoom in" size="sm" onClick={() => zoomAt(1.25)}>
            <Plus className="size-4" />
          </IconButton>
        </div>
      </div>
      {editing && active && (
        <MindMapOutline
          root={block.content.root}
          onChange={(root) => patch({ root }, "Edit mind map")}
        />
      )}
    </figure>
  );
}

type Path = number[];

function update(
  node: MindMapNode,
  path: Path,
  fn: (n: MindMapNode) => MindMapNode | null,
): MindMapNode | null {
  if (path.length === 0) return fn(node);
  const [head, ...rest] = path as [number, ...number[]];
  const children = [...(node.children ?? [])];
  const child = children[head];
  if (!child) return node;
  const next = update(child, rest, fn);
  if (next === null) children.splice(head, 1);
  else children[head] = next;
  const out: MindMapNode = { ...node, children };
  if (children.length === 0) delete out.children;
  return out;
}

/** Editing the map as an outline: rename, add a child, remove. */
function MindMapOutline({
  root,
  onChange,
}: {
  root: MindMapNode;
  onChange: (root: MindMapNode) => void;
}) {
  const total = walkMindMap(root).length;
  const rows: Array<{ node: MindMapNode; path: Path; depth: number }> = [];
  const visit = (node: MindMapNode, path: Path, depth: number) => {
    rows.push({ node, path, depth });
    node.children?.forEach((c, i) => {
      visit(c, [...path, i], depth + 1);
    });
  };
  visit(root, [], 0);
  const apply = (path: Path, fn: (n: MindMapNode) => MindMapNode | null) => {
    const next = update(root, path, fn);
    if (next) onChange(next);
  };
  return (
    <div
      className="mt-3 rounded-card border border-border bg-surface-muted/50 p-3"
      data-testid="mind-map-outline"
    >
      <p className="mb-2 text-caption font-semibold uppercase tracking-wide text-text-muted">
        Edit the map
      </p>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {rows.map(({ node, path, depth }) => (
          <li
            key={path.join(".") || "root"}
            className="flex items-center gap-1"
            style={{ paddingLeft: depth * 18 }}
          >
            <PlainInput
              value={node.label}
              required
              label={depth === 0 ? "Main idea" : `Idea: ${node.label}`}
              className="text-ui"
              onCommit={(label) => apply(path, (n) => ({ ...n, label }))}
            />
            {depth < BLOCK_LIMITS.mindMapMaxDepth &&
              total < BLOCK_LIMITS.mindMapNodes &&
              (node.children?.length ?? 0) < BLOCK_LIMITS.mindMapChildren && (
                <IconButton
                  label={`Add an idea under ${node.label}`}
                  size="sm"
                  onClick={() =>
                    apply(path, (n) => ({
                      ...n,
                      children: [...(n.children ?? []), { label: "New idea" }],
                    }))
                  }
                >
                  <Plus className="size-3.5" />
                </IconButton>
              )}
            {depth > 0 ? (
              <RemoveButton
                label={`Remove ${node.label}`}
                onClick={() => apply(path, () => null)}
              />
            ) : (
              <span className="w-7" />
            )}
          </li>
        ))}
      </ul>
      {total < BLOCK_LIMITS.mindMapNodes && (
        <div className="mt-2">
          <AddButton
            onClick={() =>
              apply([], (n) => ({
                ...n,
                children: [...(n.children ?? []), { label: "New branch" }],
              }))
            }
          >
            Branch
          </AddButton>
        </div>
      )}
    </div>
  );
}
