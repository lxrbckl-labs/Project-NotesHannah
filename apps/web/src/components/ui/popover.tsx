import { X } from "lucide-react";
import { Popover as RadixPopover } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { IconButton } from "./button";

/** The floating panel look shared by popovers and menus. */
export const floatingPanelClass =
  "anim-pop z-(--z-popover) rounded-card border border-border bg-surface text-text shadow-pop outline-none";

/**
 * A small panel anchored to its trigger: a colour picker, a citation preview, a short form.
 * Escape and a tap outside close it; focus returns to the trigger.
 */
export function Popover({
  trigger,
  children,
  label,
  title,
  side = "bottom",
  align = "center",
  open,
  onOpenChange,
  container,
  focusOnOpen = true,
  showClose,
  className,
}: {
  /** One focusable element. */
  trigger: ReactNode;
  children: ReactNode;
  /** The accessible name of the panel. */
  label: string;
  /** A visible heading at the top of the panel. */
  title?: string;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Where to mount; the document body by default. */
  container?: HTMLElement | null;
  /** Move focus into the panel when it opens (off for previews that should not steal focus). */
  focusOnOpen?: boolean;
  /** A close button in the corner, for touch users. */
  showClose?: boolean;
  className?: string;
}) {
  return (
    <RadixPopover.Root
      {...(open !== undefined ? { open } : {})}
      {...(onOpenChange ? { onOpenChange } : {})}
    >
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal container={container ?? undefined}>
        <RadixPopover.Content
          side={side}
          align={align}
          sideOffset={8}
          collisionPadding={12}
          aria-label={label}
          onOpenAutoFocus={focusOnOpen ? undefined : (event) => event.preventDefault()}
          className={cn(
            floatingPanelClass,
            "max-h-(--radix-popover-content-available-height) w-max max-w-[min(22rem,calc(100vw-24px))] overflow-y-auto p-3 text-ui",
            className,
          )}
        >
          {title || showClose ? (
            <div className="mb-2 flex items-center justify-between gap-2">
              {title ? <p className="text-label font-semibold text-text-muted">{title}</p> : null}
              {showClose ? (
                <RadixPopover.Close asChild>
                  <IconButton label="Close" size="sm" className="-my-1 -mr-1 ml-auto">
                    <X size={16} />
                  </IconButton>
                </RadixPopover.Close>
              ) : null}
            </div>
          ) : null}
          {children}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}

/** Closes the popover it sits in (wrap a button). */
export const PopoverClose = RadixPopover.Close;
