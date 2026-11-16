import { Tabs as RadixTabs, ToggleGroup } from "radix-ui";
import { createContext, type ReactNode, use } from "react";
import { cn } from "../../lib/cn";

/**
 * Two looks for a row of choices:
 * - "segment": a grey track with the chosen item lifted onto the surface (view switches).
 * - "pill": separate rounded pills, the chosen one filled with the accent (tool tabs, filters).
 */
export type SegmentLook = "segment" | "pill";

const TRACK: Record<SegmentLook, string> = {
  segment: "inline-flex gap-1 rounded-card border border-border bg-surface-muted p-1",
  pill: "flex gap-1 overflow-x-auto [scrollbar-width:none]",
};

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
    <RadixTabs.List
      aria-label={label}
      className={cn(TRACK[look], fill && "flex w-full", className)}
    >
      {children}
    </RadixTabs.List>
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
