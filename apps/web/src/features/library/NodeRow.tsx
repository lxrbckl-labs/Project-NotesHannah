import { lectureLabel, type NodeWithLinks } from "@notes/schema";
import { useQueryClient } from "@tanstack/react-query";
import { GripVertical, MoreHorizontal, Star } from "lucide-react";
import { type KeyboardEvent, useState } from "react";
import { Link } from "react-router";
import { IconButton } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { ActionMenu, ContextActions } from "../../components/ui/menu";
import { cn } from "../../lib/cn";
import type { Hue } from "../../lib/hues";
import { useUploadManager } from "../uploads/UploadProvider";
import { useNodeActions } from "./actions";
import { courseHue } from "./courseHue";
import { useRowDnd } from "./dnd";
import { useFileActions } from "./fileActions";
import { InlineName } from "./InlineName";
import { NodeTile } from "./NodeIcon";
import { canHoldFiles } from "./picker";
import { folderDepthOf } from "./queries";
import { type Destination, isPending, KIND_NAME, nodeHref, toDestination } from "./rules";
import { useNodeMenu } from "./useNodeMenu";

export function nodeTitle(node: NodeWithLinks): string {
  return node.kind === "lecture" ? lectureLabel(node.name, node.lecture) : node.name;
}

/** A lecture's name with its number, and its date apart (shown small and trailing in a tree). */
export function lectureParts(node: NodeWithLinks): { text: string; date: string | null } {
  if (node.kind !== "lecture") return { text: node.name, date: null };
  const lecture = node.lecture;
  const text = lectureLabel(node.name, lecture ? { ...lecture, date: null } : null);
  const full = lectureLabel(node.name, lecture);
  return { text, date: lecture?.date ? full.slice(text.length).replace(/^ · /, "") : null };
}

export function nodeMeta(node: NodeWithLinks): string {
  const kind = node.section ? "Section" : KIND_NAME[node.kind];
  if (node.kind === "document") return kind;
  const count = `${node.childCount} ${node.childCount === 1 ? "item" : "items"}`;
  if (node.kind === "course" && node.course?.code) return `${node.course.code} · ${count}`;
  return node.kind === "lecture" && node.childCount === 0 ? kind : `${kind} · ${count}`;
}

/** One item in a list: a link, a "..." menu, right-click and long-press, drag and drop. */
export function NodeRow({
  node,
  parent,
  previousId,
  dnd,
  hue: inherited,
}: {
  node: NodeWithLinks;
  parent: NodeWithLinks | null;
  previousId: string | null;
  dnd: boolean;
  /** The course colour of the page this row is on; terms have none. */
  hue?: Hue | null | undefined;
}) {
  const hue = node.kind === "course" ? courseHue(node.id) : node.kind === "term" ? null : inherited;
  const client = useQueryClient();
  const actions = useNodeActions();
  const uploads = useUploadManager();
  const fileActions = useFileActions();
  const [renaming, setRenaming] = useState(false);
  const { entries, trash } = useNodeMenu(node, { onRename: () => setRenaming(true) });
  const parentDest: Destination | null = parent
    ? toDestination(parent, folderDepthOf(client, parent))
    : null;
  const { dragProps, dropProps, dropMode } = useRowDnd({
    node,
    enabled: dnd,
    // A row that can hold source files takes them: files dragged from the computer upload into it, and
    // a file row dragged onto it is filed there.
    fileTarget: canHoldFiles(node)
      ? {
          nodeId: node.id,
          onUploadFiles: (files) => uploads.enqueue(files, { nodeId: node.id, label: node.name }),
          onMoveFile: (file, nodeId) => void fileActions.moveTo(file, nodeId, node.name),
        }
      : undefined,
    asDestination: toDestination(node, folderDepthOf(client, node)),
    parentDestination: parentDest,
    previousSiblingId: previousId,
    onMove: (source, input) => void actions.move(source, input),
  });

  function onKeyDown(event: KeyboardEvent) {
    if (event.target !== event.currentTarget && !(event.target as HTMLElement).closest("a")) return;
    if (node.kind === "section" || isPending(node)) return;
    if (event.key === "F2") {
      event.preventDefault();
      setRenaming(true);
    } else if (event.key === "Delete") {
      event.preventDefault();
      trash();
    }
  }

  return (
    <ContextActions entries={entries}>
      <Card
        as="li"
        padding="none"
        data-testid="node-row"
        data-kind={node.kind}
        data-drop={dropMode ?? undefined}
        onKeyDown={onKeyDown}
        {...dragProps}
        {...dropProps}
        className={cn(
          "group flex min-h-16 items-center gap-1 pl-3 pr-1.5 transition-colors duration-(--duration-fast) hover:border-border-strong",
          isPending(node) && "opacity-60",
        )}
      >
        {dnd && dragProps.draggable ? (
          <GripVertical
            size={16}
            aria-hidden
            className="hidden shrink-0 text-text-muted opacity-0 group-hover:opacity-100 xl:block"
          />
        ) : null}
        {renaming ? (
          <div className="flex min-w-0 flex-1 items-center gap-3 py-2">
            <NodeTile kind={node.kind} section={node.section} hue={hue} />
            <InlineName
              value={node.name}
              label={`Rename ${node.name}`}
              onCancel={() => setRenaming(false)}
              onCommit={(name) => {
                setRenaming(false);
                void actions.rename(node, name);
              }}
            />
          </div>
        ) : (
          <Link
            to={nodeHref(node)}
            draggable={false}
            className="flex min-h-16 min-w-0 flex-1 items-center gap-3 rounded-control py-2"
          >
            <NodeTile kind={node.kind} section={node.section} hue={hue} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{nodeTitle(node)}</span>
              <span className="block truncate text-ui text-text-muted">{nodeMeta(node)}</span>
            </span>
          </Link>
        )}
        {/* A favorite shows its star as a button the same size as the "..." beside it; pressing it takes
            the item out of the favorites. */}
        {node.favourite ? (
          <IconButton
            aria-label="Remove from favorites"
            data-testid="row-favourite"
            onClick={() => void actions.setFavourite(node, false)}
          >
            <Star size={20} aria-label="Favorite" className="fill-accent text-accent" />
          </IconButton>
        ) : null}
        <ActionMenu
          trigger={
            <IconButton aria-label={`Actions for ${node.name}`}>
              <MoreHorizontal size={20} />
            </IconButton>
          }
          entries={entries}
        />
      </Card>
    </ContextActions>
  );
}
