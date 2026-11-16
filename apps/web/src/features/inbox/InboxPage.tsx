import { useQuery } from "@tanstack/react-query";
import { Inbox } from "lucide-react";
import { Link } from "react-router";
import { Page } from "../../components/Page";
import { EmptyState, ErrorState, LoadingList } from "../../components/ui/states";
import { api } from "../../lib/api";
import { FileStatusBadge, FileTypeIcon } from "../library/LibraryTree";
import { fileKeys } from "../library/queries";

export function InboxPage() {
  const inbox = useQuery({ queryKey: fileKeys.inbox, queryFn: api.inboxFiles });
  return (
    <Page>
      <h1 className="mb-5 text-3xl font-semibold">Inbox</h1>
      {inbox.isPending ? (
        <LoadingList label="Loading inbox" />
      ) : inbox.isError ? (
        <ErrorState error={inbox.error} onRetry={() => inbox.refetch()} />
      ) : inbox.data.length === 0 ? (
        <EmptyState icon={<Inbox size={26} />} title="Nothing waiting">
          Uploaded slides and notes wait here until they are filed under a lecture.
        </EmptyState>
      ) : (
        <ul className="grid gap-2.5" aria-label="Unfiled files">
          {inbox.data.map((f) => (
            <li key={f.id}>
              <Link
                to={`/files/${f.id}`}
                className="flex min-h-16 items-center gap-3 rounded-2xl border border-border bg-surface p-3 shadow-card hover:border-border-strong"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                  <FileTypeIcon type={f.type} size={20} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{f.originalName}</span>
                  <span className="block text-sm text-text-muted">
                    {f.pageCount ? `${f.pageCount} pages` : "Pages unknown"}
                  </span>
                </span>
                <FileStatusBadge status={f.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
