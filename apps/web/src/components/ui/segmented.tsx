import { Tabs as RadixTabs, ToggleGroup } from "radix-ui";
import { createContext, type ReactNode, use, useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn";

/**
 * Two looks for a row of choices:
 * - "segment": a grey track with the chosen item lifted onto the surface (view switches).
 * - "pill": separate rounded pills, the chosen one filled with the accent (tool tabs, filters).
 */
export type SegmentLook = "segment" | "pill";

const TRACK: Record<SegmentLook, string> = {
  segment: "inline-flex gap-1 rounded-card border border-border bg-surface-muted p-1",
  // A pill row that is too wide scrolls inside ScrollCue, which adds the edge fades.
  pill: "flex gap-1",
};

/** The chosen item in any of the row styles here (and in the practice nav's buttons). */
const CHOSEN =
  '[aria-current="page"],[aria-selected="true"],[aria-pressed="true"],[data-state="active"],[data-state="on"]';
const FADE = 28;

/**
 * A row of choices that may be wider than its space. It scrolls sideways inside itself (the page
 * never does), fades whichever edge has more behind it so the cut reads as "keep going" and not as
 * a clipped label, and scrolls the chosen item into view when it changes or first shows.
 */
export function ScrollCue({
  className,
  scrollerClassName,
  children,
}: {
  className?: string;
  /** Padding or negative margins that let the row run to the screen edge. */
  scrollerClassName?: string;
  children: ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ start: false, end: false });

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => {
      const start = el.scrollLeft > 1;
      const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setEdge((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
    };
    // Move only this row, never the page: scrollIntoView would also scroll the ancestors.
    const reveal = () => {
      const on = el.querySelector<HTMLElement>(CHOSEN);
      if (on) {
        const a = on.getBoundingClientRect();
        const b = el.getBoundingClientRect();
        if (a.left < b.left + FADE || a.right > b.right - FADE) {
          el.scrollLeft += a.left - b.left - (b.width - a.width) / 2;
        }
      }
      measure();
    };
    el.addEventListener("scroll", measure, { passive: true });
    const frame = requestAnimationFrame(reveal);
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    resize?.observe(el);
    if (el.firstElementChild) resize?.observe(el.firstElementChild);
    const changes = new MutationObserver(reveal);
    changes.observe(el, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["aria-current", "aria-selected", "aria-pressed", "data-state"],
    });
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", measure);
      resize?.disconnect();
      changes.disconnect();
    };
  }, []);

  const mask = `linear-gradient(to right, ${edge.start ? "transparent 0" : "#000 0"}, #000 ${FADE}px, #000 calc(100% - ${FADE}px), ${edge.end ? "transparent 100%" : "#000 100%"})`;
  return (
    <div className={cn("min-w-0 max-w-full", className)}>
      <div
        ref={scroller}
        data-scroll-cue
        data-more-start={edge.start}
        data-more-end={edge.end}
        className={cn("overflow-x-auto [scrollbar-width:none]", scrollerClassName)}
        style={edge.start || edge.end ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
      >
        {children}
      </div>
    </div>
  );
}

/** Classes for one item. Exported for link-based tabs (a Link with role="tab"). */
export function segmentItemClass(selected: boolean, look: SegmentLook = "segment"): string {
  return cn(
    "inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 px-4 text-ui font-medium transition-colors duration-(--duration-instant) disabled:pointer-events-none disabled:opacity-50 xl:min-h-8 [&_svg]:size-4",
    look === "segment" ? "rounded-control" : "rounded-pill",
    selected
      ? look === "segment"
        ? "bg-surface text-text shadow-card"
        : "bg-accent text-accent-contrast"
      : look === "segment"
        ? "text-text-muted hover:text-text"
        : "text-text-muted hover:bg-surface-muted hover:text-text",
  );
}

export interface SegmentItem<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
  /** Show only the icon (the label stays as the accessible name). */
  iconOnly?: boolean;
  disabled?: boolean;
}

/**
 * Pick one of a few options (theme, view, filter). Always has a value: clicking the chosen item
 * keeps it. Arrow keys move between items.
 */
export function SegmentedControl<T extends string>({
  label,
  value,
  onValueChange,
  items,
  look = "segment",
  fill,
  className,
}: {
  /** The accessible name of the group, e.g. "Theme". */
  label: string;
  value: T;
  onValueChange: (value: T) => void;
  items: readonly SegmentItem<T>[];
  look?: SegmentLook;
  /** Stretch the items to share the full width. */
  fill?: boolean;
  className?: string;
}) {
  return (
    <ScrollCue className={fill ? "w-full" : undefined}>
      <ToggleGroup.Root
        type="single"
        aria-label={label}
        value={value}
        onValueChange={(next) => {
          if (next) onValueChange(next as T);
        }}
        className={cn(TRACK[look], fill && "flex w-full", className)}
      >
        {items.map((item) => (
          <ToggleGroup.Item
            key={item.value}
            value={item.value}
            disabled={item.disabled}
            aria-label={item.iconOnly ? item.label : undefined}
            className={cn(segmentItemClass(item.value === value, look), fill && "flex-1")}
          >
            {item.icon ? <span aria-hidden>{item.icon}</span> : null}
            {item.iconOnly ? null : item.label}
          </ToggleGroup.Item>
        ))}
      </ToggleGroup.Root>
    </ScrollCue>
  );
}

const LookContext = createContext<SegmentLook>("segment");

/** Tabs that switch panels in place. Root: holds the value. */
export function Tabs<T extends string>({
  value,
  defaultValue,
  onValueChange,
  look = "segment",
  className,
  children,
}: {
  value?: T;
  defaultValue?: T;
  onValueChange?: (value: T) => void;
  look?: SegmentLook;
  className?: string;
  children: ReactNode;
}) {
  return (
    <LookContext value={look}>
      <RadixTabs.Root
        {...(value !== undefined ? { value } : {})}
        {...(defaultValue !== undefined ? { defaultValue } : {})}
        {...(onValueChange ? { onValueChange: (v: string) => onValueChange(v as T) } : {})}
        className={className}
      >
        {children}
      </RadixTabs.Root>
    </LookContext>
  );
}

export function TabList({
  label,
  className,
  fill,
  children,
}: {
  label: string;
  className?: string;
  fill?: boolean;
  children: ReactNode;
}) {
  const look = use(LookContext);
  return (
    <ScrollCue className={fill ? "w-full" : undefined}>
      <RadixTabs.List
        aria-label={label}
        className={cn(TRACK[look], fill && "flex w-full", className)}
      >
        {children}
      </RadixTabs.List>
    </ScrollCue>
  );
}

export function Tab({
  value,
  disabled,
  className,
  children,
}: {
  value: string;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const look = use(LookContext);
  return (
    <RadixTabs.Trigger
      value={value}
      disabled={disabled}
      className={cn(
        segmentItemClass(false, look),
        look === "segment"
          ? "data-[state=active]:bg-surface data-[state=active]:text-text data-[state=active]:shadow-card"
          : "data-[state=active]:bg-accent data-[state=active]:text-accent-contrast data-[state=active]:hover:bg-accent data-[state=active]:hover:text-accent-contrast",
        className,
      )}
    >
      {children}
    </RadixTabs.Trigger>
  );
}

export function TabPanel({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <RadixTabs.Content value={value} className={cn("mt-4 outline-none", className)}>
      {children}
    </RadixTabs.Content>
  );
}
