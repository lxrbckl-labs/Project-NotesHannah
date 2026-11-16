import type { NodeWithLinks } from "@notes/schema";
import { FileText, FolderOpen, Hourglass, RotateCcw } from "lucide-react";
import { Link, useParams } from "react-router";
import { Page } from "../../components/Page";
import { Button } from "../../components/ui/button";
import { EmptyState, ErrorState, LoadingList, Skeleton } from "../../components/ui/states";
import { isApiError } from "../../lib/api";
import { useFinePointer } from "../../lib/useMedia";
import { useNodeActions } from "./actions";
import { Breadcrumbs } from "./Breadcrumbs";
import { useLibraryDialogs } from "./dialogs";
import { NodeCard } from "./NodeCard";
import { NodeHeader } from "./NodeHeader";
import { NodeRow, nodeTitle } from "./NodeRow";
import { useChildren, useNode } from "./queries";
import { creatableIn, KIND_NAME } from "./rules";

export function NodePage() {
  const { nodeId } = useParams();
  const query = useNode(nodeId);

  if (query.isPending) {
    return (
      <Page>
        <div role="status" aria-label="Loading" className="grid gap-4">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-14 w-80" />
          <LoadingList rows={3} />
        </div>
      </Page>
    );
  }
  if (query.isError) {
    const gone = isApiError(query.error) && query.error.code === "not_found";
    return (
      <Page>
        {gone ? (
          <EmptyState
            icon={<FolderOpen size={26} />}
            title="That item is not in your library"
            action={
              <Link to="/library">
                <Button variant="primary">Back to library</Button>
              </Link>
            }
          >
            It may have been deleted for good, or the link is old.
          </EmptyState>
        ) : (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        )}
      </Page>
    );
  }
  return <NodeView node={query.data} />;
}

function NodeView({ node }: { node: NodeWithLinks }) {
  const actions = useNodeActions();
  if (node.trashedAt) {
    return (
      <Page>
        <Breadcrumbs node={node} />
        <div className="mt-6">
          <EmptyState
            icon={<RotateCcw size={26} />}
            title={`"${node.name}" is in the trash`}
            action={
              <Button variant="primary" onClick={() => void actions.restore(node)}>
                Restore it
              </Button>
            }
          >
            Restore it to open it again.
          </EmptyState>
        </div>
      </Page>
    );
  }
  return (
    <Page>
      <NodeHeader node={node} />
      {node.kind === "lecture" || node.kind === "document" ? (
        <ContentPlaceholder node={node} />
      ) : (
        <Children node={node} />
      )}
    </Page>
  );
}

function ContentPlaceholder({ node }: { node: NodeWithLinks }) {
  return (
    <div className="dot-grid flex flex-col items-center rounded-3xl border border-dashed border-border-strong px-6 py-16 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
        {node.kind === "lecture" ? <Hourglass size={26} /> : <FileText size={26} />}
      </div>
      <h2 className="text-lg font-semibold">Content arrives in a later stage</h2>
      <p className="mt-1.5 max-w-sm text-sm text-text-muted">
        {nodeTitle(node)} will hold its slides, transcript and study notes here. For now you can
        rename it, move it and keep it organised.
      </p>
    </div>
  );
}

function Children({ node }: { node: NodeWithLinks }) {
  const query = useChildren(node.id);
  const dialogs = useLibraryDialogs();
  const fine = useFinePointer();

  if (query.isPending) return <LoadingList label="Loading contents" />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const items = query.data;
  const creatable = creatableIn(node.kind);

  if (items.length === 0) {
    const kind = creatable[0];
    return (
      <EmptyState
        icon={<FolderOpen size={26} />}
        title="Nothing here yet"
        action={
          kind ? (
            <Button variant="primary" onClick={() => dialogs.openCreate(node, kind)}>
              New {KIND_NAME[kind].toLowerCase()}
            </Button>
          ) : null
        }
      >
        {kind ? `Add the first ${KIND_NAME[kind].toLowerCase()} to get started.` : "This is empty."}
      </EmptyState>
    );
  }

  if (node.kind === "term") {
    return (
      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="Courses">
        {items.map((n) => (
          <li key={n.id}>
            <NodeCard node={n} large />
          </li>
        ))}
      </ul>
    );
  }
  if (node.kind === "course") {
    return (
      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="Sections">
        {items.map((n) => (
          <li key={n.id}>
            <NodeCard node={n} large />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="grid gap-2.5" aria-label="Contents">
      {items.map((n, i) => (
        <NodeRow
          key={n.id}
          node={n}
          parent={node}
          previousId={items[i - 1]?.id ?? null}
          dnd={fine}
        />
      ))}
    </ul>
  );
}
