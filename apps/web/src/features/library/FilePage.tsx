import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, FileSearch } from "lucide-react";
import { Link, useParams } from "react-router";
import { Page } from "../../components/Page";
import { Button } from "../../components/ui/button";
import { EmptyState, ErrorState, Skeleton } from "../../components/ui/states";
import { api, isApiError } from "../../lib/api";
import { formatDate } from "../../lib/format";
import { useBack } from "../../lib/useBack";
import { FileStatusBadge, FileTypeIcon } from "./LibraryTree";
import { fileKeys, useNode } from "./queries";

/** Placeholder for the source viewer (the original page beside its transcript arrives later). */
export function FilePage() {
  const { fileId = "" } = useParams();
  const back = useBack("/library");
  const file = useQuery({ queryKey: fileKeys.one(fileId), queryFn: () => api.file(fileId) });
  const node = useNode(file.data?.nodeId ?? undefined);

  if (file.isPending) {
    return (
      <Page>
        <div role="status" aria-label="Loading" className="grid gap-4">
          <Skeleton className="h-10 w-72" />
          <Skeleton className="h-40" />
        </div>
      </Page>
    );
  }
  if (file.isError) {
    const gone = isApiError(file.error) && file.error.code === "not_found";
    return (
      <Page>
        {gone ? (
          <EmptyState
            icon={<FileSearch size={26} />}
            title="That file is not here"
            action={
              <Link to="/library">
                <Button variant="primary">Back to library</Button>
              </Link>
            }
          >
            It may have been deleted, or the link is old.
          </EmptyState>
        ) : (
          <ErrorState error={file.error} onRetry={() => file.refetch()} />
        )}
      </Page>
    );
  }
  const f = file.data;
  return (
    <Page>
      <button
        type="button"
        onClick={back}
        className="-ml-2 mb-3 inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm text-text-muted hover:bg-surface-muted hover:text-text"
      >
        <ArrowLeft size={18} aria-hidden /> Back
      </button>
      <header className="mb-6 flex items-start gap-3">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-3xl bg-accent-soft text-accent">
          <FileTypeIcon type={f.type} size={26} />
        </span>
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-semibold leading-tight md:text-3xl">
            {f.originalName}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-muted">
            <span className="uppercase">{f.type}</span>
            {f.pageCount ? <span>{f.pageCount} pages</span> : null}
            <FileStatusBadge status={f.status} />
            <span>Uploaded {formatDate(f.createdAt)}</span>
          </p>
          {node.data ? (
            <p className="mt-2 text-sm">
              Filed under{" "}
              <Link
                className="text-accent underline-offset-2 hover:underline"
                to={`/library/${node.data.id}`}
              >
                {node.data.path}
              </Link>
            </p>
          ) : f.nodeId === null ? (
            <p className="mt-2 text-sm text-text-muted">Waiting in the inbox to be filed.</p>
          ) : null}
        </div>
      </header>
      <EmptyState
        icon={<FileSearch size={26} />}
        title="The source viewer arrives in a later stage"
      >
        You will read the original page beside its transcript here.
      </EmptyState>
    </Page>
  );
}
