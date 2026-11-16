import type { HTMLAttributes, ReactNode, Ref } from "react";
import { cn } from "../../lib/cn";
import type { Tone } from "../../lib/hues";

type CardTag = "div" | "section" | "article" | "li" | "aside";

const PADDING = {
  none: "",
  sm: "p-3",
  md: "p-4 md:p-5",
  lg: "p-5 md:p-6",
} as const;

export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: CardTag;
  padding?: keyof typeof PADDING;
  /** A tinted card: soft background and border in this hue. Leave out for the plain surface. */
  hue?: Tone | undefined;
  /** Lifts on hover; use when the whole card is a link or button. */
  interactive?: boolean;
  /** Flat cards (inside other cards) drop the shadow. */
  flat?: boolean;
  ref?: Ref<HTMLElement>;
  children?: ReactNode;
}

/** The rounded paper card: the app's basic container. */
export function Card({
  as: Tag = "div",
  padding = "md",
  hue,
  interactive,
  flat,
  className,
  children,
  ref,
  ...rest
}: CardProps) {
  return (
    <Tag
      ref={ref as Ref<never>}
      data-hue={hue}
      className={cn(
        "rounded-card border text-text",
        hue ? "border-tone-border bg-tone-soft" : "border-border bg-surface",
        flat ? "" : "shadow-card",
        interactive &&
          "transition-[box-shadow,border-color] duration-(--duration-fast) hover:border-border-strong hover:shadow-raised",
        PADDING[padding],
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/** A titled card section, as on the Settings page. */
export function CardTitle({
  title,
  description,
  action,
  id,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  id?: string;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 id={id} className="text-title font-semibold">
          {title}
        </h2>
        {description ? <p className="mt-1 text-ui text-text-muted">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
