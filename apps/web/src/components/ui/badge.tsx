import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { cn } from "../../lib/cn";
import type { Tone } from "../../lib/hues";
import { STATUS_TONE, type StatusTone } from "../../lib/roles";

export type BadgeVariant = "soft" | "outline" | "solid";

const VARIANT: Record<BadgeVariant, string> = {
  soft: "border-transparent bg-tone-soft text-tone-text",
  outline: "border-tone-border bg-surface text-tone-text",
  /** Inverted: the text shade as the fill, the soft shade as the text. AA in both themes. */
  solid: "border-transparent bg-tone-text text-tone-soft",
};

export interface BadgeProps {
  /** A palette hue, or "accent". Takes precedence over tone. */
  hue?: Tone | undefined;
  /** A semantic tone: neutral, accent, success, warning, info, danger. */
  tone?: StatusTone;
  variant?: BadgeVariant;
  size?: "sm" | "md";
  /** A small icon before the text. Color is never the only signal: keep the words. */
  icon?: ReactNode;
  /** A colored dot before the text, in the solid shade. */
  dot?: boolean;
  className?: string;
  children: ReactNode;
}

/** A small, non-interactive label: a status, a type, a count. */
export function Badge({
  hue,
  tone = "neutral",
  variant = "soft",
  size = "md",
  icon,
  dot,
  className,
  children,
}: BadgeProps) {
  return (
    <span
      data-hue={hue ?? STATUS_TONE[tone]}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-pill border font-medium",
        size === "sm" ? "px-2 text-caption" : "px-2.5 py-0.5 text-caption",
        VARIANT[variant],
        className,
      )}
    >
      {dot ? <span aria-hidden className="size-2 shrink-0 rounded-pill bg-tone-solid" /> : null}
      {icon ? (
        <span aria-hidden className="flex shrink-0 [&_svg]:size-3.5">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  hue?: Tone | undefined;
  /** A toggle chip: filled while pressed. Leave undefined for a plain action chip. */
  pressed?: boolean;
  icon?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

/**
 * A small pressable pill: a filter, a concept link, a suggestion. It looks 28px tall but takes
 * a 44px hit area on touch.
 */
export function Chip({
  hue,
  pressed,
  icon,
  className,
  children,
  type = "button",
  ...rest
}: ChipProps) {
  return (
    <button
      type={type}
      data-hue={hue ?? (pressed ? "accent" : undefined)}
      aria-pressed={pressed}
      className={cn(
        "hit-area inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-pill border px-3 text-label font-medium transition-colors duration-(--duration-instant) disabled:pointer-events-none disabled:opacity-50",
        pressed
          ? "border-transparent bg-tone-text text-tone-soft"
          : hue
            ? "border-tone-border bg-tone-soft text-tone-text hover:border-tone-solid"
            : "border-border bg-surface text-text hover:bg-surface-muted",
        className,
      )}
      {...rest}
    >
      {icon ? (
        <span aria-hidden className="flex shrink-0 [&_svg]:size-3.5">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 truncate">{children}</span>
    </button>
  );
}
