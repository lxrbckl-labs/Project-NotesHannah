import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link, type LinkProps } from "react-router";
import { cn } from "../../lib/cn";
import { ScrollCue } from "./segmented";
import { Tooltip } from "./tooltip";

/**
 * A row of actions for a page, drawn as one bar: an icon for every action, one line at every width.
 * With room the actions carry their words; with less room only the main one does; on a phone they are
 * icons (each still named for a screen reader and on hover). If even that does not fit, the bar scrolls
 * sideways inside itself with a fade at the cut edge; it never wraps onto a second row.
 *
 * `labels="auto"` needs the bar to have the full width of its place (it measures that width).
 * `labels="never"` is for a bar tucked beside a title, where it is always icons.
 */
export function ActionBar({
  label,
  labels = "auto",
  className,
  children,
}: {
  /** What the bar is for, for a screen reader ("Actions for Beta blockers"). */
  label: string;
  labels?: "auto" | "never";
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn(labels === "auto" && "@container w-full", className)}>
      <ScrollCue>
        <div
          role="toolbar"
          aria-label={label}
          data-labels={labels}
          className="group/bar inline-flex items-center gap-1 rounded-card border border-border-strong bg-surface p-1 shadow-card"
        >
          {children}
        </div>
      </ScrollCue>
    </div>
  );
}

/** A thin line between groups of actions. */
export function ActionDivider() {
  return <span aria-hidden className="mx-0.5 h-6 w-px shrink-0 bg-border" />;
}

interface ItemLook {
  /** The page's main action: filled, and the last to lose its word. */
  primary?: boolean;
  /** For a destructive or cautionary destination. */
  tone?: "default" | "danger";
}

function itemClass({ primary, tone = "default" }: ItemLook, className?: string) {
  return cn(
    // 44px on touch, 36px on the computer layout, like every other button.
    "inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-control px-3 text-ui font-medium transition-colors duration-(--duration-instant) disabled:pointer-events-none disabled:opacity-50 xl:min-h-9 xl:min-w-9 [&_svg]:size-4 [&_svg]:shrink-0",
    primary
      ? "bg-accent text-accent-contrast hover:brightness-110 active:brightness-95"
      : tone === "danger"
        ? "text-danger hover:bg-danger-soft active:bg-danger-soft"
        : "text-text hover:bg-surface-muted active:bg-surface-muted",
    className,
  );
}

/** The word beside the icon: shown by the bar's width, never in a `labels="never"` bar. */
function Word({ primary, children }: { primary?: boolean | undefined; children: ReactNode }) {
  return (
    <span
      className={cn(
        "hidden group-data-[labels=never]/bar:hidden",
        primary ? "@md:inline" : "@3xl:inline",
      )}
    >
      {children}
    </span>
  );
}

type ActionButtonProps = ItemLook &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
    icon: ReactNode;
    /** The action's name: its word when there is room, always its accessible name and hover text. */
    label: string;
    /** Extra content after the word, such as a count badge. */
    children?: ReactNode;
  };

export function ActionButton({
  icon,
  label,
  primary,
  tone,
  className,
  children,
  ...rest
}: ActionButtonProps) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        className={itemClass({ primary, tone }, className)}
        {...rest}
      >
        {icon}
        <Word primary={primary}>{label}</Word>
        {children}
      </button>
    </Tooltip>
  );
}

type ActionLinkProps = ItemLook &
  Omit<LinkProps, "children"> & {
    icon: ReactNode;
    label: string;
    children?: ReactNode;
  };

/** An action that goes somewhere. */
export function ActionLink({
  icon,
  label,
  primary,
  tone,
  className,
  children,
  ...rest
}: ActionLinkProps) {
  return (
    <Tooltip content={label}>
      <Link aria-label={label} className={itemClass({ primary, tone }, className)} {...rest}>
        {icon}
        <Word primary={primary}>{label}</Word>
        {children}
      </Link>
    </Tooltip>
  );
}
