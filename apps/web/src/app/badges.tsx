import { useQuery } from "@tanstack/react-query";
import { fileKeys } from "../features/library/queries";
import { api, appHttp } from "../lib/api";
import { cn } from "../lib/cn";

/** Quiet numbers on the navigation: cards due, requests waiting, files in the inbox. Any failure is just no badge. */
export function useBadges() {
  const due = useQuery({
    queryKey: ["badge", "due"],
    queryFn: () =>
      appHttp
        .get<{ counts: { due: number } }>("/practice/due", { limit: 1 })
        .then((r) => r.counts.due),
    refetchInterval: 60_000,
    retry: false,
  });
  const requests = useQuery({
    queryKey: ["badge", "requests"],
    queryFn: () =>
      appHttp.get<{ counts: { open: number } }>("/requests/counts").then((r) => r.counts.open),
    refetchInterval: 30_000,
    retry: false,
  });
  const inbox = useQuery({
    queryKey: fileKeys.inbox,
    queryFn: api.inboxFiles,
    refetchInterval: 20_000,
    retry: false,
  });
  return {
    practice: due.data ?? 0,
    requests: requests.data ?? 0,
    inbox: inbox.data?.length ?? 0,
  };
}

export function NavBadge({
  count,
  label,
  className,
}: {
  count: number;
  label: string;
  className?: string;
}) {
  if (count <= 0) return null;
  return (
    <span
      role="img"
      aria-label={`${count} ${label}`}
      data-testid={`badge-${label.replace(/\s+/g, "-")}`}
      className={cn(
        "ml-auto min-w-5 rounded-full bg-accent-soft px-1.5 text-center text-xs font-medium text-accent",
        className,
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
