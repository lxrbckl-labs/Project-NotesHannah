import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { describeError } from "../../lib/api";
import { cn } from "../../lib/cn";
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
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="dot-grid flex flex-col items-center rounded-3xl border border-dashed border-border-strong px-6 py-12 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
        {icon}
      </div>
      <h2 className="text-lg font-semibold">{title}</h2>
      {children ? <p className="mt-1.5 max-w-sm text-sm text-text-muted">{children}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { message, hint } = describeError(error);
  return (
    <div
      role="alert"
      className="flex flex-col items-center rounded-3xl border border-border bg-surface px-6 py-12 text-center"
    >
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-danger-soft text-danger">
        <CircleAlert size={26} />
      </div>
      <h2 className="text-lg font-semibold">Something did not load</h2>
      <p className="mt-1.5 max-w-sm text-sm text-text-muted">
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
