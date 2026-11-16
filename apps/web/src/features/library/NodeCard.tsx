import type { NodeWithLinks } from "@notes/schema";
import { MoreHorizontal, Star } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { IconButton } from "../../components/ui/button";
import { ActionMenu, ContextActions } from "../../components/ui/menu";
import { cn } from "../../lib/cn";
import { useNodeActions } from "./actions";
import { InlineName } from "./InlineName";
import { NodeIcon } from "./NodeIcon";
import { nodeMeta, nodeTitle } from "./NodeRow";
import { isPending, nodeHref } from "./rules";
import { useNodeMenu } from "./useNodeMenu";

/** A rounded card for a term, course or section. Sections (fixed) have no menu. */
export function NodeCard({ node, large }: { node: NodeWithLinks; large?: boolean }) {
  const actions = useNodeActions();
  const [renaming, setRenaming] = useState(false);
  const fixed = node.kind === "section";
  const { entries } = useNodeMenu(node, { onRename: () => setRenaming(true) });

  const body = (
    <div
      data-testid="node-card"
      data-kind={node.kind}
      className={cn(
        "group relative flex gap-3 rounded-3xl border border-border bg-surface p-4 shadow-card transition-colors hover:border-border-strong",
        large
          ? "min-h-24 items-center md:min-h-36 md:flex-col md:items-start md:justify-between"
          : "min-h-24 items-start",
        isPending(node) && "opacity-60",
      )}
    >
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent",
          large ? "size-12" : "size-11",
        )}
      >
        <NodeIcon kind={node.kind} section={node.section} size={large ? 24 : 22} />
      </span>
      <div className="min-w-0 flex-1 md:w-full">
        {renaming ? (
          <InlineName
            value={node.name}
            label={`Rename ${node.name}`}
            onCancel={() => setRenaming(false)}
            onCommit={(name) => {
              setRenaming(false);
              void actions.rename(node, name);
            }}
          />
        ) : (
          <Link
            to={nodeHref(node)}
            className="block rounded-lg font-display text-base font-semibold after:absolute after:inset-0 after:rounded-3xl after:content-['']"
          >
            <span className="flex items-center gap-1.5">
              <span className="truncate">{nodeTitle(node)}</span>
              {node.favourite ? (
                <Star
                  size={14}
                  aria-label="Favourite"
                  className="shrink-0 fill-accent text-accent"
                />
              ) : null}
            </span>
          </Link>
        )}
        <p className="mt-0.5 truncate text-sm text-text-muted">{nodeMeta(node)}</p>
      </div>
      {!fixed ? (
        <div className="relative z-10 -mr-2 -mt-2 shrink-0 self-start md:absolute md:right-3 md:top-3 md:m-0">
          <ActionMenu
            trigger={
              <IconButton aria-label={`Actions for ${node.name}`}>
                <MoreHorizontal size={20} />
              </IconButton>
            }
            entries={entries}
          />
        </div>
      ) : null}
    </div>
  );
  return fixed ? body : <ContextActions entries={entries}>{body}</ContextActions>;
}
