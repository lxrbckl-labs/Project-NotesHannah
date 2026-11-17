import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { describeError } from "../../lib/api";
import { cn } from "../../lib/cn";
import type { Tone } from "../../lib/hues";
import { Caplet, Capsule, Tablet } from "../art/pills";
import { Button } from "./button";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} aria-hidden />;
}

export function LoadingList({ rows = 4, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="grid gap-2.5">
      {Array.from({ length: rows }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholders
        <Skeleton key={i} className="h-16" />
      ))}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
  hue = "accent",
  compact,
  headingLevel = 2,
}: {
  /** An icon in a tinted tile above the title; leave out for a plain empty state. */
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  /** The colour of the icon tile; the accent by default. */
  hue?: Tone;
  /** Less padding, for empty lists inside a card or panel. */
  compact?: boolean;
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 3 ? "h3" : "h2";
  return (
    <div
      // No dotted grid of its own: the box is see-through, and a second grid over the page's shows as doubled dots.
      className={cn(
        "relative flex flex-col items-center overflow-hidden rounded-panel border border-dashed border-border-strong text-center",
        compact ? "px-4 py-8" : "px-6 py-12",
      )}
    >
      {compact ? null : (
        // A little pill art in two corners, for the roomy empty states only.
        <div aria-hidden className="pointer-events-none absolute inset-0 max-sm:hidden">
          <Capsule hue="teal" className="absolute -left-3 bottom-5 h-6 w-14 -rotate-[30deg]" />
          <Tablet hue="pink" className="absolute right-5 top-4 size-6" />
          <Caplet hue="yellow" className="absolute -right-2 bottom-6 h-5 w-10 rotate-[24deg]" />
        </div>
      )}
      {icon ? (
        <div
          data-hue={hue}
          className="mb-4 flex size-14 items-center justify-center rounded-card bg-tone-soft text-tone-text"
        >
          {icon}
        </div>
      ) : null}
      <Heading className="text-title font-semibold">{title}</Heading>
      {children ? <p className="mt-1.5 max-w-sm text-ui text-text-muted">{children}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/** A spinning ring with a visible label. With reduced motion the ring stands still. */
export function Spinner({ label = "Loading", inline }: { label?: string; inline?: boolean }) {
  return (
    <div
      role="status"
      className={cn(
        "flex items-center gap-2 text-text-muted",
        inline ? "inline-flex" : "justify-center py-12",
      )}
    >
      <span
        aria-hidden
        className="anim-spin size-4 rounded-pill border-2 border-border-strong border-t-accent"
      />
      <span className="text-ui">{label}</span>
    </div>
  );
}

/** A visually hidden polite live region: say what changed for screen readers. */
export function LiveRegion({ message, testId }: { message: string; testId?: string }) {
  return (
    <div className="sr-only" aria-live="polite" aria-atomic="true" data-testid={testId}>
      {message}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { message, hint } = describeError(error);
  return (
    <div
      role="alert"
      className="flex flex-col items-center rounded-panel border border-border bg-surface px-6 py-12 text-center"
    >
      <div className="mb-4 flex size-14 items-center justify-center rounded-card bg-danger-soft text-danger">
        <CircleAlert size={26} />
      </div>
      <h2 className="text-title font-semibold">Something did not load</h2>
      <p className="mt-1.5 max-w-sm text-ui text-text-muted">
        {message}
        {hint ? ` ${hint}` : ""}
      </p>
      {onRetry ? (
        <Button className="mt-5" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
