import { Progress as RadixProgress } from "radix-ui";
import { cn } from "../../lib/cn";
import type { Tone } from "../../lib/hues";

/**
 * A progress bar with an accessible name. The fill uses the hue's solid shade (the accent by
 * default). Pass showValue to print "3 of 10" beside it; never rely on the bar alone.
 */
export function ProgressBar({
  value,
  max = 100,
  label,
  hue = "accent",
  size = "md",
  showValue,
  className,
}: {
  value: number;
  max?: number;
  label: string;
  hue?: Tone;
  size?: "sm" | "md";
  showValue?: boolean;
  className?: string;
}) {
  const safeMax = max > 0 ? max : 1;
  const clamped = Math.max(0, Math.min(value, safeMax));
  const pct = Math.round((clamped / safeMax) * 100);
  return (
    <div data-hue={hue} className={cn("flex items-center gap-3", className)}>
      <RadixProgress.Root
        value={clamped}
        max={safeMax}
        aria-label={label}
        getValueLabel={(v, m) => `${v} of ${m}`}
        className={cn(
          "relative min-w-0 flex-1 overflow-hidden rounded-pill bg-surface-muted",
          size === "sm" ? "h-1.5" : "h-2.5",
        )}
      >
        <RadixProgress.Indicator
          className="h-full rounded-pill bg-tone-solid transition-[width] duration-(--duration-slow) ease-calm"
          style={{ width: `${pct}%` }}
        />
      </RadixProgress.Root>
      {showValue ? (
        <span className="shrink-0 text-label font-medium tabular-nums text-text-muted">
          {clamped} of {max}
        </span>
      ) : null}
    </div>
  );
}
