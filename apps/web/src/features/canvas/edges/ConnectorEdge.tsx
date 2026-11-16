import { CONNECTOR_DEFAULT_LINE, type LineStyle } from "@notes/schema";
import {
  EdgeLabelRenderer,
  type EdgeProps,
  getBezierPath,
  type InternalNode,
  Position,
  useInternalNode,
} from "@xyflow/react";
import { memo } from "react";
import { useCanvasActions } from "../model/actions";
import type { ConnectorEdge as ConnectorEdgeType } from "../model/flow";

const DASH: Record<LineStyle, string | undefined> = {
  solid: undefined,
  dashed: "7 6",
  dotted: "1.5 6",
};
const ARROW = 10;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function box(node: InternalNode): Box {
  const p = node.internals.positionAbsolute;
  return { x: p.x, y: p.y, w: node.measured.width ?? 0, h: node.measured.height ?? 0 };
}

/** Attach each end to the side facing the other card, so curves read cleanly whatever the layout. */
export function floatingEnds(a: Box, b: Box) {
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const dx = bc.x - ac.x;
  const dy = bc.y - ac.y;
  // Gaps between the boxes on each axis decide which sides face each other.
  const gapX = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
  const gapY = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
  const horizontal = gapX >= gapY;
  if (horizontal) {
    const right = dx >= 0;
    return {
      sx: right ? a.x + a.w : a.x,
      sy: ac.y,
      sp: right ? Position.Right : Position.Left,
      tx: right ? b.x : b.x + b.w,
      ty: bc.y,
      tp: right ? Position.Left : Position.Right,
    };
  }
  const down = dy >= 0;
  return {
    sx: ac.x,
    sy: down ? a.y + a.h : a.y,
    sp: down ? Position.Bottom : Position.Top,
    tx: bc.x,
    ty: down ? b.y : b.y + b.h,
    tp: down ? Position.Top : Position.Bottom,
  };
}

const INWARD: Record<Position, { x: number; y: number }> = {
  [Position.Left]: { x: 1, y: 0 },
  [Position.Right]: { x: -1, y: 0 },
  [Position.Top]: { x: 0, y: 1 },
  [Position.Bottom]: { x: 0, y: -1 },
};

/** Arrowhead tip at (x, y) entering the card through `side`. */
function arrowPath(x: number, y: number, side: Position): string {
  const d = INWARD[side];
  const bx = x - d.x * ARROW;
  const by = y - d.y * ARROW;
  const px = -d.y * (ARROW * 0.55);
  const py = d.x * (ARROW * 0.55);
  return `M${x},${y} L${bx + px},${by + py} L${bx - px},${by - py} Z`;
}

function ConnectorEdgeView({ id, source, target, data, selected }: EdgeProps<ConnectorEdgeType>) {
  const actions = useCanvasActions();
  const a = useInternalNode(source);
  const b = useInternalNode(target);
  if (!a || !b || !data) return null;
  const c = data.connector;
  const ends = floatingEnds(box(a), box(b));
  const headAtTarget = c.direction === "forward" || c.direction === "both";
  const headAtSource = c.direction === "backward" || c.direction === "both";
  const pull = (side: Position, on: boolean) => (on ? INWARD[side] : { x: 0, y: 0 });
  const ts = pull(ends.tp, headAtTarget);
  const ss = pull(ends.sp, headAtSource);
  const [path, labelX, labelY] = getBezierPath({
    sourceX: ends.sx - ss.x * (ARROW - 2),
    sourceY: ends.sy - ss.y * (ARROW - 2),
    sourcePosition: ends.sp,
    targetX: ends.tx - ts.x * (ARROW - 2),
    targetY: ends.ty - ts.y * (ARROW - 2),
    targetPosition: ends.tp,
    curvature: 0.32,
  });
  const color = `var(--edge-${c.kind})`;
  const line = c.line ?? CONNECTOR_DEFAULT_LINE[c.kind];
  return (
    <g
      className={data.dim ? "nc-edge-dim" : undefined}
      data-testid="canvas-connector"
      data-edge-id={id}
    >
      <path d={path} className="nc-edge-hit" />
      <path d={path} className="nc-edge-path" stroke={color} strokeDasharray={DASH[line]} />
      {headAtTarget && <path d={arrowPath(ends.tx, ends.ty, ends.tp)} fill={color} />}
      {headAtSource && <path d={arrowPath(ends.sx, ends.sy, ends.sp)} fill={color} />}
      {c.label && (
        <EdgeLabelRenderer>
          <button
            type="button"
            className={`nc-edge-label nodrag nopan${selected ? " nc-selected" : ""}${data.dim ? " nc-edge-dim" : ""}`}
            style={{ left: labelX, top: labelY, ["--edge-color" as string]: color }}
            onClick={(e) => {
              e.stopPropagation();
              actions.editConnector(id);
            }}
            data-testid="connector-label"
          >
            {c.label}
          </button>
        </EdgeLabelRenderer>
      )}
    </g>
  );
}

export const ConnectorEdge = memo(ConnectorEdgeView);
