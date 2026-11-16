import {
  BookMarked,
  Check,
  ChevronDown,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  Type,
} from "lucide-react";
import { DropdownMenu } from "radix-ui";
import type { ReactNode } from "react";
import { menuContentClass, menuItemClass } from "../../../components/ui/menu";
import { cn } from "../../../lib/cn";
import { useActions } from "../context";
import { BLOCK_STYLES, type BlockStyleId, blockLabel, styleOf } from "../model/blockStyle";
import { type CaretTarget, restyle } from "./caret";
import { keepCaret } from "./tools";

export const STYLE_ICON: Record<BlockStyleId, ReactNode> = {
  paragraph: <Type />,
  heading1: <Heading1 />,
  heading2: <Heading2 />,
  heading3: <Heading3 />,
  quote: <Quote />,
  bulleted_list: <List />,
  numbered_list: <ListOrdered />,
  checklist: <ListTodo />,
  callout: <BookMarked />,
};

/** How each style looks in the list, so the menu previews the result like a word processor's. */
const PREVIEW: Record<BlockStyleId, string> = {
  paragraph: "text-ui",
  heading1: "text-[1.2rem] font-bold leading-tight",
  heading2: "text-[1.05rem] font-semibold leading-tight",
  heading3: "text-ui font-semibold",
  quote: "text-ui italic font-serif",
  bulleted_list: "text-ui",
  numbered_list: "text-ui",
  checklist: "text-ui",
  callout: "text-ui",
};

/**
 * The block style dropdown: shows the caret's block kind ("Heading 2") and
 * turns the block into another kind. Blocks that cannot convert (a table, a
 * drug card) show their kind and stay disabled.
 */
export function BlockStyleMenu({
  target,
  compact = false,
  side = "bottom",
  onOpenChange,
}: {
  target: CaretTarget;
  /** The phone dock: icon and a short label. */
  compact?: boolean;
  side?: "top" | "bottom";
  /** The menu takes the focus: the phone dock stays up while it is open. */
  onOpenChange?: (open: boolean) => void;
}) {
  const actions = useActions();
  const { editor, block } = target;
  const current = block ? styleOf(block) : null;
  const label = !block
    ? "Style"
    : current
      ? (BLOCK_STYLES.find((s) => s.id === current)?.label ?? "Text")
      : blockLabel(block);
  const disabled = !editor || !block || current === null;
  return (
    <DropdownMenu.Root modal={false} {...(onOpenChange ? { onOpenChange } : {})}>
      <DropdownMenu.Trigger asChild disabled={disabled}>
        <button
          type="button"
          aria-label={`Block style: ${label}`}
          data-testid="block-style"
          data-style={current ?? undefined}
          onMouseDown={keepCaret}
          className={cn(
            "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-control border border-border-strong bg-surface pr-2 pl-2.5 text-ui font-medium text-text transition-colors duration-(--duration-instant) hover:bg-surface-muted xl:min-h-9",
            "disabled:pointer-events-none disabled:text-text-muted disabled:opacity-60 data-[state=open]:border-accent data-[state=open]:bg-surface-muted",
            compact ? "max-w-36" : "w-40",
          )}
        >
          <span aria-hidden className="flex text-text-muted [&_svg]:size-4">
            {current ? STYLE_ICON[current] : <Type />}
          </span>
          <span className="min-w-0 flex-1 truncate text-left">{label}</span>
          <ChevronDown aria-hidden className="size-4 shrink-0 text-text-muted" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side={side}
          align="start"
          sideOffset={6}
          collisionPadding={12}
          aria-label="Block styles"
          data-testid="block-style-menu"
          className={cn(menuContentClass, "w-64")}
          onCloseAutoFocus={(e) => {
            // Back to the text, never to the trigger: the choice (or Escape) returns the caret.
            e.preventDefault();
            if (editor && !editor.isDestroyed && !editor.isFocused) editor.commands.focus();
          }}
        >
          {BLOCK_STYLES.map((style) => (
            <DropdownMenu.Item
              key={style.id}
              data-testid={`style-${style.id}`}
              className={menuItemClass()}
              onSelect={() => {
                if (editor && block && !editor.isDestroyed)
                  restyle(actions, editor, block.id, style.id);
              }}
            >
              <span
                aria-hidden
                className="flex size-5 items-center justify-center text-text-muted [&_svg]:size-4"
              >
                {current === style.id ? <Check className="text-accent" /> : STYLE_ICON[style.id]}
              </span>
              <span className={cn("flex-1", PREVIEW[style.id])}>{style.label}</span>
              {style.typed && (
                <kbd className="rounded-inline border border-border bg-surface-muted px-1.5 font-mono text-caption text-text-muted">
                  {style.typed}
                </kbd>
              )}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
