import type { NodeWithLinks } from "@notes/schema";
import { useQuery } from "@tanstack/react-query";
import { FileText, FolderOpen, PenLine, RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router";
import { Page } from "../../components/Page";
import { Button } from "../../components/ui/button";
import { EmptyState, ErrorState, LoadingList, Skeleton } from "../../components/ui/states";
import { api, isApiError } from "../../lib/api";
import { cn } from "../../lib/cn";
import { IN_PROGRESS } from "../../lib/messages";
import { useFinePointer } from "../../lib/useMedia";
import { ReferencesStrip, SHOWS_REFERENCES } from "../references/ReferencesStrip";
import { FileRow } from "../sources/FileRow";
import { PageFileDrop } from "../uploads/PageFileDrop";
import { useFileDrop } from "../uploads/useFileDrop";
import { useNodeActions } from "./actions";
import { Breadcrumbs } from "./Breadcrumbs";
import { useCourseHue } from "./courseHue";
import { useLibraryDialogs } from "./dialogs";
import { NodeCard } from "./NodeCard";
import { NodeHeader } from "./NodeHeader";
import { NodeRow, nodeTitle } from "./NodeRow";
import { canHoldFiles } from "./picker";
import { fileKeys, useChildren, useNode } from "./queries";
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
      {canHoldFiles(node) ? <PageFileDrop target={{ nodeId: node.id, label: node.name }} /> : null}
      <NodeHeader node={node} />
      {SHOWS_REFERENCES.has(node.kind) ? (
        <ReferencesStrip place={{ nodeId: node.id, name: nodeTitle(node), path: node.path }} />
      ) : null}
      <DropArea node={node}>
        {canHoldFiles(node) ? <NodeFiles node={node} /> : null}
        {node.kind === "lecture" ? (
          <LectureNotes node={node} />
        ) : node.kind === "document" ? (
          <DocumentPlaceholder node={node} />
        ) : (
          <Children node={node} />
        )}
      </DropArea>
    </Page>
  );
}

/** Files dropped anywhere on a lecture, folder or Sources page are uploaded there (computer). */
function DropArea({ node, children }: { node: NodeWithLinks; children: ReactNode }) {
  const fine = useFinePointer();
  const drop = useFileDrop({ nodeId: node.id, label: node.name }, fine && canHoldFiles(node));
  return (
    <div
      {...drop.props}
      data-drop={drop.over ? "into" : undefined}
      className={cn("rounded-panel", drop.over && "outline-2 outline-accent outline-offset-4")}
    >
      {children}
    </div>
  );
}

/** The source files filed under a lecture, folder or Sources section. */
function NodeFiles({ node }: { node: NodeWithLinks }) {
  const hue = useCourseHue(node);
  const files = useQuery({
    queryKey: fileKeys.of(node.id),
    queryFn: () => api.filesOf(node.id),
    refetchInterval: (query) =>
      query.state.data?.some((f) => IN_PROGRESS.has(f.status)) ? 2500 : false,
  });
  if (files.isPending) return <LoadingList rows={1} label="Loading files" />;
  if (files.isError) return <ErrorState error={files.error} onRetry={() => files.refetch()} />;
  if (files.data.length === 0) return null;
  return (
    <section aria-labelledby="node-files-title" className="mb-6">
      <h2 id="node-files-title" className="mb-3 text-body font-semibold">
        Source files
      </h2>
      <ul className="grid gap-2.5" aria-label="Source files">
        {files.data.map((f) => (
          <FileRow key={f.id} file={f} hue={hue} />
        ))}
      </ul>
    </section>
  );
}

/**
 * Her own notes for a lecture: the documents filed under it. The lecture's main page (the study
 * guide) opens from the header; these are the extra pages she starts herself.
 */
function LectureNotes({ node }: { node: NodeWithLinks }) {
  const query = useChildren(node.id);
  const dialogs = useLibraryDialogs();
  const fine = useFinePointer();
  const hue = useCourseHue(node);
  if (query.isPending) return <LoadingList rows={1} label="Loading notes" />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const items = query.data;
  return (
    <section aria-labelledby="lecture-notes-title">
      <h2 id="lecture-notes-title" className="mb-3 text-body font-semibold">
        Your notes
      </h2>
      {items.length === 0 ? (
        <EmptyState
          icon={<PenLine size={26} />}
          hue={hue ?? "accent"}
          title="No notes of your own yet"
          action={
            <Button variant="primary" onClick={() => dialogs.openCreate(node, "document")}>
              <PenLine size={16} aria-hidden />
              Start a note
            </Button>
          }
        >
          Type your own notes for {nodeTitle(node)} here, beside its slides and study guide.
        </EmptyState>
      ) : (
        <ul className="grid gap-2.5" aria-label="Your notes">
          {items.map((n, i) => (
            <NodeRow
              key={n.id}
              node={n}
              parent={node}
              previousId={items[i - 1]?.id ?? null}
              dnd={fine}
              hue={hue}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/** A document's library page holds only its source files; the writing is on its page. */
function DocumentPlaceholder({ node }: { node: NodeWithLinks }) {
  const hue = useCourseHue(node);
  return (
    <EmptyState icon={<FileText size={26} />} hue={hue ?? "accent"} title="This is a document">
      Open the page to read or write {nodeTitle(node)}. Files you upload here are kept with it.
    </EmptyState>
  );
}

function Children({ node }: { node: NodeWithLinks }) {
  const query = useChildren(node.id);
  const dialogs = useLibraryDialogs();
  const fine = useFinePointer();
  const hue = useCourseHue(node);

  const files = useQuery({
    queryKey: fileKeys.of(node.id),
    queryFn: () => api.filesOf(node.id),
    enabled: canHoldFiles(node),
  });
  if (query.isPending) return <LoadingList label="Loading contents" />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const items = query.data;
  const creatable = creatableIn(node.kind);

  if (items.length === 0 && (files.data?.length ?? 0) > 0) return null;
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
            <NodeCard node={n} large hue={hue} />
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
          hue={hue}
        />
      ))}
    </ul>
  );
}
