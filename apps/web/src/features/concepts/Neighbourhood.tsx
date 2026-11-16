import type { GraphResult, RelationType } from "@notes/schema";
import { Handle, type Node, type NodeProps, Position, ReactFlow } from "@xyflow/react";
import { List, Network } from "lucide-react";
import { memo, useMemo, useState } from "react";
import { ErrorState, Skeleton } from "../../components/ui/states";
import { cn } from "../../lib/cn";
import { useLayout } from "../../lib/useMedia";
import { filterGraph, neighbours, radialLayout } from "./model/graph";
import { EDGE_LABEL, RELATION_FILTER_LABEL, sectionTitle } from "./model/relations";
import { useConcepts } from "./ui/context";
import { useAsync } from "./ui/hooks";
import { ConceptLink } from "./ui/parts";
import { TONE_CLASS, toneOf } from "./ui/tone";
import "./concepts.css";

/** Most concepts the neighbourhood asks for: more is unreadable on any screen. */
export const GRAPH_CAP = 30;

const NODE = { width: 156, height: 48 };

type FlowData = { label: string; type: GraphResult["nodes"][number]["type"]; center: boolean };

const ConceptNode = memo(function ConceptNode({ id, data }: NodeProps<Node<FlowData>>) {
  const { openConcept } = useConcepts();
  return (
    <div style={{ width: NODE.width }}>
      <Handle type="target" position={Position.Top} style={HIDDEN} isConnectable={false} />
      <Handle type="source" position={Position.Top} style={HIDDEN} isConnectable={false} />
      <button
        type="button"
        data-testid="graph-node"
        data-center={data.center ? "true" : undefined}
        aria-label={data.center ? `${data.label} (this concept)` : `Open ${data.label}`}
        onClick={() => !data.center && openConcept(id)}
        className={cn(
          "flex min-h-11 w-full items-center justify-center rounded-2xl border px-2.5 py-1.5 text-center text-[13px] font-medium leading-tight shadow-card",
          TONE_CLASS[toneOf(data.type)],
          data.center ? "border-accent border-2" : "border-transparent",
        )}
      >
        {data.label}
      </button>
    </div>
  );
});
const HIDDEN = { opacity: 0, left: "50%", top: "50%", pointerEvents: "none" } as const;
const NODE_TYPES = { concept: ConceptNode };

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
    <section
      aria-labelledby="cx-hood"
      className="rounded-3xl border border-border bg-surface p-4 shadow-card md:p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="cx-hood" className="font-display text-lg font-semibold">
          Neighbourhood
        </h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="cx-hood-body"
          onClick={() => setOpen(!open)}
          className="min-h-11 rounded-xl px-3 text-sm font-medium text-accent hover:bg-accent-soft"
        >
          {open ? "Hide" : "Show"}
        </button>
      </div>
      {open ? (
        <div id="cx-hood-body" className="mt-3 grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <fieldset className="m-0 inline-flex rounded-xl border-0 bg-surface-muted p-1">
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
            <fieldset className="m-0 inline-flex rounded-xl border-0 bg-surface-muted p-1">
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
                  <button
                    key={type}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      const next = new Set(hidden);
                      if (on) next.add(type);
                      else next.delete(type);
                      setHidden(next);
                    }}
                    className={cn(
                      "min-h-9 rounded-full border px-3 text-xs font-medium",
                      on
                        ? "border-accent bg-accent-soft text-accent"
                        : "border-border text-text-muted line-through",
                    )}
                  >
                    {RELATION_FILTER_LABEL[type]}
                  </button>
                );
              })}
            </fieldset>
          ) : null}
          {result.status === "loading" ? (
            <Skeleton className="h-48" />
          ) : result.status === "error" ? (
            <ErrorState error={result.error} onRetry={result.reload} />
          ) : shown && shown.nodes.length <= 1 ? (
            <p className="rounded-2xl bg-surface-muted px-4 py-6 text-center text-sm text-text-muted">
              {hidden.size > 0
                ? "Nothing is connected with those types."
                : "Nothing is connected to this yet."}
            </p>
          ) : shown ? (
            <>
              {mode === "graph" ? <GraphView graph={shown} /> : <NeighbourList graph={shown} />}
              {result.data?.truncated ? (
                <p className="text-xs text-text-muted" data-testid="graph-truncated">
                  Showing the nearest {GRAPH_CAP} concepts; there are more.
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </section>
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
      className={cn(
        "inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium",
        active ? "bg-surface text-text shadow-card" : "text-text-muted",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function GraphView({ graph }: { graph: GraphResult }) {
  const layout = useLayout();
  const { nodes, edges } = useMemo(() => {
    const names = new Map(graph.nodes.map((n) => [n.id, n]));
    const placed = radialLayout(graph, NODE);
    const flowNodes: Node<FlowData>[] = placed.flatMap((p) => {
      const n = names.get(p.id);
      return n
        ? [
            {
              id: p.id,
              type: "concept",
              position: { x: p.x - NODE.width / 2, y: p.y - NODE.height / 2 },
              data: { label: n.name, type: n.type, center: p.id === graph.center },
              draggable: false,
              selectable: false,
              width: NODE.width,
              height: NODE.height,
            },
          ]
        : [];
    });
    const flowEdges = graph.edges.map((e) => ({
      id: e.id,
      source: e.from,
      target: e.to,
      type: "straight",
      label: EDGE_LABEL[e.type],
      labelStyle: { fontSize: 11 },
      labelBgPadding: [4, 2] as [number, number],
      labelBgBorderRadius: 6,
      focusable: false,
    }));
    return { nodes: flowNodes, edges: flowEdges };
  }, [graph]);
  const signature = `${graph.center}:${nodes.length}:${edges.length}`;
  return (
    <div
      className="cx-flow overflow-hidden rounded-2xl border border-border bg-bg"
      style={{ height: layout === "phone" ? 360 : layout === "tablet" ? 440 : 480 }}
      data-testid="graph"
    >
      <ReactFlow
        key={signature}
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.12 }}
        minZoom={0.25}
        maxZoom={1.6}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        preventScrolling={false}
        zoomOnDoubleClick={false}
        proOptions={{ hideAttribution: true }}
        aria-label="Graph of connected concepts"
      />
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
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-muted">
            {sectionTitle(g.type, "out")}
          </h3>
          <ul className="flex flex-wrap gap-1.5">
            {g.items.map((item) => (
              <li key={item.id}>
                <span className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface px-3.5 text-sm">
                  <ConceptLink id={item.id}>{item.name}</ConceptLink>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {second > 0 ? (
        <p className="text-xs text-text-muted">
          {second} more {second === 1 ? "concept is" : "concepts are"} two steps away: switch to the
          graph to see them.
        </p>
      ) : null}
    </div>
  );
}
