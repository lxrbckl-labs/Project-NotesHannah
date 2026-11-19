import type { MoveNodeInput, NodeWithLinks, SourceFile } from "@notes/schema";
import { type DragEvent, useState } from "react";
import { type Destination, isPending, moveBlockedReason } from "./rules";

/** The node being dragged. dragover cannot read dataTransfer values, so it lives here. */
let dragged: NodeWithLinks | null = null;
/** A source file being dragged (from a file leaf), to file it under a lecture or folder, or the inbox. */
let draggedFile: SourceFile | null = null;

const hasFiles = (event: DragEvent<HTMLElement>) =>
  Array.from(event.dataTransfer.types).includes("Files");

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
  /**
   * Set on rows that can hold source files (lecture, folder, Sources section) and on the Inbox row
   * (`nodeId: null`): files from the computer are uploaded there, and file leaves are filed there.
   */
  fileTarget?: {
    nodeId: string | null;
    onUploadFiles: (files: File[]) => void;
    onMoveFile: (file: SourceFile, nodeId: string | null) => void;
  };
}

/** Make a row draggable and a drop target, with an into / before / after indicator. */
export function useRowDnd(options: DndRowOptions) {
  const { node, enabled, asDestination, parentDestination, previousSiblingId, onMove, fileTarget } =
    options;
  const [mode, setMode] = useState<DropMode>(null);
  const canDrag = enabled && node.kind !== "section" && !isPending(node);

  function modeFor(event: DragEvent<HTMLElement>): DropMode {
    if (hasFiles(event)) return fileTarget ? "into" : null;
    if (draggedFile) return fileTarget && fileTarget.nodeId !== draggedFile.nodeId ? "into" : null;
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
          if (hasFiles(event) && fileTarget) {
            event.preventDefault();
            event.stopPropagation();
            setMode(null);
            const files = Array.from(event.dataTransfer.files);
            if (files.length) fileTarget.onUploadFiles(files);
            return;
          }
          if (draggedFile && fileTarget) {
            event.preventDefault();
            event.stopPropagation();
            const moving = draggedFile;
            draggedFile = null;
            setMode(null);
            if (fileTarget.nodeId !== moving.nodeId)
              fileTarget.onMoveFile(moving, fileTarget.nodeId);
            return;
          }
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

/** Make a file leaf draggable (computer layout), to file it under another place or back to the inbox. */
export function fileLeafDragProps(file: SourceFile, enabled: boolean) {
  if (!enabled) return {};
  return {
    draggable: true,
    onDragStart: (event: DragEvent<HTMLElement>) => {
      draggedFile = file;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", file.originalName);
      event.currentTarget.dataset.dragging = "true";
    },
    onDragEnd: (event: DragEvent<HTMLElement>) => {
      draggedFile = null;
      delete event.currentTarget.dataset.dragging;
    },
  };
}

/** The Inbox row (or page) as a drop target: files from the computer upload to the inbox, file leaves go back to it. */
export function useInboxDrop(options: {
  onUploadFiles: (files: File[]) => void;
  onMoveFile: (file: SourceFile) => void;
  enabled: boolean;
}) {
  const [over, setOver] = useState(false);
  if (!options.enabled) return { over: false, props: {} };
  const accepts = (event: DragEvent<HTMLElement>) =>
    hasFiles(event) || (draggedFile !== null && draggedFile.nodeId !== null);
  return {
    over,
    props: {
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (!accepts(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = hasFiles(event) ? "copy" : "move";
        setOver(true);
      },
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        if (!accepts(event)) return;
        event.preventDefault();
        event.stopPropagation();
        setOver(false);
        if (hasFiles(event)) {
          const files = Array.from(event.dataTransfer.files);
          if (files.length) options.onUploadFiles(files);
        } else if (draggedFile) {
          const moving = draggedFile;
          draggedFile = null;
          options.onMoveFile(moving);
        }
      },
    },
  };
}

/**
 * A breadcrumb as a drop target: the way to drag something OUT of a folder. Drop a folder, lecture
 * or document on a place further up and it moves there; drop a source file on a place that can hold
 * files and it is filed there.
 */
export function useCrumbDrop(options: {
  /** The place the crumb stands for; null while it is still loading. */
  node: NodeWithLinks | null;
  destination: Destination | null;
  onMove: (node: NodeWithLinks, input: MoveNodeInput) => void;
  /** Set when the place can hold source files. */
  onMoveFile?: ((file: SourceFile, nodeId: string) => void) | undefined;
}) {
  const { node, destination, onMove, onMoveFile } = options;
  const [over, setOver] = useState(false);
  const accepts = (): "node" | "file" | null => {
    if (!node) return null;
    if (draggedFile) return onMoveFile && draggedFile.nodeId !== node.id ? "file" : null;
    const source = dragged;
    if (!source || source.id === node.id || source.parentId === node.id) return null;
    return moveBlockedReason(source, destination) === null ? "node" : null;
  };
  return {
    over,
    props: {
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (!accepts()) {
          if (over) setOver(false);
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        if (!over) setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (event: DragEvent<HTMLElement>) => {
        const kind = accepts();
        setOver(false);
        if (!kind || !node) return;
        event.preventDefault();
        event.stopPropagation();
        if (kind === "file" && draggedFile && onMoveFile) {
          const moving = draggedFile;
          draggedFile = null;
          onMoveFile(moving, node.id);
        } else if (kind === "node" && dragged) {
          const source = dragged;
          dragged = null;
          onMove(source, { parentId: node.id });
        }
      },
    },
  };
}
