import { useInfiniteQuery } from "@tanstack/react-query";
import { Bot } from "lucide-react";
import { Link } from "react-router";
import { Page } from "../../components/Page";
import { Button } from "../../components/ui/button";
import { EmptyState, ErrorState, LoadingList } from "../../components/ui/states";
import { type ActivityEntry, type ActivityLink, api } from "../../lib/api";
import { formatDateTime } from "../../lib/format";

/** Where a link in an activity entry opens. */
export function activityHref(link: ActivityLink): string | null {
  switch (link.type) {
    case "node":
      return `/library/${link.id}`;
    case "file":
      return `/files/${link.id}`;
    case "document":
      return link.nodeId ? `/doc/${link.nodeId}` : null;
    case "block":
      return link.nodeId ? `/doc/${link.nodeId}?block=${link.id}` : null;
    case "page":
      return null;
    default:
      return null;
  }
}

function Entry({ entry }: { entry: ActivityEntry }) {
  const links = entry.links.flatMap((link) => {
    const href = activityHref(link);
    return href ? [{ link, href }] : [];
  });
  return (
    <li
      data-testid="activity-entry"
      className="rounded-2xl border border-border bg-surface p-3.5 shadow-card"
    >
      <p className="text-[15px]">{entry.summary}</p>
      <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-text-muted">
        <span>{entry.keyLabel ?? "An agent"}</span>
        <span aria-hidden>·</span>
        <time dateTime={entry.at}>{formatDateTime(entry.at)}</time>
      </p>
      {links.length > 0 ? (
        <p className="mt-2 flex flex-wrap gap-2">
          {links.slice(0, 4).map(({ link, href }) => (
            <Link
              key={`${link.type}-${link.id}`}
              to={href}
              className="rounded-full bg-accent-soft px-3 py-1 text-sm text-accent hover:underline"
            >
              {link.label ?? `Open ${link.type}`}
            </Link>
          ))}
        </p>
      ) : null}
    </li>
  );
}

/** What agents did in her library, newest first, in plain words (H10). */
export function ActivityPage() {
  const query = useInfiniteQuery({
    queryKey: ["activity"],
    queryFn: ({ pageParam }) => api.activity(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: 20_000,
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <Page>
      <header className="mb-6">
        <h1 className="text-3xl font-semibold">Activity</h1>
        <p className="mt-1 text-sm text-text-muted">
          What agents like Claude Code did in your library.
        </p>
      </header>
      {query.isPending ? (
        <LoadingList label="Loading activity" />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState icon={<Bot size={26} />} title="No agent activity yet">
          When an agent uploads, transcribes or writes something for you, it shows up here.
        </EmptyState>
      ) : (
        <>
          <ol className="grid gap-2.5" aria-label="Agent activity">
            {items.map((entry) => (
              <Entry key={entry.id} entry={entry} />
            ))}
          </ol>
          {query.hasNextPage ? (
            <div className="mt-5 flex justify-center">
              <Button disabled={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>
                Show older
              </Button>
            </div>
          ) : null}
        </>
      )}
    </Page>
  );
}
