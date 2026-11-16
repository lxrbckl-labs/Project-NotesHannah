import type { MoveNodeInput, NodeWithLinks } from "@notes/schema";
import { type DragEvent, useState } from "react";
import { type Destination, isPending, moveBlockedReason } from "./rules";

/** The node being dragged. dragover cannot read dataTransfer values, so it lives here. */
let dragged: NodeWithLinks | null = null;

export type DropMode = "into" | "before" | "after" | null;

export interface DndRowOptions {
  node: NodeWithLinks;
  enabled: boolean;
  /** This row as a destination ("into"). */
  asDestination: Destination;
  /** The row's parent as a destination (for "before" and "after"); null is the library root. */
  parentDestination: Destination | null;
  /** The sibling before this one (afterId for "before"); null when first. */
  previousSiblingId: string | null;
  onMove: (node: NodeWithLinks, input: MoveNodeInput) => void;
}

/** Make a row draggable and a drop target, with an into / before / after indicator. */
export function useRowDnd(options: DndRowOptions) {
  const { node, enabled, asDestination, parentDestination, previousSiblingId, onMove } = options;
  const [mode, setMode] = useState<DropMode>(null);
  const canDrag = enabled && node.kind !== "section" && !isPending(node);

  function modeFor(event: DragEvent<HTMLElement>): DropMode {
    const source = dragged;
    if (!source || source.id === node.id) return null;
    const into = moveBlockedReason(source, asDestination) === null;
    const beside = moveBlockedReason(source, parentDestination) === null && node.kind !== "section";
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = rect.height ? (event.clientY - rect.top) / rect.height : 0.5;
    if (into) {
      if (beside && ratio < 0.25) return "before";
      if (beside && ratio > 0.75) return "after";
      return "into";
    }
    if (!beside) return null;
    return ratio < 0.5 ? "before" : "after";
  }

  const dragProps = canDrag
    ? {
        draggable: true,
        onDragStart: (event: DragEvent<HTMLElement>) => {
          dragged = node;
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", node.name);
          event.currentTarget.dataset.dragging = "true";
        },
        onDragEnd: (event: DragEvent<HTMLElement>) => {
          dragged = null;
          delete event.currentTarget.dataset.dragging;
          setMode(null);
        },
      }
    : {};

  const dropProps = enabled
    ? {
        onDragOver: (event: DragEvent<HTMLElement>) => {
          const next = modeFor(event);
          if (!next) {
            if (mode) setMode(null);
            return;
          }
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          if (next !== mode) setMode(next);
        },
        onDragLeave: (event: DragEvent<HTMLElement>) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setMode(null);
        },
        onDrop: (event: DragEvent<HTMLElement>) => {
          const source = dragged;
          const dropMode = modeFor(event);
          setMode(null);
          dragged = null;
          if (!source || !dropMode) return;
          event.preventDefault();
          event.stopPropagation();
          if (dropMode === "into") onMove(source, { parentId: node.id });
          else if (dropMode === "after") {
            onMove(source, { parentId: node.parentId, afterId: node.id });
          } else if (previousSiblingId !== source.id) {
            onMove(source, { parentId: node.parentId, afterId: previousSiblingId });
          }
        },
      }
    : {};

  return { dragProps, dropProps, dropMode: mode };
}
