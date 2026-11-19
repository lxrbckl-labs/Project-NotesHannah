import {
  CONCEPT_TYPE_INFO,
  type ConceptType,
  type GraphResult,
  type RelationType,
} from "@notes/schema";
import {
  Background,
  BackgroundVariant,
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  Handle,
  type InternalNode,
  type Node,
  type NodeProps,
  Panel,
  Position,
  ReactFlow,
  useInternalNode,
  useReactFlow,
} from "@xyflow/react";
import {
  Activity,
  ArrowLeftRight,
  Ban,
  Circle,
  Cog,
  Crosshair,
  Layers,
  List,
  type LucideIcon,
  Maximize,
  MessageCircle,
  Minus,
  Network,
  Pill,
  Plus,
  Stethoscope,
  TriangleAlert,
} from "lucide-react";
import { type CSSProperties, memo, useMemo, useState } from "react";
import { Chip } from "../../components/ui/badge";
import { Button, IconButton } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { segmentItemClass } from "../../components/ui/segmented";
import { ErrorState, Skeleton } from "../../components/ui/states";
import { cn } from "../../lib/cn";
import type { Hue } from "../../lib/hues";
import { CONCEPT_TYPE_HUE } from "../../lib/roles";
import { useLayout } from "../../lib/useMedia";
import { filterGraph, neighbours, radialLayout, treeEdges } from "./model/graph";
import { EDGE_LABEL, RELATION_FILTER_LABEL, sectionTitle } from "./model/relations";
import { useConcepts } from "./ui/context";
import { useAsync } from "./ui/hooks";
import { ConceptLink } from "./ui/parts";
import "./concepts.css";

/** Most concepts the neighborhood asks for: more is unreadable on any screen. */
export const GRAPH_CAP = 30;

/** The track of the shared "segment" look; the items keep aria-pressed buttons for their roles. */
const SEGMENT_TRACK =
  "m-0 inline-flex gap-1 rounded-card border border-border bg-surface-muted p-1";

const NODE = { width: 208, height: 64 };

/** A picture for each kind of concept, beside its name on the graph. */
const TYPE_ICON: Record<ConceptType, LucideIcon> = {
  drug: Pill,
  drug_class: Layers,
  mechanism: Cog,
  target: Crosshair,
  indication: Stethoscope,
  adverse_effect: TriangleAlert,
  interaction: ArrowLeftRight,
  contraindication: Ban,
  monitoring_parameter: Activity,
  counselling_point: MessageCircle,
  other: Circle,
};

type FlowData = { label: string; type: ConceptType; center: boolean; order: number };
type LinkData = { label: string; hue: Hue };

/** A concept as a small card: its type's picture and color, its name, and the type in words. */
const ConceptNode = memo(function ConceptNode({ data }: NodeProps<Node<FlowData>>) {
  const Icon = TYPE_ICON[data.type];
  return (
    <div style={{ width: NODE.width }}>
      <Handle type="target" position={Position.Top} style={HIDDEN} isConnectable={false} />
      <Handle type="source" position={Position.Top} style={HIDDEN} isConnectable={false} />
      <button
        type="button"
        data-hue={CONCEPT_TYPE_HUE[data.type]}
        data-testid="graph-node"
        data-center={data.center ? "true" : undefined}
        aria-label={data.center ? `${data.label} (this concept)` : `Open ${data.label}`}
        // Each card arrives a moment after the one before it (concepts.css, cx-pop).
        style={{ "--cx-delay": `${data.order * 40}ms`, height: NODE.height } as CSSProperties}
        className={cn(
          "cx-node flex w-full items-center gap-2.5 rounded-card border px-2.5 text-left shadow-card",
          data.center
            ? "cx-node-center border-2 border-tone-solid bg-tone-soft"
            : "border-tone-border bg-surface",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-control text-tone-text",
            data.center ? "bg-surface" : "bg-tone-soft",
          )}
        >
          <Icon size={18} />
        </span>
        <span className="min-w-0">
          <span className="line-clamp-2 text-label font-semibold leading-tight text-text">
            {data.label}
          </span>
          <span className="block truncate text-caption text-tone-text">
            {CONCEPT_TYPE_INFO[data.type].label}
          </span>
        </span>
      </button>
    </div>
  );
});
const HIDDEN = { opacity: 0, left: "50%", top: "50%", pointerEvents: "none" } as const;
const NODE_TYPES = { concept: ConceptNode };

/** Where the line from a card's middle toward `to` leaves the card's edge. */
function edgePoint(node: InternalNode, to: { x: number; y: number }, pad = 4) {
  const w = (node.measured.width ?? NODE.width) / 2 + pad;
  const h = (node.measured.height ?? NODE.height) / 2 + pad;
  const cx = node.internals.positionAbsolute.x + w - pad;
  const cy = node.internals.positionAbsolute.y + h - pad;
  const dx = to.x - cx;
  const dy = to.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const scale = Math.min(w / Math.abs(dx || 1e-6), h / Math.abs(dy || 1e-6));
  return { x: cx + dx * scale, y: cy + dy * scale };
}
const middle = (node: InternalNode) => ({
  x: node.internals.positionAbsolute.x + (node.measured.width ?? NODE.width) / 2,
  y: node.internals.positionAbsolute.y + (node.measured.height ?? NODE.height) / 2,
});

/**
 * A link between two concepts: a soft curve from card edge to card edge in the neighbour's colour,
 * with a slow drift along it in the link's direction and its word on a small label. It follows the
 * cards when she drags them.
 */
const LinkEdge = memo(function LinkEdge({ source, target, data }: EdgeProps<Edge<LinkData>>) {
  const from = useInternalNode(source);
  const to = useInternalNode(target);
  if (!from || !to) return null;
  const a = edgePoint(from, middle(to));
  const b = edgePoint(to, middle(from));
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  // A gentle bow, always to the same side of the line, so the picture stays calm.
  const bend = 0.14;
  const cx = (a.x + b.x) / 2 - dy * bend;
  const cy = (a.y + b.y) / 2 + dx * bend;
  const path = `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`;
  // The middle of a quadratic curve.
  const lx = 0.25 * a.x + 0.5 * cx + 0.25 * b.x;
  const ly = 0.25 * a.y + 0.5 * cy + 0.25 * b.y;
  return (
    <>
      <g data-hue={data?.hue} className="cx-link">
        <path d={path} className="cx-link-line" />
        <path d={path} className="cx-link-flow" />
        <circle cx={b.x} cy={b.y} r="3.5" className="cx-link-end" />
      </g>
      {data?.label ? (
        <EdgeLabelRenderer>
          <span
            data-hue={data.hue}
            className="cx-link-label nodrag nopan pointer-events-none absolute rounded-pill border border-tone-border bg-surface px-2 py-0.5 text-caption font-medium text-tone-text shadow-card"
            style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}
          >
            {data.label}
          </span>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
});
const EDGE_TYPES = { link: LinkEdge };

/** Zoom in, zoom out and fit, in the graph's corner. */
function GraphControls() {
  const flow = useReactFlow();
  return (
    <Panel position="bottom-right">
      <div className="flex gap-1 rounded-card border border-border-strong bg-surface p-1 shadow-card">
        <IconButton variant="bare" size="sm" aria-label="Zoom out" onClick={() => flow.zoomOut()}>
          <Minus size={16} />
        </IconButton>
        <IconButton variant="bare" size="sm" aria-label="Zoom in" onClick={() => flow.zoomIn()}>
          <Plus size={16} />
        </IconButton>
        <IconButton
          variant="bare"
          size="sm"
          aria-label="Fit the graph"
          onClick={() => flow.fitView({ padding: 0.15, duration: 300 })}
        >
          <Maximize size={16} />
        </IconButton>
      </div>
    </Panel>
  );
}

/** The concept in the middle and its neighbours; a collapsible section with a list or a graph. */
export function Neighbourhood({ conceptId }: { conceptId: string }) {
  const { store } = useConcepts();
  const layout = useLayout();
  const [open, setOpen] = useState(true);
  const [view, setView] = useState<"list" | "graph" | null>(null);
  const [hops, setHops] = useState<1 | 2>(1);
  const [hidden, setHidden] = useState<Set<RelationType>>(new Set());
  const mode = view ?? (layout === "phone" ? "list" : "graph");

  const result = useAsync(
    () => store.graph(conceptId, { hops, maxNodes: GRAPH_CAP }),
    `${conceptId}:${hops}`,
  );

  const present = useMemo(
    () =>
      result.data ? ([...new Set(result.data.edges.map((e) => e.type))] as RelationType[]) : [],
    [result.data],
  );
  const shown = useMemo(() => {
    if (!result.data) return null;
    const allowed = new Set(present.filter((t) => !hidden.has(t)));
    return filterGraph(result.data, hidden.size === 0 ? null : allowed);
  }, [result.data, present, hidden]);

  return (
    <Card as="section" aria-labelledby="cx-hood">
      <div className="flex items-center justify-between gap-3">
        <h2 id="cx-hood" className="font-display text-title font-semibold">
          Neighborhood
        </h2>
        <Button
          variant="ghostAccent"
          aria-expanded={open}
          aria-controls="cx-hood-body"
          onClick={() => setOpen(!open)}
        >
          {open ? "Hide" : "Show"}
        </Button>
      </div>
      {open ? (
        <div id="cx-hood-body" className="mt-3 grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <fieldset className={SEGMENT_TRACK}>
              <legend className="sr-only">View</legend>
              <Seg
                active={mode === "list"}
                onClick={() => setView("list")}
                icon={<List size={15} />}
              >
                List
              </Seg>
              <Seg
                active={mode === "graph"}
                onClick={() => setView("graph")}
                icon={<Network size={15} />}
              >
                Graph
              </Seg>
            </fieldset>
            <fieldset className={SEGMENT_TRACK}>
              <legend className="sr-only">Distance</legend>
              <Seg active={hops === 1} onClick={() => setHops(1)}>
                Direct
              </Seg>
              <Seg active={hops === 2} onClick={() => setHops(2)}>
                Two steps
              </Seg>
            </fieldset>
          </div>
          {present.length > 1 ? (
            <fieldset className="flex flex-wrap gap-1.5">
              <legend className="sr-only">Show relation types</legend>
              {present.map((type) => {
                const on = !hidden.has(type);
                return (
                  <Chip
                    key={type}
                    pressed={on}
                    onClick={() => {
                      const next = new Set(hidden);
                      if (on) next.add(type);
                      else next.delete(type);
                      setHidden(next);
                    }}
                    className={cn(!on && "text-text-muted line-through")}
                  >
                    {RELATION_FILTER_LABEL[type]}
                  </Chip>
                );
              })}
            </fieldset>
          ) : null}
          {result.status === "loading" ? (
            <Skeleton className="h-48" />
          ) : result.status === "error" ? (
            <ErrorState error={result.error} onRetry={result.reload} />
          ) : shown && shown.nodes.length <= 1 ? (
            <p className="rounded-card bg-surface-muted px-4 py-6 text-center text-ui text-text-muted">
              {hidden.size > 0
                ? "Nothing is connected with those types."
                : "Nothing is connected to this yet."}
            </p>
          ) : shown ? (
            <>
              {mode === "graph" ? <GraphView graph={shown} /> : <NeighbourList graph={shown} />}
              {result.data?.truncated ? (
                <p className="text-caption text-text-muted" data-testid="graph-truncated">
                  Showing the nearest {GRAPH_CAP} concepts; there are more.
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

function Seg({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={segmentItemClass(active)}
    >
      {icon}
      {children}
    </button>
  );
}

function GraphView({ graph }: { graph: GraphResult }) {
  const layout = useLayout();
  const { openConcept } = useConcepts();
  const { nodes, edges } = useMemo(() => {
    const names = new Map(graph.nodes.map((n) => [n.id, n]));
    const placed = radialLayout(graph, NODE);
    const flowNodes: Node<FlowData>[] = placed.flatMap((p, order) => {
      const n = names.get(p.id);
      return n
        ? [
            {
              id: p.id,
              type: "concept",
              position: { x: p.x - NODE.width / 2, y: p.y - NODE.height / 2 },
              data: { label: n.name, type: n.type, center: p.id === graph.center, order },
              selectable: false,
              width: NODE.width,
              height: NODE.height,
            },
          ]
        : [];
    });
    const flowEdges: Edge<LinkData>[] = [...treeEdges(graph).entries()].map(([nodeId, e]) => ({
      id: e.id,
      source: e.from,
      target: e.to,
      type: "link",
      // A link wears the color of the concept it leads out to.
      data: {
        label: EDGE_LABEL[e.type],
        hue: CONCEPT_TYPE_HUE[names.get(nodeId)?.type ?? "other"],
      },
      focusable: false,
    }));
    return { nodes: flowNodes, edges: flowEdges };
  }, [graph]);
  const signature = `${graph.center}:${nodes.length}:${edges.length}`;
  return (
    <div
      className="cx-flow overflow-hidden rounded-card border border-border bg-bg"
      style={{ height: layout === "phone" ? 440 : layout === "tablet" ? 500 : 540 }}
      data-testid="graph"
    >
      {/* Uncontrolled (defaultNodes), so she can drag a card aside; a new graph remounts by its key. */}
      <ReactFlow
        key={signature}
        defaultNodes={nodes}
        defaultEdges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.25}
        maxZoom={1.6}
        onNodeClick={(_, node) => node.id !== graph.center && openConcept(node.id)}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        preventScrolling={false}
        zoomOnDoubleClick={false}
        proOptions={{ hideAttribution: true }}
        aria-label="Graph of connected concepts"
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.6} color="var(--color-dot)" />
        <GraphControls />
      </ReactFlow>
    </div>
  );
}

function NeighbourList({ graph }: { graph: GraphResult }) {
  const groups = neighbours(graph);
  const second = graph.nodes.length - 1 - groups.reduce((n, g) => n + g.items.length, 0);
  return (
    <div className="grid gap-3" data-testid="neighbour-list">
      {groups.map((g) => (
        <div key={g.type}>
          <h3 className="mb-1 text-caption font-semibold uppercase tracking-wide text-text-muted">
            {sectionTitle(g.type, "out")}
          </h3>
          <ul className="flex flex-wrap gap-1.5">
            {g.items.map((item) => (
              <li key={item.id}>
                <span className="inline-flex min-h-11 items-center gap-2 rounded-pill border border-border bg-surface px-3.5 text-ui">
                  <ConceptLink id={item.id}>{item.name}</ConceptLink>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {second > 0 ? (
        <p className="text-caption text-text-muted">
          {second} more {second === 1 ? "concept is" : "concepts are"} two steps away: switch to the
          graph to see them.
        </p>
      ) : null}
    </div>
  );
}
