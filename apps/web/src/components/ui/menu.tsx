import { ChevronRight } from "lucide-react";
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
  | { type: "separator" }
  /** A non-interactive heading, e.g. the full name of the item the menu is for. */
  | { type: "label"; text: string }
  /** A nested menu (dropdown menus only; a context menu shows it the same way). */
  | { type: "sub"; label: string; icon?: ReactNode; entries: MenuEntry[]; disabled?: boolean };

const contentClass =
  "z-(--z-popover) max-h-[min(70vh,var(--radix-dropdown-menu-content-available-height,70vh))] min-w-52 overflow-y-auto rounded-card border border-border bg-surface p-1.5 text-text shadow-pop anim-pop";
const itemClass = (danger?: boolean) =>
  cn(
    "flex min-h-11 cursor-default select-none items-center gap-3 rounded-control px-3 text-ui outline-none xl:min-h-9",
    "data-[highlighted]:bg-surface-muted data-[state=open]:bg-surface-muted data-[disabled]:opacity-40",
    danger ? "text-danger" : "text-text",
  );
const sepClass = "my-1 h-px bg-border";

type Parts = {
  Item: typeof DropdownMenu.Item | typeof ContextMenu.Item;
  Separator: typeof DropdownMenu.Separator | typeof ContextMenu.Separator;
  Label: typeof DropdownMenu.Label | typeof ContextMenu.Label;
  Sub: typeof DropdownMenu.Sub | typeof ContextMenu.Sub;
  SubTrigger: typeof DropdownMenu.SubTrigger | typeof ContextMenu.SubTrigger;
  SubContent: typeof DropdownMenu.SubContent | typeof ContextMenu.SubContent;
  Portal: typeof DropdownMenu.Portal | typeof ContextMenu.Portal;
};

const DROPDOWN: Parts = {
  Item: DropdownMenu.Item,
  Separator: DropdownMenu.Separator,
  Label: DropdownMenu.Label,
  Sub: DropdownMenu.Sub,
  SubTrigger: DropdownMenu.SubTrigger,
  SubContent: DropdownMenu.SubContent,
  Portal: DropdownMenu.Portal,
};

const CONTEXT: Parts = {
  Item: ContextMenu.Item,
  Separator: ContextMenu.Separator,
  Label: ContextMenu.Label,
  Sub: ContextMenu.Sub,
  SubTrigger: ContextMenu.SubTrigger,
  SubContent: ContextMenu.SubContent,
  Portal: ContextMenu.Portal,
};

function Entries({ entries, parts }: { entries: MenuEntry[]; parts: Parts }) {
  const { Item, Separator, Label, Sub, SubTrigger, SubContent, Portal } = parts;
  return entries.map((entry, i) =>
    entry.type === "sub" ? (
      <Sub key={`sub-${entry.label}`}>
        <SubTrigger className={itemClass()} disabled={entry.disabled}>
          <span className="flex size-5 items-center justify-center text-text-muted">
            {entry.icon}
          </span>
          <span className="flex-1">{entry.label}</span>
          <ChevronRight size={16} aria-hidden className="text-text-muted" />
        </SubTrigger>
        <Portal>
          <SubContent sideOffset={4} collisionPadding={12} className={contentClass}>
            <Entries entries={entry.entries} parts={parts} />
          </SubContent>
        </Portal>
      </Sub>
    ) : entry.type === "label" ? (
      <Label
        // biome-ignore lint/suspicious/noArrayIndexKey: static menu structure
        key={`label-${i}`}
        className="max-w-72 break-words px-3 py-1.5 text-xs font-medium text-text-muted [overflow-wrap:anywhere]"
      >
        {entry.text}
      </Label>
    ) : entry.type === "separator" ? (
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
  label,
}: {
  trigger: ReactNode;
  entries: MenuEntry[];
  align?: "start" | "center" | "end";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The accessible name of the menu, when the trigger's name is not enough. */
  label?: string;
}) {
  return (
    <DropdownMenu.Root open={open} onOpenChange={onOpenChange}>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          sideOffset={6}
          collisionPadding={12}
          aria-label={label}
          className={contentClass}
        >
          <Entries entries={entries} parts={DROPDOWN} />
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
        <ContextMenu.Content collisionPadding={12} className={contentClass}>
          <Entries entries={entries} parts={CONTEXT} />
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
