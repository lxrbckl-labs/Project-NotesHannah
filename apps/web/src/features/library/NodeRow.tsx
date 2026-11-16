import { lectureLabel, type NodeWithLinks } from "@notes/schema";
import { useQueryClient } from "@tanstack/react-query";
import { GripVertical, MoreHorizontal, Star } from "lucide-react";
import { type KeyboardEvent, useState } from "react";
import { Link } from "react-router";
import { IconButton } from "../../components/ui/button";
import { ActionMenu, ContextActions } from "../../components/ui/menu";
import { cn } from "../../lib/cn";
import { useNodeActions } from "./actions";
import { useRowDnd } from "./dnd";
import { InlineName } from "./InlineName";
import { NodeIcon } from "./NodeIcon";
import { folderDepthOf } from "./queries";
import { type Destination, isPending, KIND_NAME, toDestination } from "./rules";
import { useNodeMenu } from "./useNodeMenu";

export function nodeTitle(node: NodeWithLinks): string {
  return node.kind === "lecture" ? lectureLabel(node.name, node.lecture) : node.name;
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
}: {
  node: NodeWithLinks;
  parent: NodeWithLinks | null;
  previousId: string | null;
  dnd: boolean;
}) {
  const client = useQueryClient();
  const actions = useNodeActions();
  const [renaming, setRenaming] = useState(false);
  const { entries, trash } = useNodeMenu(node, { onRename: () => setRenaming(true) });
  const parentDest: Destination | null = parent
    ? toDestination(parent, folderDepthOf(client, parent))
    : null;
  const { dragProps, dropProps, dropMode } = useRowDnd({
    node,
    enabled: dnd,
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
      <li
        data-testid="node-row"
        data-kind={node.kind}
        data-drop={dropMode ?? undefined}
        onKeyDown={onKeyDown}
        {...dragProps}
        {...dropProps}
        className={cn(
          "group flex min-h-16 items-center gap-1 rounded-2xl border border-border bg-surface pl-3 pr-1.5 shadow-card transition-colors hover:border-border-strong",
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
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <NodeIcon kind={node.kind} section={node.section} />
            </span>
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
            to={`/library/${node.id}`}
            draggable={false}
            className="flex min-h-16 min-w-0 flex-1 items-center gap-3 rounded-xl py-2"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <NodeIcon kind={node.kind} section={node.section} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{nodeTitle(node)}</span>
              <span className="block truncate text-sm text-text-muted">{nodeMeta(node)}</span>
            </span>
            {node.favourite ? (
              <Star size={15} aria-label="Favourite" className="shrink-0 fill-accent text-accent" />
            ) : null}
          </Link>
        )}
        <ActionMenu
          trigger={
            <IconButton aria-label={`Actions for ${node.name}`}>
              <MoreHorizontal size={20} />
            </IconButton>
          }
          entries={entries}
        />
      </li>
    </ContextActions>
  );
}
