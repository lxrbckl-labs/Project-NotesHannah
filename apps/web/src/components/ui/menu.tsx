import { ContextMenu, DropdownMenu } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export type MenuEntry =
  | {
      type: "item";
      label: string;
      icon?: ReactNode;
      onSelect: () => void;
      danger?: boolean;
      disabled?: boolean;
      shortcut?: string;
    }
  | { type: "separator" };

const contentClass =
  "z-50 min-w-52 rounded-2xl border border-border bg-surface p-1.5 text-text shadow-pop anim-pop";
const itemClass = (danger?: boolean) =>
  cn(
    "flex min-h-11 cursor-default select-none items-center gap-3 rounded-xl px-3 text-sm outline-none xl:min-h-9",
    "data-[highlighted]:bg-surface-muted data-[disabled]:opacity-40",
    danger ? "text-danger" : "text-text",
  );
const sepClass = "my-1 h-px bg-border";

function Entries({
  entries,
  Item,
  Separator,
}: {
  entries: MenuEntry[];
  Item: typeof DropdownMenu.Item | typeof ContextMenu.Item;
  Separator: typeof DropdownMenu.Separator | typeof ContextMenu.Separator;
}) {
  return entries.map((entry, i) =>
    entry.type === "separator" ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: static menu structure
      <Separator key={`sep-${i}`} className={sepClass} />
    ) : (
      <Item
        key={entry.label}
        className={itemClass(entry.danger)}
        disabled={entry.disabled}
        onSelect={entry.onSelect}
      >
        <span className="flex size-5 items-center justify-center text-text-muted">
          {entry.icon}
        </span>
        <span className="flex-1">{entry.label}</span>
        {entry.shortcut ? <kbd className="text-xs text-text-muted">{entry.shortcut}</kbd> : null}
      </Item>
    ),
  );
}

/** A "..." style menu opened from a button. */
export function ActionMenu({
  trigger,
  entries,
  align = "end",
  open,
  onOpenChange,
}: {
  trigger: ReactNode;
  entries: MenuEntry[];
  align?: "start" | "end";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <DropdownMenu.Root open={open} onOpenChange={onOpenChange}>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align={align} sideOffset={6} className={contentClass}>
          <Entries entries={entries} Item={DropdownMenu.Item} Separator={DropdownMenu.Separator} />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** Right-click on the computer, long-press on touch. */
export function ContextActions({
  entries,
  children,
}: {
  entries: MenuEntry[];
  children: ReactNode;
}) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className={contentClass}>
          <Entries entries={entries} Item={ContextMenu.Item} Separator={ContextMenu.Separator} />
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
