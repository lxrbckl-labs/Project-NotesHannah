import { cn } from "../../lib/cn";
import type { RequestsStore } from "./types";
import { useRequestsBadge } from "./ui/hooks";

/** A small count for the Requests entry: waiting requests plus answers not opened yet. Hidden at zero. */
export function RequestsBadge({ store, className }: { store: RequestsStore; className?: string }) {
  const count = useRequestsBadge(store);
  if (count === 0) return null;
  return (
    <span
      data-testid="requests-badge"
      role="status"
      aria-label={`${count} request${count === 1 ? "" : "s"} need${count === 1 ? "s" : ""} a look`}
      className={cn(
        "inline-flex min-w-5 items-center justify-center rounded-pill bg-accent px-1.5 text-caption font-semibold tabular-nums text-accent-contrast",
        className,
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
