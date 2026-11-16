import { useQuery } from "@tanstack/react-query";
import { Badge } from "../components/ui/badge";
import { fileKeys } from "../features/library/queries";
import { api, appHttp } from "../lib/api";
import { cn } from "../lib/cn";
import type { StatusTone } from "../lib/roles";

/** Quiet numbers on the navigation: cards due, requests waiting, files in the inbox, concepts to review. Any failure is just no badge. */
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
  // Concepts an agent added that she has not checked yet. The list endpoint returns each concept's
  // review status, so this needs nothing new on the server; it counts the first 200, which is
  // the page size the Concepts screen itself loads.
  const review = useQuery({
    queryKey: ["badge", "review"],
    queryFn: () =>
      appHttp
        .get<{ items: Array<{ reviewStatus: string }> }>("/concepts", { limit: 200 })
        .then((r) => r.items.filter((c) => c.reviewStatus === "unverified").length),
    refetchInterval: 60_000,
    retry: false,
  });
  return {
    review: review.data ?? 0,
    practice: due.data ?? 0,
    requests: requests.data ?? 0,
    inbox: inbox.data?.length ?? 0,
  };
}

export function NavBadge({
  count,
  label,
  tone = "accent",
  className,
}: {
  count: number;
  label: string;
  tone?: StatusTone;
  className?: string;
}) {
  if (count <= 0) return null;
  return (
    <span
      aria-hidden="true"
      title={`${count} ${label}`}
      data-testid={`badge-${label.replace(/\s+/g, "-")}`}
      className={cn("ml-auto", className)}
    >
      <Badge tone={tone} size="sm" className="min-w-5 justify-center">
        {count > 99 ? "99+" : count}
      </Badge>
    </span>
  );
}
