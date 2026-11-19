import type { NodeWithLinks } from "@notes/schema";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { Link } from "react-router";
import { cn } from "../../lib/cn";
import { useNodeActions } from "./actions";
import { useCrumbDrop } from "./dnd";
import { useFileActions } from "./fileActions";
import { canHoldFiles } from "./picker";
import { folderDepthOf, nodeQuery } from "./queries";
import { nodeHref, toDestination } from "./rules";

/**
 * One place on the way up, as a link and as somewhere to drop: dragging a row onto it moves that
 * item out of the folder she is in and up to this place.
 */
function Crumb({ node }: { node: NodeWithLinks }) {
  const client = useQueryClient();
  const actions = useNodeActions();
  const fileActions = useFileActions();
  const drop = useCrumbDrop({
    node,
    destination: toDestination(node, folderDepthOf(client, node)),
    onMove: (source, input) => void actions.move(source, input),
    onMoveFile: canHoldFiles(node)
      ? (file, nodeId) => void fileActions.moveTo(file, nodeId, node.name)
      : undefined,
  });
  return (
    <Link
      {...drop.props}
      data-drop={drop.over ? "into" : undefined}
      className={cn(
        "max-w-40 truncate rounded-inline px-1 hover:text-text hover:underline",
        drop.over && "bg-accent-soft text-accent outline-2 outline-accent",
      )}
      to={nodeHref(node)}
    >
      {node.name}
    </Link>
  );
}

/** Library > Term > Course > Section, each a link; the current item is plain text. */
export function Breadcrumbs({ node }: { node: NodeWithLinks }) {
  const ancestors = useQueries({ queries: node.ancestors.map((id) => nodeQuery(id)) });
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-ui text-text-muted">
        <li>
          <Link className="rounded-inline px-1 hover:text-text hover:underline" to="/library">
            Library
          </Link>
        </li>
        {ancestors.map((q, i) => (
          <li key={node.ancestors[i]} className="flex items-center gap-1">
            <ChevronRight size={14} aria-hidden />
            {q.data ? (
              <Crumb node={q.data} />
            ) : (
              <span className="skeleton inline-block h-4 w-16" aria-hidden />
            )}
          </li>
        ))}
        <li className="flex items-center gap-1" aria-current="page">
          <ChevronRight size={14} aria-hidden />
          <span className="max-w-48 truncate px-1 font-medium text-text">{node.name}</span>
        </li>
      </ol>
    </nav>
  );
}
