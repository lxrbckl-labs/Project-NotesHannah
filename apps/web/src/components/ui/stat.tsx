import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import type { Tone } from "../../lib/hues";

/** One number with its label: cards due, streak, accuracy. Tinted when given a hue. */
export function StatTile({
  label,
  value,
  hint,
  icon,
  hue,
  className,
}: {
  label: string;
  value: ReactNode;
  /** A short line under the number, e.g. "up from 12 last week". */
  hint?: ReactNode;
  icon?: ReactNode;
  hue?: Tone | undefined;
  className?: string;
}) {
  return (
    <div
      data-hue={hue}
      className={cn(
        "flex min-w-0 flex-col gap-1 rounded-card border p-4",
        hue ? "border-tone-border bg-tone-soft" : "border-border bg-surface shadow-card",
        className,
      )}
    >
      <div className="flex items-center gap-2 text-label font-medium text-text-muted">
        {icon ? (
          <span aria-hidden className={cn("flex [&_svg]:size-4", hue && "text-tone-text")}>
            {icon}
          </span>
        ) : null}
        <span className="truncate">{label}</span>
      </div>
      <div
        className={cn(
          "font-display text-heading font-semibold tabular-nums",
          hue ? "text-tone-text" : "text-text",
        )}
      >
        {value}
      </div>
      {hint ? <div className="text-label text-text-muted">{hint}</div> : null}
    </div>
  );
}
