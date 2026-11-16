import type { NodeWithLinks } from "@notes/schema";
import { useQueries } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { Link } from "react-router";
import { nodeQuery } from "./queries";
import { nodeHref } from "./rules";

/** Library > Term > Course > Section, each a link; the current item is plain text. */
export function Breadcrumbs({ node }: { node: NodeWithLinks }) {
  const ancestors = useQueries({ queries: node.ancestors.map((id) => nodeQuery(id)) });
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-sm text-text-muted">
        <li>
          <Link className="rounded-md px-1 hover:text-text hover:underline" to="/library">
            Library
          </Link>
        </li>
        {ancestors.map((q, i) => (
          <li key={node.ancestors[i]} className="flex items-center gap-1">
            <ChevronRight size={14} aria-hidden />
            {q.data ? (
              <Link
                className="max-w-40 truncate rounded-md px-1 hover:text-text hover:underline"
                to={nodeHref(q.data)}
              >
                {q.data.name}
              </Link>
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
